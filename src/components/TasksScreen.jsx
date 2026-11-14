import React, { useState, useMemo, useRef, useEffect } from "react";
import { displayNameFor, formatFullDate, formatDateShort, formatTime, formatClock, dayKey, progKey, COLORS } from "../lib/core";
import { HomeIcon, LinkIcon, Plus, X, Settings } from "./Icon";

// Defined locally rather than added to Icon.jsx — that file is shared app-wide
// and a full-file replacement earlier clobbered icons (ChatIcon, SparkIcon)
// this component doesn't even use. Keeping it local means this file never
// needs to touch, or assume the contents of, Icon.jsx again.
const ImageIcon = (p) => (
  <svg width={p.size || 18} height={p.size || 18} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
    <circle cx="8.5" cy="8.5" r="1.5" />
    <polyline points="21 15 16 10 5 21" />
  </svg>
);

import { downloadHls, saveBlob, isM3u8, isYouTube, ytDlpCommand, parseClipTime, clockToSeconds, describeClip } from "../lib/hls";
import { sortByOrder, queueFor as queueForTasks, activeQueueFor, rankOf as rankOfTask, planMove } from "../lib/taskOrder";
import { dueInfo, eventLine, matchesSearch, taskActivity, workflowsForTask, shortDate } from "../lib/taskInfo";
import { resolveTarget, countsForDay, evaluate } from "../lib/targets";
import { useTodayKey } from "./TargetsWidget";
import { buildTeamNow } from "./Dashboard";
import { resizeImageFile } from "../lib/image";

const STATUS_TABS = [
  ["active", "Active"],
  ["pending", "Pending"],
  ["in_progress", "In progress"],
  ["done", "Done"],
  ["all", "All"],
];

// A short, honest "what's actually saved" line — handles both the current
// array format and an older saved task's newline-string, same as the form
// itself does, so the summary and the editable fields never disagree.
function peopleCount(v) {
  if (Array.isArray(v)) return v.filter((s) => s && s.trim()).length;
  return (v || "").split("\n").map((s) => s.trim()).filter(Boolean).length;
}
const EVENT_EMPTY = "Saved, but no details filled in yet";
function summarizeEvent(ev) {
  if (!ev) return "";
  const bits = [];
  if (ev.sourceType === "floor") {
    if (ev.chamber) bits.push(`${ev.chamber} floor`);
    if (ev.measure) bits.push(ev.measure);
  } else if (ev.sourceType === "briefing") {
    if (ev.organization) bits.push(ev.organization);
    const n = peopleCount(ev.spokespeople);
    if (n) bits.push(`${n} spokesperson${n === 1 ? "" : "s"}`);
  } else if (ev.sourceType === "other") {
    if (ev.otherEventType) bits.push(ev.otherEventType);
    const n = peopleCount(ev.participants);
    if (n) bits.push(`${n} participant${n === 1 ? "" : "s"}`);
  } else {
    if (ev.hearingType === "markup") bits.push("Markup");
    if (ev.committee) bits.push(ev.subcommittee ? `${ev.committee} — ${ev.subcommittee}` : ev.committee);
    const n = peopleCount(ev.witnesses);
    if (n) bits.push(`${n} ${ev.hearingType === "nomination" ? "nominee" : "witness"}${n === 1 ? "" : "es"}`);
  }
  if (ev.date) bits.push(ev.date);
  return bits.length ? bits.join(" · ") : EVENT_EMPTY;
}

// "21m", "1h 05m" — a length of time rounded to the minute, for status lines.
function mins(seconds) {
  const m = Math.floor(Math.max(0, seconds || 0) / 60);
  if (m < 1) return "under a minute";
  const h = Math.floor(m / 60);
  return h ? `${h}h ${String(m % 60).padStart(2, "0")}m` : `${m}m`;
}

const TONE = {
  teal: { backgroundColor: COLORS.tealSoft, color: COLORS.teal },
  orange: { backgroundColor: COLORS.orangeSoft, color: COLORS.orange },
  red: { backgroundColor: "rgba(225,90,90,0.16)", color: "#F08A8A" },
  violet: { backgroundColor: COLORS.violetSoft, color: COLORS.violet },
  grey: { backgroundColor: "#1C2028", color: "#C9CED8" },
};
function Chip({ tone = "grey", small, children }) {
  return <span style={TONE[tone]} className={`${small ? "text-[11px] px-2 py-0.5" : "text-xs px-2.5 py-1"} font-semibold rounded-full whitespace-nowrap`}>{children}</span>;
}
function SectionLabel({ children, color, className = "" }) {
  return <p style={{ color: color || COLORS.textMuted }} className={`font-mono text-[11px] tracking-[0.16em] uppercase ${className}`}>{children}</p>;
}

// The tags on a task's line, most useful first.
function chipsFor(task, act, due) {
  const out = [];
  const lv = act.live;
  if (lv) out.push({ key: "live", tone: lv.paused ? "orange" : "teal", text: `${lv.paused ? "Paused" : "Being edited"} · step ${lv.stepIndex} of ${lv.stepCount}` });
  if (task.taskType === "record") out.push({ key: "script", tone: "violet", text: task.recordingLink ? "Script · recorded" : "Script" });
  if (act.pkg && !lv && task.status !== "done") out.push({ key: "pkg", tone: "violet", text: "Package ready" });
  if (act.posted > 0) out.push({ key: "posted", tone: "grey", text: `${act.posted} posted` });
  if (due) out.push({ key: "due", tone: due.tone, text: due.text });
  if (!lv) out.push(task.status === "done" ? { key: "st", tone: "teal", text: "Done" } : task.status === "in_progress" ? { key: "st", tone: "orange", text: "In progress" } : { key: "st", tone: "grey", text: "Pending" });
  return out;
}

const hrefFor = (hash) => `${window.location.origin}${window.location.pathname}${hash}`;
const leaveNote = (key, value) => { try { localStorage.setItem(key, JSON.stringify({ ...value, at: Date.now() })); } catch (e) {} };

function Avatar({ name, tone = "teal", size = 30 }) {
  const st = tone === "grey" ? { backgroundColor: "#1C2028", color: "#C9CED8" } : TONE[tone];
  return <span style={{ ...st, width: size, height: size }} className="rounded-full flex items-center justify-center text-[13px] font-bold shrink-0">{(name || "?").slice(0, 1).toUpperCase()}</span>;
}

// A panel that slides over the right side of the screen, so opening a form or
// a task never moves the list underneath. keepMounted leaves its contents in
// place while closed — that is what keeps a half-written new task.
function Drawer({ open, onClose, label, keepMounted, children, wide }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!open && !keepMounted) return null;
  return (
    <div className="fixed inset-0 z-40" style={{ display: open ? "flex" : "none" }} data-testid="drawer" data-open={open ? "1" : "0"}>
      <button type="button" aria-label="Close panel" onClick={onClose} className="flex-1 cursor-default" style={{ backgroundColor: "rgba(0,0,0,0.6)" }} />
      <aside role="dialog" aria-label={label} style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, maxWidth: wide ? 760 : 620 }}
        className="w-full border-l h-full overflow-y-auto flex flex-col">
        {children}
      </aside>
    </div>
  );
}

export default function TasksScreen({ user, profiles, channels, tasks, runs, isSupervisor, onCreate, onUpdateStatus, onUpdateTask, onDelete, onBack,
  workflows, progress, clipPackages, liveActivity, attendance, targets, teamEditors }) {
  const todayDk = useTodayKey();
  const [panel, setPanel] = useState(null); // null | "new" | "script" | { edit: id }
  const [newKey, setNewKey] = useState(0);  // bumping it clears the new-task draft
  const [preset, setPreset] = useState(null);
  const [statusFilter, setStatusFilter] = useState("active");
  const [assigneeFilter, setAssigneeFilter] = useState("all");
  const [channelFilter, setChannelFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState(null);
  const [showOlderDone, setShowOlderDone] = useState(false);
  const [view, setViewState] = useState(() => { try { return localStorage.getItem("tasks-view") === "board" ? "board" : "queue"; } catch (e) { return "queue"; } });
  const setView = (v) => { setViewState(v); setOpenId(null); try { localStorage.setItem("tasks-view", v); } catch (e) {} };
  const [dragId, setDragId] = useState(null);
  const [overKey, setOverKey] = useState(null);

  const teamMembers = Object.keys(profiles || {}).map((uidVal) => ({ uid: uidVal, name: displayNameFor(uidVal, profiles) }));
  const nameOf = (u) => displayNameFor(u, profiles);
  const baseTasks = isSupervisor ? tasks : tasks.filter((t) => t.assignedToUid === user.uid);
  const actCtx = { liveActivity, clipPackages, runs, workflows };
  const infoOf = (t) => ({ act: taskActivity(t, actCtx), due: dueInfo(t, todayDk), rank: rankOfTask(tasks, t) });

  // Everything except the status tab, so each tab can show its own count.
  const filtered = useMemo(() => baseTasks.filter((t) => {
    if (isSupervisor && assigneeFilter !== "all" && t.assignedToUid !== assigneeFilter) return false;
    if (channelFilter !== "all" && t.channelId !== channelFilter) return false;
    if (typeFilter === "edit" && t.taskType === "record") return false;
    if (typeFilter === "record" && t.taskType !== "record") return false;
    return matchesSearch(t, search, profiles);
  }), [baseTasks, assigneeFilter, channelFilter, typeFilter, search, profiles, isSupervisor]);
  const inTab = (t, tab) => tab === "all" ? true : tab === "active" ? t.status !== "done" : t.status === tab;
  const counts = Object.fromEntries(STATUS_TABS.map(([k]) => [k, filtered.filter((t) => inTab(t, k)).length]));

  // Unfinished tasks in queue order, then finished ones, newest first.
  const orderGroup = (list) => {
    const active = sortByOrder(list.filter((t) => t.status !== "done"));
    const done = list.filter((t) => t.status === "done").sort((a, b) => new Date(b.doneAt || b.createdAt || 0) - new Date(a.doneAt || a.createdAt || 0));
    return [...active, ...done];
  };
  const groups = useMemo(() => {
    const by = {};
    filtered.filter((t) => inTab(t, statusFilter)).forEach((t) => { (by[t.assignedToUid] = by[t.assignedToUid] || []).push(t); });
    return Object.keys(by).sort((a, b) => nameOf(a).localeCompare(nameOf(b))).map((u) => ({ uid: u, tasks: orderGroup(by[u]) }));
  }, [filtered, statusFilter, profiles]); // eslint-disable-line react-hooks/exhaustive-deps

  const applyMove = (taskId, targetUid, index) => planMove(tasks, taskId, targetUid, index).forEach((w) => onUpdateTask(w.id, w.fields));
  const dropOn = (targetUid, beforeTask) => {
    const id = dragId;
    setDragId(null); setOverKey(null);
    if (!id || (beforeTask && beforeTask.id === id)) return;
    const moving = tasks.find((t) => t.id === id);
    if (!moving) return;
    let index = null;
    if (beforeTask) {
      const q = activeQueueFor(tasks, targetUid).filter((t) => t.id !== id);
      index = q.findIndex((t) => t.id === beforeTask.id);
      // Dragging downward within the same queue lands AFTER the card it was dropped on.
      const wasAbove = moving.assignedToUid === targetUid && rankOfTask(tasks, moving) < rankOfTask(tasks, beforeTask);
      if (index === -1) index = null; else if (wasAbove) index += 1;
    }
    applyMove(id, targetUid, index);
  };
  const dragProps = (task) => (isSupervisor && task.status !== "done" ? {
    draggable: true,
    onDragStart: (e) => { setDragId(task.id); try { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", task.id); } catch (err) {} },
    onDragEnd: () => { setDragId(null); setOverKey(null); },
    onDragOver: (e) => { if (dragId && dragId !== task.id) { e.preventDefault(); if (overKey !== task.id) setOverKey(task.id); } },
    onDrop: (e) => { e.preventDefault(); e.stopPropagation(); dropOn(task.assignedToUid, task); },
  } : {});

  const editingTask = panel && panel.edit ? tasks.find((t) => t.id === panel.edit) : null;
  const closePanel = () => setPanel(null);
  const startNew = (assignTo) => { if (assignTo) setPreset({ uid: assignTo, n: Date.now() }); setPanel("new"); };
  const submitTask = ({ _position, ...data }) => {
    if (editingTask) {
      const { assignedToUid, ...rest } = data;
      onUpdateTask(editingTask.id, rest);
      // Handing a task to someone else puts it at the end of their queue rather than wherever its old number lands.
      if (assignedToUid && assignedToUid !== editingTask.assignedToUid) applyMove(editingTask.id, assignedToUid, null);
    } else {
      const extra = {};
      if (_position === "top") {
        const orders = queueForTasks(tasks, data.assignedToUid).map((t) => (t.order != null ? t.order : 0));
        extra.order = Math.min(0, ...orders) - 1;
      }
      onCreate({ ...data, ...extra });
      setNewKey((k) => k + 1);
    }
    closePanel();
  };
  const duplicate = (task) => {
    const { id, status, doneAt, order, createdAt, assignedByUid, recordingLink, ...rest } = task;
    onCreate({ ...rest, title: `${task.title} (copy)` });
  };

  const detailProps = (t) => ({
    task: t, ...infoOf(t), profiles, channels, teamMembers, workflows, progress, user, isSupervisor,
    isMine: t.assignedToUid === user.uid,
    onUpdateStatus,
    onReassign: (u) => applyMove(t.id, u, null),
    onSetRank: (n) => applyMove(t.id, t.assignedToUid, n - 1),
    onEdit: () => setPanel({ edit: t.id }),
    onDuplicate: () => duplicate(t),
    onDelete: () => { if (window.confirm("Delete this task?")) { onDelete(t.id); setOpenId(null); } },
  });
  const rowFor = (t, opts = {}) => {
    const info = infoOf(t);
    return (
      <TaskRow key={t.id} task={t} {...info} open={openId === t.id} onToggle={() => setOpenId(openId === t.id ? null : t.id)}
        channel={channels.find((c) => c.id === t.channelId)} canDrag={isSupervisor && !opts.noDrag} dragProps={opts.noDrag ? {} : dragProps(t)}
        dragging={dragId === t.id} dropTarget={overKey === t.id} canRank={isSupervisor} onSetRank={(n) => applyMove(t.id, t.assignedToUid, n - 1)}>
        <TaskDetail {...detailProps(t)} />
      </TaskRow>
    );
  };

  // What each editor is doing and how today's target stands — shown above their queue.
  const teamNow = useMemo(() => (isSupervisor ? buildTeamNow({ liveActivity, teamEditors, attendance, profiles, now: Date.now() }) : []),
    [isSupervisor, liveActivity, teamEditors, attendance, profiles, todayDk]);
  const personLine = (u) => {
    const r = teamNow.find((x) => x.uid === u);
    if (!r) return null;
    if (r.state === "working") return { tone: COLORS.teal, text: `Working · step ${r.a.stepIndex} of ${r.a.stepCount}` };
    if (r.state === "paused") return { tone: COLORS.orange, text: "Workflow paused" };
    if (r.state === "break") return { tone: COLORS.orange, text: `On a break · ${mins(r.breakFor)}` };
    if (r.state === "idle") return { tone: COLORS.orange, text: "On the clock, no workflow running" };
    if (r.state === "done") return { tone: COLORS.textMuted, text: "Punched out" };
    return { tone: COLORS.textMuted, text: "Not punched in" };
  };
  const targetLine = (u) => {
    const ev = evaluate(resolveTarget(targets || {}, u).target, countsForDay({ uid: u, dk: todayDk, runs, tasks }));
    if (!ev.parts.length) return null;
    return ev.parts.map((p) => `${p.done} of ${p.goal} ${p.label.toLowerCase()}`).join(", ");
  };
  const activeCount = (u) => activeQueueFor(tasks, u).length;

  const headerEl = (
    <header style={{ borderColor: COLORS.border, backgroundColor: COLORS.bgElevated }} className="flex flex-wrap items-center gap-3 px-4 sm:px-6 py-3.5 border-b">
      <button onClick={onBack} aria-label="Home" style={{ borderColor: COLORS.border, color: COLORS.textPrimary }} className="w-11 h-11 flex items-center justify-center rounded-xl border hover:brightness-150 transition-all"><HomeIcon size={18} /></button>
      <h2 style={{ color: COLORS.textPrimary }} className="text-xl font-bold">{isSupervisor ? "Tasks" : "My tasks"}</h2>
      {isSupervisor ? (
        <div role="group" aria-label="View" style={{ borderColor: COLORS.border, backgroundColor: COLORS.bg }} className="flex p-[3px] rounded-xl border">
          {[["queue", "Queue"], ["board", "Board"]].map(([v, label]) => (
            <button key={v} onClick={() => setView(v)} aria-pressed={view === v} data-testid={`view-${v}`}
              style={view === v ? { backgroundColor: COLORS.tealSoft, color: COLORS.teal } : { color: COLORS.textMuted }}
              className="min-h-[38px] px-4 rounded-lg text-[13px] font-bold transition-all">{label}</button>
          ))}
        </div>
      ) : (
        <span style={{ color: COLORS.textMuted }} className="text-[13px]" data-testid="my-summary">
          {activeCount(user.uid)} to do · {baseTasks.filter((t) => t.status === "done" && t.doneAt && dayKey(t.doneAt) === todayDk).length} done today
        </span>
      )}
      <label style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border, flex: "1 1 220px" }} className="min-w-0 min-h-[44px] flex items-center gap-2.5 px-3.5 rounded-xl border">
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={COLORS.textMuted} strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
        <input value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search tasks" data-testid="task-search"
          placeholder={isSupervisor ? "Search by title, committee, person…" : "Search my tasks…"}
          style={{ color: COLORS.textPrimary }} className="flex-1 min-w-0 bg-transparent outline-none text-sm" />
        {search && <button onClick={() => setSearch("")} aria-label="Clear search" style={{ color: COLORS.textMuted }}><X size={14} /></button>}
      </label>
      {isSupervisor && (
        <React.Fragment>
          <button onClick={() => setPanel("script")} style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border, color: COLORS.violet }}
            className="min-h-[44px] px-4 rounded-xl border text-[13px] font-semibold hover:brightness-125 transition-all">Send a script</button>
          <button onClick={() => startNew()} data-testid="new-task" style={{ backgroundColor: COLORS.teal, color: "#04211D" }}
            className="min-h-[44px] px-5 rounded-xl text-sm font-bold hover:brightness-105 transition-all inline-flex items-center gap-1.5"><Plus size={16} /> New task</button>
        </React.Fragment>
      )}
    </header>
  );

  const selectCls = "min-h-[38px] rounded-lg border px-2.5 text-[13px] font-semibold outline-none focus:ring-2";
  const selectStyle = (on) => ({ backgroundColor: COLORS.bgCard, borderColor: on ? COLORS.teal : COLORS.border, color: COLORS.textPrimary });
  const filtersEl = (
    <div style={{ borderColor: COLORS.border }} className="flex flex-wrap items-center gap-x-2 gap-y-2.5 px-4 sm:px-6 py-3 border-b">
      {view === "queue" && STATUS_TABS.map(([val, label]) => (
        <button key={val} onClick={() => setStatusFilter(val)} aria-pressed={statusFilter === val} data-testid={`tab-${val}`}
          style={{ backgroundColor: statusFilter === val ? COLORS.tealSoft : "transparent", color: statusFilter === val ? COLORS.teal : COLORS.textMuted, borderColor: statusFilter === val ? COLORS.teal : COLORS.border }}
          className="min-h-[38px] rounded-lg border px-3 text-[13px] font-semibold transition-all inline-flex items-center gap-2">
          {label} <span style={{ color: statusFilter === val ? COLORS.teal : "#C9CED8" }} className="text-xs font-bold">{counts[val]}</span>
        </button>
      ))}
      {view === "board" && <span style={{ color: COLORS.textMuted }} className="text-[13px]">Drag a card up or down to change the order, or into another column to hand it to that editor.</span>}
      <span className="flex-1" />
      <select value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)} aria-label="Person" data-testid="filter-person" style={selectStyle(assigneeFilter !== "all")} className={selectCls}>
        <option value="all">Everyone</option>
        {teamMembers.map((m) => <option key={m.uid} value={m.uid}>{m.name}</option>)}
      </select>
      {channels.length > 1 && (
        <select value={channelFilter} onChange={(e) => setChannelFilter(e.target.value)} aria-label="Channel" style={selectStyle(channelFilter !== "all")} className={selectCls}>
          <option value="all">All channels</option>
          {channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      )}
      <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label="Type" data-testid="filter-type" style={selectStyle(typeFilter !== "all")} className={selectCls}>
        <option value="all">Edits and scripts</option>
        <option value="edit">Edits only</option>
        <option value="record">Scripts only</option>
      </select>
    </div>
  );

  const groupHeader = (u, extra) => {
    const line = personLine(u), tl = targetLine(u), n = activeCount(u);
    return (
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 px-1 pb-1">
        <Avatar name={nameOf(u)} tone={line && line.tone === COLORS.teal ? "teal" : line && line.tone === COLORS.orange ? "orange" : "grey"} />
        <h3 style={{ color: COLORS.textPrimary }} className="text-base font-bold">{nameOf(u)}</h3>
        <span style={{ color: COLORS.textMuted }} className="text-[13px]">{n} active{line ? " · " : ""}{line && <span style={{ color: line.tone }} className="font-semibold">{line.text}</span>}</span>
        {tl && <span style={{ color: COLORS.textMuted }} className="text-[13px] sm:ml-auto">Today's target: <span style={{ color: COLORS.textPrimary }} className="font-semibold">{tl}</span></span>}
        {extra}
      </div>
    );
  };

  const queueEl = (
    <main className="w-full max-w-5xl mx-auto px-4 sm:px-6 py-6 flex flex-col gap-7" data-testid="queue-view">
      {groups.length === 0 && (
        <p style={{ color: COLORS.textMuted }} className="text-sm text-center py-12" data-testid="no-tasks">
          {tasks.length === 0 ? "No tasks yet. Use New task to assign the first one." : search ? `Nothing matches "${search}".` : "No tasks match these filters."}
        </p>
      )}
      {groups.map((g) => (
        <section key={g.uid} className="flex flex-col gap-2" data-testid={`group-${g.uid}`}
          onDragOver={(e) => { if (dragId) e.preventDefault(); }} onDrop={(e) => { e.preventDefault(); dropOn(g.uid, null); }}>
          {groupHeader(g.uid)}
          {g.tasks.map((t) => rowFor(t))}
        </section>
      ))}
      {statusFilter === "active" && counts.done > 0 && (
        <button onClick={() => setStatusFilter("done")} style={{ borderColor: COLORS.border, color: COLORS.textMuted }}
          className="self-start min-h-[44px] px-4 rounded-xl border text-[13px] font-semibold hover:brightness-125 transition-all">Show done tasks ({counts.done})</button>
      )}
    </main>
  );

  // Board: one column per editor, plus anyone else who currently has work.
  const boardPeople = useMemo(() => {
    const ids = new Set((teamEditors || []).map((e) => e.uid));
    filtered.forEach((t) => { if (t.status !== "done") ids.add(t.assignedToUid); });
    let list = Array.from(ids).filter(Boolean);
    if (assigneeFilter !== "all") list = list.filter((u) => u === assigneeFilter);
    return list.sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  }, [teamEditors, filtered, assigneeFilter, profiles]); // eslint-disable-line react-hooks/exhaustive-deps
  const [doneOpenFor, setDoneOpenFor] = useState(null);
  const boardEl = (
    <main className="flex-1 flex flex-wrap items-start gap-4 px-4 sm:px-6 py-5" data-testid="board-view">
      {boardPeople.length === 0 && <p style={{ color: COLORS.textMuted }} className="text-sm py-12 w-full text-center">No editors on the team yet.</p>}
      {boardPeople.map((u) => {
        const cards = sortByOrder(filtered.filter((t) => t.assignedToUid === u && t.status !== "done"));
        const doneToday = baseTasks.filter((t) => t.assignedToUid === u && t.status === "done" && t.doneAt && dayKey(t.doneAt) === todayDk);
        const line = personLine(u), tl = targetLine(u);
        const colOver = overKey === `col-${u}`;
        return (
          <section key={u} data-testid={`col-${u}`} style={{ backgroundColor: "#0E1014", borderColor: colOver ? COLORS.violet : COLORS.border, flex: "1 1 300px" }}
            className="min-w-0 rounded-2xl border p-3.5 flex flex-col gap-2.5"
            onDragOver={(e) => { if (dragId) { e.preventDefault(); if (overKey !== `col-${u}` && !cards.some((c) => c.id === overKey)) setOverKey(`col-${u}`); } }}
            onDrop={(e) => { e.preventDefault(); dropOn(u, null); }}>
            <div className="flex flex-col gap-1.5 px-1 pb-1">
              <div className="flex items-center gap-2.5">
                <Avatar name={nameOf(u)} tone={line && line.tone === COLORS.teal ? "teal" : line && line.tone === COLORS.orange ? "orange" : "grey"} />
                <h3 style={{ color: COLORS.textPrimary }} className="text-base font-bold truncate">{nameOf(u)}</h3>
                <span style={{ color: COLORS.textMuted }} className="ml-auto text-[13px] shrink-0">{activeCount(u)} active</span>
              </div>
              <p className="text-xs flex flex-wrap gap-x-2.5 gap-y-0.5" style={{ color: COLORS.textMuted }}>
                {line && <span style={{ color: line.tone }} className="font-semibold">{line.text}</span>}
                <span>{tl ? `Target today: ${tl}` : "No target set"}</span>
              </p>
            </div>
            {cards.map((t) => {
              const info = infoOf(t);
              return (
                <article key={t.id} {...dragProps(t)} data-testid={`card-${t.id}`}
                  style={{ backgroundColor: COLORS.bgCard, borderColor: overKey === t.id ? COLORS.violet : info.act.live && !info.act.live.paused ? COLORS.teal : COLORS.border, opacity: dragId === t.id ? 0.45 : 1, cursor: "grab" }}
                  className="rounded-xl border">
                  <button type="button" onClick={() => setOpenId(t.id)} className="w-full text-left p-3 flex flex-col gap-2.5">
                    <span className="flex items-start gap-2.5">
                      <span style={TONE.violet} className="w-[26px] h-[26px] rounded-lg flex items-center justify-center text-xs font-bold shrink-0">{info.rank}</span>
                      <span className="flex-1 min-w-0 flex flex-col gap-0.5">
                        <span style={{ color: COLORS.textPrimary }} className="text-sm font-semibold leading-snug">{t.title}</span>
                        {eventLine(t) && <span style={{ color: COLORS.textMuted }} className="text-xs">{eventLine(t)}</span>}
                      </span>
                      <span aria-hidden="true" style={{ color: COLORS.textFaint, letterSpacing: -2 }} className="text-base select-none">⋮⋮</span>
                    </span>
                    <span className="flex flex-wrap gap-1.5">{chipsFor(t, info.act, info.due).map((c) => <Chip key={c.key} tone={c.tone} small>{c.text}</Chip>)}</span>
                  </button>
                </article>
              );
            })}
            {cards.length === 0 && <p style={{ color: COLORS.textMuted }} className="text-xs px-1 py-2">Nothing in the queue.</p>}
            <button onClick={() => startNew(u)} style={{ borderColor: "#3A4250", color: COLORS.textMuted }}
              className="min-h-[44px] rounded-xl border border-dashed text-[13px] font-semibold hover:brightness-150 transition-all">+ Add a task for {nameOf(u)}</button>
            {doneToday.length > 0 ? (
              <React.Fragment>
                <button onClick={() => setDoneOpenFor(doneOpenFor === u ? null : u)} aria-expanded={doneOpenFor === u} style={{ color: COLORS.textMuted }} className="min-h-[36px] text-xs font-semibold text-left px-1">
                  Done today ({doneToday.length}) {doneOpenFor === u ? "▴" : "▾"}
                </button>
                {doneOpenFor === u && doneToday.map((t) => (
                  <button key={t.id} onClick={() => setOpenId(t.id)} style={{ color: "#C9CED8", borderColor: COLORS.border }} className="text-left text-xs rounded-lg border px-3 py-2 hover:brightness-125">✓ {t.title}</button>
                ))}
              </React.Fragment>
            ) : <span style={{ color: COLORS.textMuted }} className="text-xs px-1 py-1.5">Done today (0)</span>}
          </section>
        );
      })}
    </main>
  );
  const boardOpenTask = view === "board" && isSupervisor && openId ? tasks.find((t) => t.id === openId) : null;

  // The editor's own page: the next task large, everything else one line each.
  const myActive = sortByOrder(filtered.filter((t) => t.status !== "done"));
  const myDone = filtered.filter((t) => t.status === "done").sort((a, b) => new Date(b.doneAt || b.createdAt || 0) - new Date(a.doneAt || a.createdAt || 0));
  const myDoneToday = myDone.filter((t) => t.doneAt && dayKey(t.doneAt) === todayDk);
  const myDoneOlder = myDone.filter((t) => !(t.doneAt && dayKey(t.doneAt) === todayDk));
  const hero = !search.trim() && typeFilter === "all" && channelFilter === "all" ? myActive[0] : null;
  const myRest = hero ? myActive.slice(1) : myActive;
  const doneLine = (t) => {
    const a = taskActivity(t, actCtx);
    return (
      <div key={t.id} style={{ borderColor: COLORS.border }} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 rounded-2xl border" data-testid={`done-${t.id}`}>
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={COLORS.teal} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12.5L9.5 18 20 6" /></svg>
        <span style={{ color: "#C9CED8", flex: "1 1 240px" }} className="min-w-0 text-sm">{t.title}</span>
        <span style={{ color: COLORS.textMuted }} className="text-xs">{a.posted ? `${a.posted} video${a.posted === 1 ? "" : "s"} · ${mins(a.seconds)} tracked` : t.doneAt ? `Finished ${formatDateShort(t.doneAt)}` : ""}</span>
        <button onClick={() => onUpdateStatus(t.id, "in_progress")} style={{ color: COLORS.textMuted }} className="min-h-[40px] px-2 text-xs font-semibold hover:brightness-150">Reopen</button>
      </div>
    );
  };
  const editorEl = (
    <main className="w-full max-w-4xl mx-auto px-4 sm:px-6 py-7 flex flex-col gap-7" data-testid="editor-view">
      {myActive.length === 0 && (
        <p style={{ color: COLORS.textMuted }} className="text-sm text-center py-10" data-testid="no-tasks">
          {search ? `Nothing in your queue matches "${search}".` : "Nothing assigned to you right now."}
        </p>
      )}
      {hero && (
        <section className="flex flex-col gap-2.5" data-testid="next-up">
          <SectionLabel color={COLORS.teal}>Next up</SectionLabel>
          <TaskDetail {...detailProps(hero)} hero />
        </section>
      )}
      {myRest.length > 0 && (
        <section className="flex flex-col gap-2">
          <SectionLabel className="mb-0.5">{hero ? "After that, in this order" : "Your queue"}</SectionLabel>
          {myRest.map((t) => rowFor(t, { noDrag: true }))}
        </section>
      )}
      {(myDoneToday.length > 0 || myDoneOlder.length > 0) && (
        <section className="flex flex-col gap-2">
          <SectionLabel className="mb-0.5">Done today</SectionLabel>
          {myDoneToday.length === 0 && <p style={{ color: COLORS.textMuted }} className="text-sm">Nothing finished yet today.</p>}
          {myDoneToday.map(doneLine)}
          {myDoneOlder.length > 0 && (
            <button onClick={() => setShowOlderDone((o) => !o)} aria-expanded={showOlderDone} style={{ borderColor: COLORS.border, color: COLORS.textMuted }}
              className="self-start min-h-[44px] px-4 rounded-xl border text-[13px] font-semibold hover:brightness-125 transition-all">
              {showOlderDone ? "Hide older done tasks" : `Show older done tasks (${myDoneOlder.length})`}
            </button>
          )}
          {showOlderDone && myDoneOlder.slice(0, 40).map(doneLine)}
        </section>
      )}
    </main>
  );

  return (
    <div className="flex-1 flex flex-col w-full overflow-y-auto fade-in" data-testid="tasks-screen">
      {headerEl}
      {isSupervisor && filtersEl}
      {!isSupervisor ? editorEl : view === "board" ? boardEl : queueEl}

      <Drawer open={!!boardOpenTask} onClose={() => setOpenId(null)} label="Task" wide>
        {boardOpenTask && (
          <div className="p-4 sm:p-5 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <SectionLabel>{nameOf(boardOpenTask.assignedToUid)}'s queue</SectionLabel>
              <button onClick={() => setOpenId(null)} aria-label="Close" style={{ borderColor: COLORS.border, color: COLORS.textMuted }} className="w-11 h-11 rounded-xl border flex items-center justify-center"><X size={16} /></button>
            </div>
            <TaskDetail {...detailProps(boardOpenTask)} standalone />
          </div>
        )}
      </Drawer>

      <Drawer open={panel === "new"} onClose={closePanel} label="New task" keepMounted={isSupervisor}>
        <TaskForm key={`new-${newKey}`} initial={null} teamMembers={teamMembers} channels={channels} onSubmit={submitTask} onCancel={closePanel}
          preset={preset} queueCount={activeCount} onDiscard={() => { setNewKey((k) => k + 1); closePanel(); }} />
      </Drawer>
      <Drawer open={!!editingTask} onClose={closePanel} label="Edit task">
        {editingTask && <TaskForm key={editingTask.id} initial={editingTask} teamMembers={teamMembers} channels={channels} onSubmit={submitTask} onCancel={closePanel} queueCount={activeCount} />}
      </Drawer>
      <Drawer open={panel === "script"} onClose={closePanel} label="Send a script">
        <div className="p-4 sm:p-5">
          <RecordingTaskForm channels={channels} teamMembers={teamMembers} profiles={profiles}
            onSubmit={(data) => { onCreate({ ...data, taskType: "record" }); closePanel(); }} onCancel={closePanel} />
        </div>
      </Drawer>
    </div>
  );
}

// One line of the queue. Opens in place to show the whole task.
function TaskRow({ task, act, due, rank, open, onToggle, channel, canDrag, dragProps, dragging, dropTarget, canRank, onSetRank, children }) {
  const [editingRank, setEditingRank] = useState(false);
  const [rankDraft, setRankDraft] = useState("");
  const done = task.status === "done";
  const meta = [eventLine(task), channel ? channel.name : ""].filter(Boolean).join(" · ");
  const commitRank = () => { const n = parseInt(rankDraft, 10); if (n) onSetRank(n); setEditingRank(false); };
  const liveNow = act.live && !act.live.paused;
  return (
    <article {...(open ? {} : dragProps)} data-testid={`row-${task.id}`} data-open={open ? "1" : "0"}
      style={{ backgroundColor: COLORS.bgCard, borderColor: dropTarget ? COLORS.violet : open || liveNow ? COLORS.teal : due && due.overdue ? COLORS.danger : COLORS.border, opacity: dragging ? 0.45 : 1 }}
      className="rounded-2xl border flex flex-col">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 sm:px-4 py-2.5">
        {canDrag && !done && <span aria-hidden="true" title="Drag to reorder" style={{ color: COLORS.textFaint, letterSpacing: -2, cursor: "grab" }} className="text-base select-none hidden sm:inline">⋮⋮</span>}
        {done ? (
          <span style={TONE.teal} className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" aria-label="Done">
            <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12.5L9.5 18 20 6" /></svg>
          </span>
        ) : canRank && editingRank ? (
          <input autoFocus type="number" min={1} value={rankDraft} aria-label="Position in queue" onChange={(e) => setRankDraft(e.target.value)} onBlur={commitRank}
            onKeyDown={(e) => { if (e.key === "Enter") commitRank(); if (e.key === "Escape") setEditingRank(false); }}
            style={{ ...TONE.violet, borderColor: COLORS.violet }} className="w-12 h-7 rounded-lg border text-center text-[13px] font-bold outline-none shrink-0" />
        ) : (
          <button type="button" disabled={!canRank} onClick={() => { setRankDraft(String(rank)); setEditingRank(true); }} data-testid={`rank-${task.id}`}
            title={canRank ? "Click to type a new position" : `Number ${rank} in the queue`} aria-label={`Position ${rank}${canRank ? ", click to change" : ""}`}
            style={{ ...TONE.violet, cursor: canRank ? "pointer" : "default" }} className="w-7 h-7 rounded-lg flex items-center justify-center text-[13px] font-bold shrink-0">{rank}</button>
        )}
        <button type="button" onClick={onToggle} aria-expanded={open} className="min-w-0 text-left flex flex-col gap-0.5 py-1" style={{ flex: "1 1 260px" }} data-testid={`toggle-${task.id}`}>
          <span style={{ color: done ? "#C9CED8" : COLORS.textPrimary }} className="text-[15px] font-semibold leading-snug">{task.title}</span>
          {meta && <span style={{ color: COLORS.textMuted }} className="text-xs">{meta}</span>}
        </button>
        <span className="flex flex-wrap items-center gap-1.5 flex-1 sm:flex-initial">{chipsFor(task, act, due).map((c) => <Chip key={c.key} tone={c.tone}>{c.text}</Chip>)}</span>
        <button type="button" onClick={onToggle} aria-label={open ? "Close task" : "Open task"} style={{ color: COLORS.textMuted }} className="w-10 h-10 rounded-lg flex items-center justify-center hover:brightness-150 shrink-0">
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }}><path d="M6 9l6 6 6-6" /></svg>
        </button>
      </div>
      {open && children}
    </article>
  );
}

// The buttons that start or resume the workflow for a task. The run opens in
// its own tab already pointed at this task.
function WorkflowButtons({ task, workflows, progress, user, onUpdateStatus, big }) {
  const started = (pr) => pr && !pr.isComplete && ((pr.stepIndex || 0) > 0 || Object.values(pr.stepTimes || {}).some((t) => t > 0));
  const mineOn = (w) => (progress || {})[progKey(w.id, user.uid)];
  const resuming = (workflows || []).find((w) => { const pr = mineOn(w); return started(pr) && pr.taskId === task.id; });
  const list = resuming ? [resuming] : workflowsForTask(task, workflows);
  if (!list.length) return <p style={{ color: COLORS.textMuted }} className="text-xs">No workflow is set up for this channel yet.</p>;
  const cls = `${big ? "min-h-[44px]" : "min-h-[40px]"} px-4 rounded-xl text-[13px] font-bold inline-flex items-center justify-center gap-1.5 transition-all`;
  return (
    <div className="flex flex-col gap-2">
      {list.map((w) => {
        const pr = mineOn(w);
        const busyElsewhere = started(pr) && pr.taskId && pr.taskId !== task.id;
        if (busyElsewhere) {
          return (
            <span key={w.id} className="flex flex-col gap-1">
              <button disabled style={{ backgroundColor: COLORS.bgElevated, color: COLORS.textMuted, cursor: "not-allowed" }} className={cls} data-testid={`wf-busy-${w.id}`}>{w.title}</button>
              <span style={{ color: COLORS.textMuted }} className="text-[11px]">You have this workflow open on another task. Finish or restart it first.</span>
            </span>
          );
        }
        const label = resuming ? "Continue workflow" : list.length > 1 ? `Start: ${w.title}` : "Start workflow";
        return (
          <a key={w.id} href={hrefFor(`#/run/${w.id}`)} target="wfc-run" data-testid={`wf-start-${w.id}`}
            onClick={() => { leaveNote("wfc-run-task", { wf: w.id, task: task.id }); if (task.status === "pending") onUpdateStatus(task.id, "in_progress"); }}
            style={{ backgroundColor: COLORS.teal, color: "#04211D" }} className={`${cls} hover:brightness-105`}>{label}</a>
        );
      })}
    </div>
  );
}

function StudioLink({ task, className, style, children }) {
  return (
    <a href={hrefFor("#/studio")} target="wfc-studio" onClick={() => leaveNote("wfc-studio-task", { task: task.id })} data-testid={`studio-${task.id}`}
      style={style} className={className}>{children || "Open in Clip Studio"}</a>
  );
}

// The whole task. Inside a queue line it sits under the title; `hero` is the
// editor's large "next up" card; `standalone` is the panel opened from the board.
function TaskDetail({ task, act, due, rank, profiles, channels, teamMembers, workflows, progress, user, isSupervisor, isMine, hero, standalone,
  onUpdateStatus, onReassign, onEdit, onDuplicate, onDelete }) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [justDone, setJustDone] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(null);
  const [noteOpen, setNoteOpen] = useState(true);
  const noteImages = Array.isArray(task.editorNoteImages) && task.editorNoteImages.length
    ? task.editorNoteImages
    : (task.editorNoteImage ? [task.editorNoteImage] : []);
  const channel = task.channelId ? channels.find((c) => c.id === task.channelId) : null;
  const isRecord = task.taskType === "record";
  const done = task.status === "done";
  const lv = act.live;
  const box = { backgroundColor: COLORS.bgElevated, borderColor: COLORS.border };
  const ghost = "min-h-[40px] px-3.5 rounded-lg border text-[13px] font-semibold hover:brightness-125 transition-all inline-flex items-center justify-center gap-1.5";

  const noteEl = (task.editorNote || noteImages.length > 0) && (
    <div style={box} className="border rounded-xl overflow-hidden">
      {/* Starts open — this exists specifically so "only edit this
          person's part" doesn't go unseen. The toggle is there for once
          it's been read and is just taking up space. */}
      <button type="button" onClick={() => setNoteOpen((o) => !o)} className="w-full flex items-center gap-2 px-4 py-2.5 text-left" data-testid="note-toggle">
        <span style={{ color: COLORS.orange }} className="font-mono text-[11px] tracking-[0.14em] uppercase font-bold shrink-0">Note to editor</span>
        {!noteOpen && task.editorNote && <span style={{ color: COLORS.textMuted }} className="text-xs truncate min-w-0 flex-1">{task.editorNote}</span>}
        {!noteOpen && noteImages.length > 0 && (
          <span className="flex items-center gap-1 shrink-0">
            <img src={noteImages[0]} alt="" data-testid="note-collapsed-thumb" style={{ borderColor: COLORS.border }} className="w-5 h-5 rounded object-cover border" />
            {noteImages.length > 1 && <span style={{ color: COLORS.textMuted }} className="text-[10px] font-mono">+{noteImages.length - 1}</span>}
          </span>
        )}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
          style={{ color: COLORS.orange, transform: noteOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} className="shrink-0 ml-auto"><polyline points="6 9 12 15 18 9" /></svg>
      </button>
      {noteOpen && (
        <div className="px-4 pb-3.5 flex flex-col gap-2.5">
          {task.editorNote && <p style={{ color: COLORS.textPrimary }} className={`${hero ? "text-[15px]" : "text-sm"} whitespace-pre-wrap leading-relaxed`}>{task.editorNote}</p>}
          {noteImages.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {noteImages.map((src, i) => (
                <button key={i} type="button" onClick={() => setLightboxIndex(i)} className="shrink-0" aria-label="View reference photo full size" data-testid="note-photo-expand">
                  <img src={src} alt="Reference" style={{ borderColor: COLORS.border }} className={`${hero ? "w-[72px] h-[72px]" : "w-16 h-16"} rounded-lg object-cover border hover:opacity-80 transition-opacity`} />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
  const lightboxEl = lightboxIndex !== null && noteImages[lightboxIndex] && (
    <div onClick={() => setLightboxIndex(null)} style={{ backgroundColor: "rgba(0,0,0,0.85)" }} className="fixed inset-0 z-50 flex items-center justify-center p-6 cursor-zoom-out" data-testid="note-lightbox">
      <img src={noteImages[lightboxIndex]} alt="Reference" className="max-w-full max-h-full rounded-xl" />
      {noteImages.length > 1 && <div style={{ color: "rgba(255,255,255,0.7)" }} className="absolute bottom-4 font-mono text-xs">{lightboxIndex + 1} / {noteImages.length}</div>}
    </div>
  );
  const descEl = task.description && <p style={{ color: "#C9CED8" }} className="text-sm leading-relaxed whitespace-pre-wrap">{task.description}</p>;
  const scriptEl = isRecord && (
    <div style={{ backgroundColor: COLORS.violetSoft, borderColor: COLORS.violet }} className="rounded-xl border px-4 py-3">
      <div className="flex items-center justify-between flex-wrap gap-1.5 mb-1.5">
        <p style={{ color: COLORS.violet }} className="font-mono text-[11px] tracking-[0.14em] uppercase font-bold">Script {task.recordingLink ? "· recorded" : ""}</p>
        {((task.longFormCount || 0) + (task.shortsCount || 0)) > 0 && <p style={{ color: COLORS.violet }} className="text-xs">{task.longFormCount || 0} long-form · {task.shortsCount || 0} shorts</p>}
      </div>
      <p style={{ color: "#C9CED8" }} className="text-sm whitespace-pre-wrap leading-relaxed">{task.script}</p>
      {task.recordingLink && <a href={task.recordingLink} target="_blank" rel="noopener noreferrer" style={{ color: COLORS.violet }} className="text-xs underline underline-offset-2 mt-2 inline-block">View recording</a>}
    </div>
  );
  const linksEl = task.links && task.links.length > 0 && (
    <div className="flex flex-col gap-1.5">
      {task.links.map((l, i) => (
        // A section can only be cut by the command-line downloader, so a link
        // with start/end points always gets the command button.
        (isYouTube(l.url) || l.start || l.end)
          ? <YouTubeDownload key={i} link={l} taskTitle={task.title} />
          : (l.isStream || isM3u8(l.url))
          ? <VideoDownload key={i} link={l} taskTitle={task.title} />
          : (
            <a key={i} href={l.url} target="_blank" rel="noopener noreferrer" style={{ ...box, color: COLORS.teal }}
              className="flex items-center gap-2 rounded-lg border px-3 py-2.5 text-[13px] hover:opacity-80 transition-opacity"><LinkIcon size={13} /> {l.label}</a>
          )
      ))}
    </div>
  );
  const originalEl = isSupervisor && task.originalLink && (
    <a href={/^https?:\/\//i.test(task.originalLink) ? task.originalLink : `https://${task.originalLink}`} target="_blank" rel="noopener noreferrer"
      style={{ backgroundColor: COLORS.bgElevated, borderColor: "#3A4250", color: COLORS.orange }}
      className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-2.5 text-xs hover:opacity-80 transition-opacity" data-testid="original-link">
      <LinkIcon size={13} /> <span className="truncate">Original link (admin only) — {task.originalLink}</span>
    </a>
  );

  const markDone = () => {
    setJustDone(true);
    setTimeout(() => onUpdateStatus(task.id, "done"), 550); // let the checkmark finish drawing first
    setTimeout(() => setJustDone(false), 900);
  };
  const doneBtn = isMine && !done && !justDone && (
    <button onClick={markDone} data-testid={`mark-done-${task.id}`} style={{ borderColor: "#3A4250", color: COLORS.textPrimary }} className={`${ghost} ${hero ? "min-h-[44px] px-5 font-bold" : ""}`}>
      {isRecord ? "Mark done" : "Mark task done"}
    </button>
  );
  const justDoneEl = justDone && (
    <span style={TONE.teal} className="rounded-lg px-3.5 min-h-[40px] text-[13px] font-semibold inline-flex items-center gap-1.5">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M4 12.5L9.5 18L20 6" stroke={COLORS.teal} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ strokeDasharray: 48, animation: "checkDraw 0.5s ease-out" }} /></svg>
      Done
    </span>
  );

  const liveText = lv && `${lv.name} · ${lv.workflowTitle} · step ${lv.stepIndex} of ${lv.stepCount}${lv.stepLabel ? " — " + lv.stepLabel : ""}`;
  const liveSecs = lv ? Object.values(lv.stepTimes || {}).reduce((s, t) => s + t, 0) + (lv.paused ? 0 : Math.max(0, (Date.now() - new Date(lv.lastActiveAt).getTime()) / 1000)) : 0;
  const pkgText = act.pkg ? `${act.pkg.videos} video${act.pkg.videos === 1 ? "" : "s"} planned${act.pkg.done ? ` · ${act.pkg.done} marked done` : ""}` : "";
  const runsEl = historyOpen && act.runs.length > 0 && (
    <div className="flex flex-col gap-1.5 mt-2" data-testid="task-runs">
      {[...act.runs].sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt)).map((r) => (
        <div key={r.id} className="flex items-center justify-between gap-2 text-xs">
          <span style={{ color: COLORS.textMuted }} className="truncate">{formatDateShort(r.completedAt)} · {displayNameFor(r.completedByUid, profiles, r.completedBy)}</span>
          <span style={{ color: COLORS.orange }} className="shrink-0 font-semibold">{formatTime(r.totalSeconds)}</span>
        </div>
      ))}
    </div>
  );

  if (hero) {
    const stepCard = "rounded-xl border p-4 flex flex-col gap-2";
    return (
      <article style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.teal }} className="rounded-[18px] border p-5 sm:p-6 flex flex-col gap-5" data-testid={`hero-${task.id}`}>
        <div className="flex flex-wrap items-start gap-3.5">
          <span style={TONE.violet} className="w-10 h-10 rounded-xl flex items-center justify-center text-lg font-bold shrink-0">{rank}</span>
          <div className="min-w-0 flex flex-col gap-1.5" style={{ flex: "1 1 300px" }}>
            <h3 style={{ color: COLORS.textPrimary }} className="text-xl sm:text-2xl font-bold leading-tight">{task.title}</h3>
            <span style={{ color: COLORS.textMuted }} className="text-[13px]">{[eventLine(task), channel ? channel.name : "", `from ${displayNameFor(task.assignedByUid, profiles)}`].filter(Boolean).join(" · ")}</span>
          </div>
          {due && <Chip tone={due.tone}>{due.text}</Chip>}
        </div>
        {noteEl}
        {descEl}
        {scriptEl}
        {!isRecord && (
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))" }}>
            <div style={box} className={stepCard} data-testid="step-video">
              <SectionLabel>1 · Get the video</SectionLabel>
              {linksEl || <p style={{ color: COLORS.textMuted }} className="text-[13px]">No link was attached to this task.</p>}
            </div>
            <div style={box} className={stepCard} data-testid="step-studio">
              <SectionLabel>2 · Titles and descriptions</SectionLabel>
              <span style={{ color: COLORS.textPrimary }} className="text-sm font-semibold">{act.pkg ? "Package ready" : "No package yet"}</span>
              <span style={{ color: COLORS.textMuted }} className="text-xs">{act.pkg ? pkgText : "Add the transcript in Clip Studio to generate one."}</span>
              <StudioLink task={task} style={TONE.violet} className="mt-auto min-h-[44px] rounded-xl text-[13px] font-bold inline-flex items-center justify-center hover:brightness-110 transition-all" />
            </div>
            <div style={box} className={stepCard} data-testid="step-workflow">
              <SectionLabel>3 · Edit and post</SectionLabel>
              <span style={{ color: COLORS.textPrimary }} className="text-sm font-semibold">{lv ? `${lv.workflowTitle} · step ${lv.stepIndex} of ${lv.stepCount}${lv.paused ? " (paused)" : ""}` : "Not started"}</span>
              <span style={{ color: COLORS.textMuted }} className="text-xs">{act.posted ? `${act.posted} video${act.posted === 1 ? "" : "s"} posted from this task` : "Nothing posted from this task yet"}</span>
              <div className="mt-auto"><WorkflowButtons task={task} workflows={workflows} progress={progress} user={user} onUpdateStatus={onUpdateStatus} big /></div>
            </div>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2.5">
          <span style={{ color: COLORS.textMuted }} className="text-[13px]">{isRecord ? "Recorded and sent?" : "Finished every video for this task?"}</span>
          {doneBtn}{justDoneEl}
        </div>
        {lightboxEl}
      </article>
    );
  }

  const progressRow = (color, title, detail, action) => (
    <div style={box} className="flex items-start gap-3 rounded-xl border px-3.5 py-3">
      <span aria-hidden="true" style={{ backgroundColor: color }} className="w-2.5 h-2.5 rounded-full mt-1.5 shrink-0" />
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <span style={{ color: COLORS.textPrimary }} className="text-sm font-semibold">{title}</span>
        {detail}
      </div>
      {action}
    </div>
  );
  const small = (t) => <span style={{ color: COLORS.textMuted }} className="text-xs leading-relaxed">{t}</span>;
  const body = (
    <React.Fragment>
      {standalone && (
        <div className="flex flex-wrap items-start gap-3 px-4 sm:px-5 pt-4">
          {!done && <span style={TONE.violet} className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold shrink-0">{rank}</span>}
          <div className="min-w-0 flex flex-col gap-1" style={{ flex: "1 1 240px" }}>
            <h3 style={{ color: COLORS.textPrimary }} className="text-lg font-bold leading-snug">{task.title}</h3>
            <span style={{ color: COLORS.textMuted }} className="text-xs">{[eventLine(task), channel ? channel.name : ""].filter(Boolean).join(" · ")}</span>
          </div>
          <span className="flex flex-wrap gap-1.5">{chipsFor(task, act, due).map((c) => <Chip key={c.key} tone={c.tone}>{c.text}</Chip>)}</span>
        </div>
      )}
      <div style={{ borderColor: COLORS.border }} className={`flex flex-wrap gap-x-6 gap-y-5 px-4 sm:px-5 pt-4 pb-5 ${standalone ? "" : "border-t"}`} data-testid={`detail-${task.id}`}>
        <div className="min-w-0 flex flex-col gap-4" style={{ flex: "999 1 380px" }}>
          {descEl}
          {noteEl}
          {scriptEl}
          {(linksEl || originalEl) && (
            <div className="flex flex-col gap-2">
              <SectionLabel>Source</SectionLabel>
              {linksEl}
              {originalEl}
            </div>
          )}
          {!descEl && !noteEl && !scriptEl && !linksEl && !originalEl && <p style={{ color: COLORS.textMuted }} className="text-sm">No description, note or links on this task.</p>}
        </div>
        <aside aria-label="Progress on this task" className="min-w-0 flex flex-col gap-2.5" style={{ flex: "1 1 300px" }}>
          <SectionLabel>Progress</SectionLabel>
          {lv && progressRow(lv.paused ? COLORS.orange : COLORS.teal, lv.paused ? "Workflow paused" : "Being edited now", small(`${liveText} · ${mins(liveSecs)} on this video`))}
          {!isRecord && (act.pkg
            ? progressRow(COLORS.violet, "Clip Studio package ready", small(pkgText), <StudioLink task={task} style={{ color: COLORS.teal }} className="text-xs font-semibold whitespace-nowrap py-1">Open</StudioLink>)
            : progressRow(COLORS.textFaint, "No Clip Studio package yet", small("Titles and descriptions have not been generated for this task."), <StudioLink task={task} style={{ color: COLORS.teal }} className="text-xs font-semibold whitespace-nowrap py-1">Open</StudioLink>))}
          {act.runs.length > 0
            ? progressRow(COLORS.teal, `${act.posted} video${act.posted === 1 ? "" : "s"} posted from this task${act.checks ? ` · ${act.checks} check${act.checks === 1 ? "" : "s"}` : ""}`,
              <React.Fragment>{small(`Latest ${formatDateShort(act.last.completedAt)} · ${mins(act.seconds)} tracked in total`)}{runsEl}</React.Fragment>,
              <button onClick={() => setHistoryOpen((o) => !o)} aria-expanded={historyOpen} style={{ color: COLORS.teal }} className="text-xs font-semibold whitespace-nowrap py-1" data-testid="runs-toggle">{historyOpen ? "Hide runs" : "See runs"}</button>)
            : !isRecord && progressRow(COLORS.textFaint, "Nothing posted from this task yet", small("Videos appear here when a workflow linked to this task is finished."))}
          {progressRow(COLORS.textFaint, `Created by ${displayNameFor(task.assignedByUid, profiles)}`,
            small(`${task.createdAt ? formatDateShort(task.createdAt) : ""}${done && task.doneAt ? ` · finished ${formatDateShort(task.doneAt)}` : ""}`))}
        </aside>
      </div>
      <div style={{ borderColor: COLORS.border, backgroundColor: COLORS.bgElevated }} className="flex flex-wrap items-center gap-2 px-3 sm:px-4 py-3 border-t rounded-b-2xl" data-testid={`actions-${task.id}`}>
        {isMine && !done && !isRecord && <WorkflowButtons task={task} workflows={workflows} progress={progress} user={user} onUpdateStatus={onUpdateStatus} />}
        {doneBtn}{justDoneEl}
        {isMine && done && !isSupervisor && <button onClick={() => onUpdateStatus(task.id, "in_progress")} style={{ borderColor: COLORS.border, color: COLORS.textMuted }} className={ghost}>Reopen</button>}
        {isSupervisor && (
          <label className="inline-flex items-center gap-1.5 text-xs" style={{ color: COLORS.textMuted }}>Status
            <select value={task.status || "pending"} onChange={(e) => onUpdateStatus(task.id, e.target.value)} data-testid={`status-${task.id}`}
              style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border, color: COLORS.textPrimary }} className="min-h-[40px] rounded-lg border px-2.5 text-[13px] font-semibold outline-none focus:ring-2">
              <option value="pending">Pending</option><option value="in_progress">In progress</option><option value="done">Done</option>
            </select>
          </label>
        )}
        {isSupervisor && (
          <label className="inline-flex items-center gap-1.5 text-xs" style={{ color: COLORS.textMuted }}>Assigned to
            <select value={task.assignedToUid || ""} onChange={(e) => e.target.value && onReassign(e.target.value)} data-testid={`assign-${task.id}`}
              style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border, color: COLORS.textPrimary }} className="min-h-[40px] rounded-lg border px-2.5 text-[13px] font-semibold outline-none focus:ring-2">
              {teamMembers.map((m) => <option key={m.uid} value={m.uid}>{m.name}</option>)}
            </select>
          </label>
        )}
        {!isRecord && <StudioLink task={task} style={{ borderColor: COLORS.border, color: COLORS.textPrimary }} className={ghost} />}
        <span className="flex-1" />
        {isSupervisor && <button onClick={onDuplicate} style={{ borderColor: "transparent", color: COLORS.textMuted }} className={ghost} data-testid={`dup-${task.id}`}>Duplicate</button>}
        {isSupervisor && <button onClick={onEdit} style={{ borderColor: COLORS.border, color: COLORS.textPrimary }} className={ghost} data-testid={`edit-${task.id}`}><Settings size={13} /> Edit</button>}
        {isSupervisor && <button onClick={onDelete} style={{ borderColor: "transparent", color: "#F08A8A" }} className={ghost}>Delete</button>}
      </div>
      {lightboxEl}
    </React.Fragment>
  );
  if (standalone) return <div style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border }} className="rounded-2xl border flex flex-col">{body}</div>;
  return body;
}

function Label({ children }) {
  return (
    <p style={{ color: COLORS.textMuted }} className="font-mono text-[10px] tracking-[0.15em] uppercase mb-1.5">
      {children}
    </p>
  );
}

// Each person gets their own box instead of everyone being pasted into one
// shared text area — easier to fix a typo in one name without retyping the
// whole list, and it's clearer at a glance how many people are actually on it.
function PersonListBox({ list, setList, placeholder }) {
  const field = { backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, color: COLORS.textPrimary };
  const update = (i, val) => setList(list.map((v, idx) => (idx === i ? val : v)));
  const remove = (i) => setList(list.length > 1 ? list.filter((_, idx) => idx !== i) : [""]);
  const add = () => setList([...list, ""]);
  return (
    <div className="flex flex-col gap-1.5">
      {list.map((v, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <input value={v} onChange={(e) => update(i, e.target.value)} placeholder={i === 0 ? placeholder : "Name — Title, Organization"}
            style={field} className="flex-1 rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2" />
          <button type="button" onClick={() => remove(i)} aria-label="Remove" style={{ color: COLORS.danger }} className="p-1.5 hover:opacity-70 shrink-0">
            <X size={14} />
          </button>
        </div>
      ))}
      <button type="button" onClick={add} style={{ color: COLORS.violet }} className="text-xs font-semibold text-left hover:opacity-80 mt-0.5">
        + Add another
      </button>
    </div>
  );
}

// Deliberately separate from TaskForm rather than adding a type-toggle to it —
// a script assignment is different enough (no links, no status flow the same
// way) that bolting it onto the existing, already-complex form risked
// regressing something that already works well.
function RecordingTaskForm({ channels, teamMembers, profiles, onSubmit, onCancel }) {
  const [title, setTitle] = useState("");
  const [script, setScript] = useState("");
  const [fileName, setFileName] = useState("");
  const [channelId, setChannelId] = useState(channels[0] ? channels[0].id : "");
  const [assignedToUid, setAssignedToUid] = useState("");
  const [editorUid, setEditorUid] = useState("");
  const [longFormCount, setLongFormCount] = useState(1);
  const [shortsCount, setShortsCount] = useState(0);
  const [dueDate, setDueDate] = useState("");

  const loadFile = async (file) => {
    if (!file) return;
    setScript(await file.text());
    setFileName(file.name);
  };

  // Only editors who are actually members of the selected channel — the
  // finished recording needs to land with someone who works on that channel.
  const channelEditors = (() => {
    const ch = channels.find((c) => c.id === channelId);
    const memberUids = new Set((ch && ch.memberUids) || []);
    return teamMembers.filter((m) => memberUids.has(m.uid) && (profiles[m.uid] || {}).role === "editor");
  })();

  const submit = () => {
    if (!title.trim() || !script.trim() || !assignedToUid) return;
    onSubmit({
      title: title.trim(), script: script.trim(), channelId: channelId || null, assignedToUid,
      editorUid: editorUid || null,
      longFormCount: Math.max(0, Number(longFormCount) || 0),
      shortsCount: Math.max(0, Number(shortsCount) || 0),
      dueDate: dueDate || null,
    });
  };

  const field = { backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, color: COLORS.textPrimary };
  const fieldCls = "w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2";

  return (
    <div style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.violet }} className="rounded-2xl border p-5 mb-5">
      <p style={{ color: COLORS.violet }} className="font-mono text-[11px] tracking-[0.2em] uppercase mb-4">New script</p>
      <div className="flex flex-col gap-3">
        <div>
          <Label>Title</Label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Tuesday floor statement" style={field} className={fieldCls} />
        </div>
        <div>
          <Label>Script</Label>
          <label style={{ backgroundColor: COLORS.bgElevated, borderColor: script ? COLORS.violet : COLORS.border }}
            className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed py-4 px-4 cursor-pointer transition-all hover:brightness-110 text-center mb-2">
            <input type="file" accept=".txt,text/plain" className="hidden" onChange={(e) => loadFile(e.target.files && e.target.files[0])} />
            <span style={{ color: script ? COLORS.violet : COLORS.textMuted }} className="text-xs font-semibold">
              {fileName || "Upload a .txt file"}
            </span>
            <span style={{ color: COLORS.textFaint }} className="text-[10px] mt-1">or type it in below</span>
          </label>
          <textarea value={script} onChange={(e) => setScript(e.target.value)} rows={7}
            placeholder="The script text will appear here — edit it directly if needed" style={field} className={`${fieldCls} leading-relaxed`} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Channel</Label>
            <select value={channelId} onChange={(e) => { setChannelId(e.target.value); setEditorUid(""); }} style={field} className={fieldCls}>
              {channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <Label>Who's recording it</Label>
            <select value={assignedToUid} onChange={(e) => setAssignedToUid(e.target.value)} style={field} className={fieldCls}>
              <option value="">Select</option>
              {teamMembers.map((m) => <option key={m.uid} value={m.uid}>{m.name}</option>)}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Long-form videos in this script</Label>
            <input type="number" min="0" value={longFormCount} onChange={(e) => setLongFormCount(e.target.value)} style={field} className={fieldCls} />
          </div>
          <div>
            <Label>Shorts in this script</Label>
            <input type="number" min="0" value={shortsCount} onChange={(e) => setShortsCount(e.target.value)} style={field} className={fieldCls} />
          </div>
        </div>
        <div>
          <Label>Editor for the finished recording (optional)</Label>
          <select value={editorUid} onChange={(e) => setEditorUid(e.target.value)} style={field} className={fieldCls}>
            <option value="">Decide later</option>
            {channelEditors.map((m) => <option key={m.uid} value={m.uid}>{m.name}</option>)}
          </select>
          <p style={{ color: COLORS.textFaint }} className="text-[10.5px] mt-1.5 leading-relaxed">
            Once the recording is sent back, editing tasks go straight to this person — no extra step in between.
          </p>
        </div>
        <div>
          <Label>Due date (optional)</Label>
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} style={field} className={fieldCls} />
        </div>
        <div className="flex gap-2 mt-1">
          <button onClick={submit} disabled={!title.trim() || !script.trim() || !assignedToUid}
            style={{ backgroundColor: COLORS.violet, color: "#1A0B2E", opacity: (!title.trim() || !script.trim() || !assignedToUid) ? 0.4 : 1 }}
            className="flex-1 rounded-xl py-2.5 text-sm font-bold transition-all">
            Send script
          </button>
          <button onClick={onCancel} style={{ borderColor: COLORS.border, color: COLORS.textMuted }}
            className="rounded-xl border px-4 py-2.5 text-sm font-semibold hover:opacity-80">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// One block of the task form. With onToggle it folds away and shows a one-line
// summary of what is in it; without, it is always open.
function FormSection({ title, summary, filled, open = true, onToggle, testid, children }) {
  return (
    <section style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border }} className="rounded-2xl border" data-testid={testid}>
      {onToggle ? (
        <button type="button" onClick={onToggle} aria-expanded={open} className="w-full min-h-[60px] flex items-center gap-3 px-4 py-3 text-left" data-testid={testid ? `${testid}-toggle` : undefined}>
          <span className="flex-1 min-w-0 flex flex-col gap-0.5">
            <span style={{ color: COLORS.textPrimary }} className="text-sm font-bold">{title}</span>
            {!open && <span style={{ color: COLORS.textMuted }} className="text-xs truncate">{summary}</span>}
          </span>
          <Chip tone={filled ? "teal" : "grey"}>{filled ? "Filled in" : "Empty"}</Chip>
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={COLORS.textMuted} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }}><path d="M6 9l6 6 6-6" /></svg>
        </button>
      ) : (
        <h4 style={{ color: COLORS.textPrimary }} className="text-sm font-bold px-4 pt-4">{title}</h4>
      )}
      {open && <div className={`px-4 pb-4 flex flex-col gap-3 ${onToggle ? "" : "pt-3"}`}>{children}</div>}
    </section>
  );
}

function TaskForm({ initial, teamMembers, channels, onSubmit, onCancel, preset, queueCount, onDiscard }) {
  const [position, setPosition] = useState("end");
  const evField = { backgroundColor: COLORS.bgCard, borderColor: COLORS.border, color: COLORS.textPrimary };
  const evCls = "rounded-lg border px-3 py-2 text-xs outline-none focus:ring-2";
  const [title, setTitle] = useState(initial?.title || "");
  const [description, setDescription] = useState(initial?.description || "");
  const [editorNote, setEditorNote] = useState(initial?.editorNote || "");
  // Accepts either the older single-photo shape (editorNoteImage, a lone data
  // URL) or the current array shape, so existing tasks saved before multi-photo
  // was added still show their photo here instead of silently dropping it.
  const [editorNoteImages, setEditorNoteImages] = useState(() => {
    if (Array.isArray(initial?.editorNoteImages)) return initial.editorNoteImages.filter(Boolean);
    return initial?.editorNoteImage ? [initial.editorNoteImage] : [];
  });
  const [imageBusy, setImageBusy] = useState(false);
  const [imageErr, setImageErr] = useState("");
  const MAX_NOTE_IMAGES = 6;
  const [aiContext, setAiContext] = useState(initial?.aiContext || "");
  const [originalLink, setOriginalLink] = useState(initial?.originalLink || "");
  const [assignedToUid, setAssignedToUid] = useState(initial?.assignedToUid || "");
  const [channelId, setChannelId] = useState(initial?.channelId || (channels[0] ? channels[0].id : ""));
  const [dueDate, setDueDate] = useState(initial?.dueDate || "");
  const [linkLabel, setLinkLabel] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [links, setLinks] = useState(initial?.links || []);
  const [linkIsStream, setLinkIsStream] = useState(false);
  const [clipStart, setClipStart] = useState("");
  const [clipEnd, setClipEnd] = useState("");
  const [clipError, setClipError] = useState("");
  const hasExistingEventData = !!(initial && initial.event && (
    initial.event.title || initial.event.committee || initial.event.subcommittee ||
    initial.event.chamber || initial.event.measure || initial.event.organization ||
    initial.event.otherEventType ||
    (initial.event.witnesses && initial.event.witnesses.length) ||
    (initial.event.spokespeople && initial.event.spokespeople.length) ||
    (initial.event.participants && initial.event.participants.length) ||
    initial.event.date || initial.event.location || initial.event.url || initial.event.source
  ));
  const [eventOpen, setEventOpen] = useState(false);
  const [noteSecOpen, setNoteSecOpen] = useState(false);
  const [aiSecOpen, setAiSecOpen] = useState(false);
  // "Add a task for Dhanush" on the board opens the form with the editor already chosen.
  useEffect(() => { if (preset && preset.uid) setAssignedToUid(preset.uid); }, [preset && preset.n]); // eslint-disable-line react-hooks/exhaustive-deps
  // Older saved tasks stored these as one newline-separated string; normalize
  // to a real array either way so the UI can give each person their own box
  // instead of one shared text area to paste a whole list into.
  const toList = (v) => (Array.isArray(v) ? (v.length ? v : [""]) : (v || "").split("\n").map((s) => s.trim()).filter(Boolean).length ? (v || "").split("\n").map((s) => s.trim()).filter(Boolean) : [""]);
  const [ev, setEv] = useState(() => {
    const e = initial?.event || {};
    return {
      sourceType: e.sourceType || "committee", hearingType: e.hearingType || "other",
      title: e.title || "", congress: e.congress || "", committee: e.committee || "", subcommittee: e.subcommittee || "",
      witnesses: toList(e.witnesses),
      chamber: e.chamber || "Senate", measure: e.measure || "",
      organization: e.organization || "", spokespeople: toList(e.spokespeople),
      otherEventType: e.otherEventType || "", participants: toList(e.participants),
      date: e.date || "", location: e.location || "", url: e.url || "", source: e.source || "",
    };
  });

  // Checks the start/end boxes. Returns { start, end } normalised (either may
  // be "") or null after setting a message the person can act on.
  const readClip = () => {
    const start = parseClipTime(clipStart), end = parseClipTime(clipEnd);
    if (start === null || end === null) { setClipError("Times look like 1:21:06, 81:06 or 4866 (seconds)."); return null; }
    if (start && end && clockToSeconds(end) <= clockToSeconds(start)) { setClipError("The end has to be after the start."); return null; }
    setClipError("");
    return { start, end };
  };
  const linkWithClip = (clip) => ({
    label: linkLabel.trim() || linkUrl.trim(),
    url: linkUrl.trim(),
    isStream: linkIsStream || isM3u8(linkUrl),
    ...(clip.start ? { start: clip.start } : {}),
    ...(clip.end ? { end: clip.end } : {}),
  });
  const addLink = () => {
    if (!linkUrl.trim()) return;
    const clip = readClip();
    if (!clip) return;
    setLinks((l) => [...l, linkWithClip(clip)]);
    setLinkLabel(""); setLinkUrl(""); setLinkIsStream(false); setClipStart(""); setClipEnd("");
  };
  const removeLink = (i) => setLinks((l) => l.filter((_, idx) => idx !== i));

  const submit = () => {
    if (!title.trim() || !assignedToUid || !channelId) return;
    // A URL typed but not yet "Added" used to be silently discarded on submit.
    // Treat anything left in the field as intended.
    let pending = [];
    if (linkUrl.trim()) {
      const clip = readClip();
      if (!clip) return; // bad clip time — message is showing next to the boxes
      pending = [linkWithClip(clip)];
    }
    // Drop any empty boxes left over from adding-then-not-filling-in a person entry.
    const cleanEv = { ...ev,
      witnesses: (ev.witnesses || []).map((w) => w.trim()).filter(Boolean),
      spokespeople: (ev.spokespeople || []).map((w) => w.trim()).filter(Boolean),
      participants: (ev.participants || []).map((w) => w.trim()).filter(Boolean),
    };
    onSubmit({
      title, description,
      editorNote: editorNote.trim(),
      editorNoteImages,
      // Keep the old single-image field in sync too, so anything else reading
      // task.editorNoteImage directly (older cached clients, etc.) still gets
      // at least the first photo instead of nothing.
      editorNoteImage: editorNoteImages[0] || null,
      aiContext: aiContext.trim(), assignedToUid,
      originalLink: originalLink.trim(),
      channelId, dueDate: dueDate || null,
      links: [...links, ...pending],
      event: cleanEv,
      ...(initial ? {} : { _position: position }),
    });
  };

  const canSubmit = !!(title.trim() && assignedToUid && channelId);
  const evSummary = summarizeEvent(ev);
  const evFilled = evSummary !== EVENT_EMPTY;
  const noteFilled = !!(editorNote.trim() || editorNoteImages.length);
  const lbl = (text, extra) => <span style={{ color: COLORS.textMuted }} className="text-xs font-semibold">{text}{extra}</span>;
  const hint = (text) => <p style={{ color: COLORS.textMuted }} className="text-xs leading-relaxed">{text}</p>;
  const assigneeName = (teamMembers.find((m) => m.uid === assignedToUid) || {}).name;

  return (
    <div className="flex flex-col min-h-full" data-testid="task-form">
      <div style={{ borderColor: COLORS.border }} className="flex items-center gap-3 px-4 sm:px-6 py-4 border-b">
        <h3 style={{ color: COLORS.textPrimary }} className="flex-1 text-lg font-bold">{initial ? "Edit task" : "New task"}</h3>
        {!initial && onDiscard && (
          <button type="button" onClick={onDiscard} style={{ color: COLORS.textMuted }} className="text-xs font-semibold underline underline-offset-2 hover:brightness-150" data-testid="form-discard">Clear this draft</button>
        )}
        <button onClick={onCancel} aria-label="Close" style={{ borderColor: COLORS.border, color: COLORS.textMuted }} className="w-11 h-11 rounded-xl border flex items-center justify-center hover:brightness-150"><X size={16} /></button>
      </div>
      {!initial && <p style={{ color: COLORS.textMuted }} className="text-xs px-4 sm:px-6 pt-3">Closing this panel keeps what you have typed until you assign the task or clear the draft.</p>}

      <div className="flex-1 px-4 sm:px-6 py-4 flex flex-col gap-3.5">
        <FormSection title="1 · The task">
          <label className="flex flex-col gap-1.5">{lbl("Title")}
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Task title" data-testid="form-title"
        style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, color: COLORS.textPrimary }}
        className="rounded-xl border px-4 py-2.5 text-sm outline-none focus:ring-2" />
          </label>
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
            <label className="flex flex-col gap-1.5 min-w-0">{lbl("Assign to")}
      <select data-testid="form-assignee" value={assignedToUid} onChange={(e) => setAssignedToUid(e.target.value)}
        style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, color: COLORS.textPrimary }}
        className="rounded-xl border px-4 py-2.5 text-sm outline-none focus:ring-2">
        <option value="">Assign to…</option>
        {teamMembers.map((m) => <option key={m.uid} value={m.uid}>{m.name}</option>)}
      </select>
            </label>
            <label className="flex flex-col gap-1.5 min-w-0">{lbl("Channel")}
          <select value={channelId} onChange={(e) => setChannelId(e.target.value)}
            style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, color: COLORS.textPrimary }}
            className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none focus:ring-2">
            <option value="">Choose a channel</option>
            {channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
            </label>
            <label className="flex flex-col gap-1.5 min-w-0">{lbl("Due", " (optional)")}
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)}
            style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, color: COLORS.textPrimary }}
            className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none focus:ring-2" />
            </label>
          </div>
          {!initial && (
            <div className="flex flex-wrap items-center gap-2" data-testid="form-position">
              <span style={{ color: COLORS.textMuted }} className="text-xs">Goes into {assigneeName ? `${assigneeName}'s` : "the"} queue at</span>
              {[["top", "the top"], ["end", assignedToUid && queueCount ? `the end (number ${queueCount(assignedToUid) + 1})` : "the end"]].map(([val, text]) => (
                <button key={val} type="button" onClick={() => setPosition(val)} aria-pressed={position === val} data-testid={`form-pos-${val}`}
                  style={{ backgroundColor: position === val ? COLORS.tealSoft : "transparent", color: position === val ? COLORS.teal : COLORS.textMuted, borderColor: position === val ? COLORS.teal : COLORS.border }}
                  className="min-h-[36px] px-3 rounded-lg border text-xs font-semibold transition-all">{text}</button>
              ))}
            </div>
          )}
          <label className="flex flex-col gap-1.5">{lbl("Instructions", " (optional)")}
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} placeholder="Prompts to use, general notes, how to approach this one…"
          style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, color: COLORS.textPrimary }}
          className="w-full rounded-xl border px-4 py-2.5 text-sm outline-none focus:ring-2" />
          </label>
          {hint("Shown to the editor on the task, and also sent to Clip Studio as background when it generates scripts.")}
        </FormSection>

        <FormSection title="2 · Source video">
        {links.length > 0 && (
          <div className="flex flex-col gap-1.5 mb-2">
            {links.map((l, i) => (
              <div key={i} style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border }} className="flex items-center gap-2 rounded-lg border px-3 py-1.5">
                <LinkIcon size={13} style={{ color: COLORS.teal }} />
                <span style={{ color: COLORS.textPrimary }} className="text-xs flex-1 truncate">{l.label}</span>
                {describeClip(l) && <span style={{ color: COLORS.orange }} className="font-mono text-[10px] shrink-0">clip {describeClip(l)}</span>}
                <button onClick={() => removeLink(i)} style={{ color: COLORS.danger }}><X size={13} /></button>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <input value={linkLabel} onChange={(e) => setLinkLabel(e.target.value)} placeholder="Label"
            style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, color: COLORS.textPrimary }}
            className="w-24 rounded-lg border px-3 py-2 text-xs outline-none focus:ring-2" />
          <input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addLink()} placeholder="https://…"
            style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, color: COLORS.textPrimary }}
            className="flex-1 rounded-lg border px-3 py-2 text-xs outline-none focus:ring-2" />
          <button onClick={addLink} style={{ backgroundColor: COLORS.tealSoft, color: COLORS.teal }} className="rounded-lg px-3 py-2 text-xs font-semibold hover:brightness-110 transition-all">Add</button>
        </div>
        <div className="flex items-center gap-2 mt-2">
          <span style={{ color: COLORS.textMuted }} className="text-[11px] shrink-0">Only download a section:</span>
          <input value={clipStart} onChange={(e) => setClipStart(e.target.value)} placeholder="Start 1:21:06" aria-label="Clip start"
            style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, color: COLORS.textPrimary }}
            className="w-28 rounded-lg border px-2.5 py-1.5 text-xs font-mono outline-none focus:ring-2" data-testid="clip-start" />
          <span style={{ color: COLORS.textFaint }} className="text-xs">to</span>
          <input value={clipEnd} onChange={(e) => setClipEnd(e.target.value)} placeholder="End 2:57:21" aria-label="Clip end"
            style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, color: COLORS.textPrimary }}
            className="w-28 rounded-lg border px-2.5 py-1.5 text-xs font-mono outline-none focus:ring-2" data-testid="clip-end" />
        </div>
        <p style={{ color: clipError ? COLORS.danger : COLORS.textFaint }} className="text-[10px] mt-1" data-testid="clip-note">
          {clipError || "Optional. Leave both empty for the whole video. The editor's Download button then fetches just this part."}
        </p>
        <label className="flex items-center gap-2 mt-2 cursor-pointer">
          <input type="checkbox" checked={linkIsStream || isM3u8(linkUrl)} onChange={(e) => setLinkIsStream(e.target.checked)} />
          <span style={{ color: COLORS.textMuted }} className="text-[11px]">
            Video stream — show a Download button instead of a plain link
          </span>
        </label>
        {linkUrl.trim() && (
          <p style={{ color: COLORS.textFaint }} className="text-[10px] mt-1.5">
            This link will be attached when you save — press Add to queue another.
          </p>
        )}
          <label className="flex flex-col gap-1.5 mt-1"><span style={{ color: COLORS.orange }} className="text-xs font-semibold">Original link · only admins see this</span>
        <input value={originalLink} onChange={(e) => setOriginalLink(e.target.value)} placeholder="Full web page link (not the .m3u8)"
          style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, color: COLORS.textPrimary }}
          className="w-full rounded-lg border px-3 py-2 text-xs outline-none focus:ring-2" />
        <p style={{ color: COLORS.textFaint }} className="text-[10px] mt-1">The page the video came from. Editors never see this.</p>
          </label>
        </FormSection>

        <FormSection title="3 · Event details" summary={evFilled ? evSummary : "The hearing, floor session, briefing or other event this video is from"} filled={evFilled}
          open={eventOpen} onToggle={() => setEventOpen((o) => !o)} testid="sec-event">
          <div className="flex flex-col gap-2">
            <p style={{ color: COLORS.textMuted }} className="text-[11px] leading-relaxed">
              Only for an official record to attach — a hearing, a floor vote, a press briefing, or any other named event. Skip this entirely for a plain video that isn't tied to one. Copy what you fill in from the official page; it's treated as fact, so the studio won't guess or second-guess it.
            </p>

            <div className="flex gap-1.5">
              {[["committee", "Committee"], ["floor", "Floor"], ["briefing", "Briefing"], ["other", "Other"]].map(([val, lbl]) => (
                <button key={val} type="button" onClick={() => setEv({ ...ev, sourceType: val })}
                  style={{
                    backgroundColor: (ev.sourceType || "committee") === val ? COLORS.tealSoft : COLORS.bgCard,
                    color: (ev.sourceType || "committee") === val ? COLORS.teal : COLORS.textMuted,
                    borderColor: (ev.sourceType || "committee") === val ? COLORS.teal : COLORS.border,
                  }}
                  className="flex-1 rounded-lg border px-2 py-1.5 text-[11px] font-semibold transition-all">
                  {lbl}
                </button>
              ))}
            </div>

            {(ev.sourceType || "committee") === "committee" ? (
              <>
                <div className="flex gap-1.5">
                  {[["other", "Hearing"], ["nomination", "Nomination"], ["markup", "Markup"]].map(([val, lbl]) => (
                    <button key={val} type="button" onClick={() => setEv({ ...ev, hearingType: val })}
                      style={{
                        backgroundColor: (ev.hearingType || "other") === val ? COLORS.violetSoft : COLORS.bgCard,
                        color: (ev.hearingType || "other") === val ? COLORS.violet : COLORS.textMuted,
                        borderColor: (ev.hearingType || "other") === val ? COLORS.violet : COLORS.border,
                      }}
                      className="flex-1 rounded-lg border px-2 py-1.5 text-[11px] font-semibold transition-all">
                      {lbl}
                    </button>
                  ))}
                </div>
                <input value={ev.title} onChange={(e) => setEv({ ...ev, title: e.target.value })}
                  placeholder={ev.hearingType === "markup" ? "Markup / business meeting title" : "Hearing title"} style={evField} className={evCls} />
                <input value={ev.committee} onChange={(e) => setEv({ ...ev, committee: e.target.value })}
                  placeholder="Committee" style={evField} className={evCls} />
                <input value={ev.subcommittee} onChange={(e) => setEv({ ...ev, subcommittee: e.target.value })}
                  placeholder="Subcommittee (if any)" style={evField} className={evCls} />
                {ev.hearingType === "markup" ? (
                  <>
                    <input value={ev.measure} onChange={(e) => setEv({ ...ev, measure: e.target.value })}
                      placeholder="Bill or resolution being marked up — e.g. S. 1234, Airspace Safety Act" style={evField} className={evCls} />
                    <p style={{ color: COLORS.textMuted }} className="text-[11px] leading-relaxed">
                      A markup is members debating and voting on amendments among themselves — no outside witnesses the way a hearing has.
                    </p>
                  </>
                ) : (
                  <>
                    <Label>{ev.hearingType === "nomination" ? "Nominees appearing" : "Witnesses"}</Label>
                    <PersonListBox list={ev.witnesses} setList={(list) => setEv({ ...ev, witnesses: list })}
                      placeholder={ev.hearingType === "nomination"
                        ? "Brian Johnson — Director Designate, Consumer Financial Protection Bureau"
                        : "Maria Chen — Air Traffic Manager, FAA"} />
                    <p style={{ color: COLORS.textMuted }} className="text-[11px] leading-relaxed">
                      {ev.hearingType === "nomination"
                        ? "Only those who actually appear in your clip — a hearing may cover more nominees than the ones who speak."
                        : "Copy straight from the hearing page, including their title and organisation."}
                    </p>
                  </>
                )}
              </>
            ) : (ev.sourceType || "committee") === "floor" ? (
              <>
                <div className="flex gap-1.5">
                  {["Senate", "House"].map((c) => (
                    <button key={c} type="button" onClick={() => setEv({ ...ev, chamber: c })}
                      style={{
                        backgroundColor: ev.chamber === c ? COLORS.tealSoft : COLORS.bgCard,
                        color: ev.chamber === c ? COLORS.teal : COLORS.textMuted,
                        borderColor: ev.chamber === c ? COLORS.teal : COLORS.border,
                      }}
                      className="flex-1 rounded-lg border px-2 py-1.5 text-[11px] font-semibold transition-all">
                      {c}
                    </button>
                  ))}
                </div>
                <input value={ev.measure} onChange={(e) => setEv({ ...ev, measure: e.target.value })}
                  placeholder="Bill or resolution, if any — e.g. S. 1234, Airspace Safety Act"
                  style={evField} className={evCls} />
              </>
            ) : (ev.sourceType || "committee") === "briefing" ? (
              <>
                <input value={ev.title} onChange={(e) => setEv({ ...ev, title: e.target.value })}
                  placeholder="Briefing title — e.g. White House Press Briefing" style={evField} className={evCls} />
                <input value={ev.organization} onChange={(e) => setEv({ ...ev, organization: e.target.value })}
                  placeholder="Organization — e.g. The White House, Department of State" style={evField} className={evCls} />
                <Label>Spokespeople</Label>
                <PersonListBox list={ev.spokespeople} setList={(list) => setEv({ ...ev, spokespeople: list })}
                  placeholder="Jane Rivera — Press Secretary, The White House" />
                <p style={{ color: COLORS.textMuted }} className="text-[11px] leading-relaxed">
                  Not a legislative hearing — no committee, no party affiliation on the nameplate. Just the person's title and the organization they speak for.
                </p>
              </>
            ) : (
              <>
                <input value={ev.otherEventType} onChange={(e) => setEv({ ...ev, otherEventType: e.target.value })}
                  placeholder="What kind of event — e.g. campaign rally, book talk, Supreme Court oral argument, panel discussion"
                  style={evField} className={evCls} />
                <Label>Who's speaking</Label>
                <PersonListBox list={ev.participants} setList={(list) => setEv({ ...ev, participants: list })}
                  placeholder={'John Alden — author, "The Long Road"'} />
                <p style={{ color: COLORS.textMuted }} className="text-[11px] leading-relaxed">
                  Anything that isn't a hearing, floor proceeding, or press briefing — a rally, a town hall, a book talk, a panel, oral arguments, whatever it actually is. Describe the event and who's in it; the studio will use good judgment on titles and nameplates from there rather than forcing a format that doesn't fit.
                </p>
              </>
            )}

            <div className="flex gap-2">
              <input type="date" value={ev.date} onChange={(e) => setEv({ ...ev, date: e.target.value })}
                style={evField} className={`${evCls} flex-1`} />
              <input value={ev.congress} onChange={(e) => setEv({ ...ev, congress: e.target.value })}
                placeholder="119th Congress" style={evField} className={`${evCls} flex-1`} />
            </div>
            <input value={ev.location} onChange={(e) => setEv({ ...ev, location: e.target.value })}
              placeholder="Location" style={evField} className={evCls} />
            <p style={{ color: COLORS.textMuted }} className="font-mono text-[10px] tracking-[0.15em] uppercase mt-1">Link</p>
            <input value={ev.url} onChange={(e) => setEv({ ...ev, url: e.target.value })}
              placeholder="Official page URL (for reference)" style={evField} className={evCls} />
            <p style={{ color: COLORS.textMuted }} className="font-mono text-[10px] tracking-[0.15em] uppercase mt-1">Source credit (shown in Clip Studio)</p>
            <input value={ev.source} onChange={(e) => setEv({ ...ev, source: e.target.value })}
              placeholder="e.g. @AtlanticCouncilUS — used exactly as typed" style={evField} className={evCls} />
          </div>
        </FormSection>

        <FormSection title="4 · Note to editor" summary={noteFilled ? (editorNote.trim() || `${editorNoteImages.length} reference photo${editorNoteImages.length === 1 ? "" : "s"}`) : "Instructions and reference photos the editor sees first"} filled={noteFilled}
          open={noteSecOpen} onToggle={() => setNoteSecOpen((o) => !o)} testid="sec-note">
          {hint('Shown to the editor in its own box, apart from the instructions. Good for "only edit this person\'s part" — add reference photos so there is no mistaking who.')}
        <textarea value={editorNote} onChange={(e) => setEditorNote(e.target.value)} rows={2}
          placeholder={'e.g. "Only edit Gavin Newsom\'s part — ignore the other speakers"'}
          style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border, color: COLORS.textPrimary }}
          className="rounded-lg border px-3 py-2 text-xs outline-none focus:ring-2" />

        {editorNoteImages.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {editorNoteImages.map((src, i) => (
              <div key={i} className="relative">
                <img src={src} alt="" style={{ borderColor: COLORS.border }} className="w-14 h-14 rounded-lg object-cover border" />
                <button type="button" aria-label="Remove photo"
                  onClick={() => setEditorNoteImages((imgs) => imgs.filter((_, idx) => idx !== i))}
                  style={{ backgroundColor: COLORS.danger, color: "#fff" }}
                  className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full flex items-center justify-center">
                  <X size={10} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Same "+ Add another" text-link pattern as the witnesses/links
            lists above, instead of a dashed square tile that left a big
            empty gap in the box whenever no photo was attached yet. */}
        {editorNoteImages.length < MAX_NOTE_IMAGES && (
          <label style={{ color: COLORS.orange }} className="inline-flex items-center gap-1.5 cursor-pointer w-fit">
            <Plus size={13} />
            <span className="text-[11px] font-semibold">
              {imageBusy ? "Processing…" : editorNoteImages.length ? "Add another photo" : "Add a reference photo"}
            </span>
            <input type="file" accept="image/*" multiple className="hidden" disabled={imageBusy}
              onChange={async (e) => {
                const files = Array.from(e.target.files || []);
                e.target.value = "";
                if (!files.length) return;
                setImageErr(""); setImageBusy(true);
                try {
                  const room = MAX_NOTE_IMAGES - editorNoteImages.length;
                  const resized = await Promise.all(files.slice(0, room).map((f) => resizeImageFile(f)));
                  setEditorNoteImages((imgs) => [...imgs, ...resized]);
                } catch (err) { setImageErr(err.message || "Couldn't process that image."); }
                finally { setImageBusy(false); }
              }} />
          </label>
        )}
        {imageErr && <p style={{ color: COLORS.danger }} className="text-[10px]">{imageErr}</p>}
        </FormSection>

        <FormSection title="5 · Extra context for Clip Studio" summary={aiContext.trim() || "Background the title and description writer should know"} filled={!!aiContext.trim()}
          open={aiSecOpen} onToggle={() => setAiSecOpen((o) => !o)} testid="sec-ai">
          {hint("Only Clip Studio reads this. The editor never sees it on the task. Use Instructions for anything the editor needs to read.")}
        <textarea value={aiContext} onChange={(e) => setAiContext(e.target.value)} rows={2}
          placeholder="Anything Clip Studio should know that isn't obvious from the transcript — background, why this clip matters, names it might not otherwise recognize"
          style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, color: COLORS.textPrimary }}
          className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none focus:ring-2 leading-relaxed" />
        </FormSection>
      </div>

      <div style={{ borderColor: COLORS.border, backgroundColor: COLORS.bgElevated }} className="sticky bottom-0 flex flex-wrap items-center gap-2.5 px-4 sm:px-6 py-4 border-t">
        <span style={{ color: canSubmit ? COLORS.textMuted : COLORS.orange, flex: "1 1 160px" }} className="text-xs" data-testid="form-need">
          {canSubmit ? "Everything else is optional." : `Still needed: ${[!title.trim() && "a title", !assignedToUid && "an editor", !channelId && "a channel"].filter(Boolean).join(", ")}.`}
        </span>
        <button type="button" onClick={onCancel} style={{ borderColor: COLORS.border, color: COLORS.textMuted }} className="min-h-[44px] px-4 rounded-xl border text-sm font-semibold hover:brightness-125">Cancel</button>
        <button onClick={submit} disabled={!canSubmit} data-testid="form-submit" style={{ backgroundColor: COLORS.teal, color: "#04211D", opacity: canSubmit ? 1 : 0.4 }}
          className="min-h-[44px] px-6 rounded-xl text-sm font-bold hover:brightness-105 transition-all disabled:cursor-not-allowed">
          {initial ? "Save changes" : "Assign task"}
        </button>
      </div>
    </div>
  );
}

function VideoDownload({ link, taskTitle }) {
  const [state, setState] = useState("idle"); // idle | working | done | error
  const [progress, setProgress] = useState({ done: 0, total: 0, phase: "" });
  const [error, setError] = useState(null);
  const [errorCode, setErrorCode] = useState(null);
  const [fallbackCopied, setFallbackCopied] = useState(false);
  // Set only when the clipboard API itself fails (permissions, an insecure
  // context, etc.) — the command still needs to reach the editor somehow, so
  // it's shown in a selectable field instead of the button just doing
  // nothing. A silent failure here is exactly what pushes someone to retype
  // a long command from memory, typos and all, instead of copying it exactly.
  const [manualCommand, setManualCommand] = useState(null);
  const manualInputRef = useRef(null);
  const abortRef = useRef(null);

  const safeName = (taskTitle || link.label || "video").replace(/[^a-z0-9]+/gi, "_").slice(0, 60);

  const start = async () => {
    setState("working"); setError(null); setErrorCode(null); setProgress({ done: 0, total: 0, phase: "manifest" });
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const out = await downloadHls(link.url, {
        signal: controller.signal,
        onProgress: setProgress,
        filenameBase: safeName,
      });
      if (!out.streamed) saveBlob(out.blob, `${safeName}.${out.extension}`);
      setState("done");
    } catch (e) {
      if (e.name === "AbortError") { setState("idle"); return; }
      setErrorCode(e.code || null);
      setError(
        e.code === "CORS"
          ? "This server won't allow the browser to download it directly."
          : (e.message || "Download failed.")
      );
      setState("error");
    } finally {
      abortRef.current = null;
    }
  };

  const copyFallback = async () => {
    const command = ytDlpCommand(link.url, taskTitle || link.label, link.isStream, { start: link.start, end: link.end });
    try {
      await navigator.clipboard.writeText(command);
      setFallbackCopied(true);
      setManualCommand(null);
      setTimeout(() => setFallbackCopied(false), 2500);
    } catch (e) {
      // Clipboard access failed rather than the command itself being bad —
      // fall back to showing it pre-selected so a manual copy still works.
      setManualCommand(command);
      setTimeout(() => manualInputRef.current && manualInputRef.current.select(), 0);
    }
  };

  const cancel = () => { if (abortRef.current) abortRef.current.abort(); };

  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div style={{ backgroundColor: COLORS.bgElevated, borderColor: state === "error" ? COLORS.danger : COLORS.border }}
      className="rounded-lg border px-3 py-2.5">
      <div className="flex items-center gap-2">
        <LinkIcon size={13} style={{ color: COLORS.teal }} />
        <span style={{ color: COLORS.textMuted }} className="text-xs flex-1 truncate">{link.label}</span>

        {state === "idle" && (
          <div className="flex items-center gap-1.5 shrink-0">
            <button onClick={start} style={{ backgroundColor: COLORS.teal, color: "#04211D" }}
              className="rounded-lg px-3 py-1.5 text-xs font-bold hover:brightness-105 transition-all active:scale-[0.98]">
              Download
            </button>
            <button onClick={copyFallback} style={{ backgroundColor: COLORS.violetSoft, color: COLORS.violet }}
              className="rounded-lg px-3 py-1.5 text-xs font-semibold hover:brightness-110 transition-all active:scale-[0.98]">
              {fallbackCopied ? "Copied ✓" : "Copy download command"}
            </button>
          </div>
        )}
        {state === "working" && (
          <button onClick={cancel} style={{ borderColor: COLORS.border, color: COLORS.textMuted }}
            className="rounded-lg border px-3 py-1.5 text-xs font-semibold shrink-0">
            Cancel
          </button>
        )}
        {state === "done" && (
          <span style={{ color: COLORS.teal }} className="font-mono text-[11px] shrink-0">Saved ✓</span>
        )}
        {state === "error" && (
          <button onClick={start} style={{ borderColor: COLORS.border, color: COLORS.textMuted }}
            className="rounded-lg border px-3 py-1.5 text-xs font-semibold shrink-0">
            Retry
          </button>
        )}
      </div>

      {state === "idle" && (
        <p style={{ color: COLORS.textFaint }} className="text-[10px] mt-1.5 leading-relaxed">
          Download saves straight from here. Copy download command is usually faster and more reliable for long or large files — needs yt-dlp installed once, then paste into Terminal.
        </p>
      )}

      {state === "working" && (
        <div className="mt-2">
          <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: COLORS.border }}>
            <div className="h-full rounded-full transition-all duration-200"
              style={{ width: `${pct}%`, backgroundColor: COLORS.teal }} />
          </div>
          <p style={{ color: COLORS.textMuted }} className="font-mono text-[10px] mt-1.5">
            {progress.phase === "manifest"
              ? "Reading playlist…"
              : `${progress.done} / ${progress.total} segments · ${pct}%`}
          </p>
        </div>
      )}

      {state === "error" && (
        <div className="mt-2">
          <p style={{ color: COLORS.danger }} className="text-[11px] leading-relaxed">{error}</p>
          {/* However it failed — CORS, a 403, a timeout, whatever — the
              in-browser pull not working is never the end of the road: the
              copy-command fallback hits the source directly from Terminal
              and sidesteps almost everything that can trip up a fetch()
              call. Used to only show for CORS specifically, which meant any
              other failure (a 403 included) left the editor with nothing
              but "Retry" and no way out if retrying kept failing too. */}
          <button onClick={copyFallback} style={{ backgroundColor: COLORS.tealSoft, color: COLORS.teal }}
            className="rounded-lg px-3 py-1.5 text-xs font-semibold hover:brightness-110 transition-all mt-1.5">
            {fallbackCopied ? "Copied ✓" : "Copy download command instead"}
          </button>
          <p style={{ color: COLORS.textFaint }} className="text-[10px] mt-1.5 leading-relaxed">
            {errorCode === "CORS"
              ? "This server won't let the browser pull it directly. Paste into Terminal and press enter — needs yt-dlp installed once, same tool as the YouTube downloads."
              : "The in-browser download got blocked — often the source server, not this app. Paste into Terminal and press enter instead; needs yt-dlp installed once. If it still fails there too, let your admin know."}
          </p>
        </div>
      )}

      {manualCommand && (
        <div className="mt-2">
          <p style={{ color: COLORS.orange }} className="text-[10px] mb-1 leading-relaxed">
            Couldn't reach the clipboard — select and copy this manually:
          </p>
          <input ref={manualInputRef} readOnly value={manualCommand} onFocus={(e) => e.target.select()}
            style={{ backgroundColor: COLORS.bg, borderColor: COLORS.border, color: COLORS.textMuted }}
            className="w-full rounded-lg border px-2 py-1.5 text-[10px] font-mono outline-none" />
        </div>
      )}
    </div>
  );
}

// Some sources can't be fetched by the browser, so the editor gets a prepared
// command on the clipboard instead. Nothing about the source is shown in the UI.
function YouTubeDownload({ link, taskTitle }) {
  const [copied, setCopied] = useState(false);
  const [manualCommand, setManualCommand] = useState(null);
  const manualInputRef = useRef(null);

  const copy = async () => {
    const command = ytDlpCommand(link.url, taskTitle || link.label, link.isStream, { start: link.start, end: link.end });
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setManualCommand(null);
      setTimeout(() => setCopied(false), 2500);
    } catch (e) {
      setCopied(false);
      // Same reasoning as VideoDownload's fallback above — a silent failure
      // here is exactly what pushes someone to retype the command by hand.
      setManualCommand(command);
      setTimeout(() => manualInputRef.current && manualInputRef.current.select(), 0);
    }
  };

  return (
    <div style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border }} className="rounded-lg border px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <LinkIcon size={13} style={{ color: COLORS.teal }} />
        <span style={{ color: COLORS.textPrimary, flex: "1 1 90px" }} className="text-[13px] font-semibold min-w-0 truncate">{link.label}</span>
        {describeClip(link) && <span style={{ color: COLORS.orange }} className="font-mono text-[10px] shrink-0" data-testid="clip-badge">clip {describeClip(link)}</span>}
        <button onClick={copy} style={{ backgroundColor: COLORS.teal, color: "#04211D" }}
          className="rounded-lg px-3 py-1.5 text-xs font-bold hover:brightness-105 transition-all active:scale-[0.98] shrink-0">
          {copied ? "Copied ✓" : "Download"}
        </button>
      </div>
      {manualCommand && (
        <div className="mt-2">
          <p style={{ color: COLORS.orange }} className="text-[10px] mb-1 leading-relaxed">
            Couldn't reach the clipboard — select and copy this manually:
          </p>
          <input ref={manualInputRef} readOnly value={manualCommand} onFocus={(e) => e.target.select()}
            style={{ backgroundColor: COLORS.bg, borderColor: COLORS.border, color: COLORS.textMuted }}
            className="w-full rounded-lg border px-2 py-1.5 text-[10px] font-mono outline-none" />
        </div>
      )}
    </div>
  );
}

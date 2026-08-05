import React, { useState, useMemo, useRef, useEffect } from "react";
import { displayNameFor, formatFullDate, formatDateShort, formatTime, COLORS } from "../lib/core";
import { HomeIcon, LinkIcon, Plus, X, Settings } from "./Icon";
import { downloadHls, saveBlob, isM3u8, isYouTube, ytDlpCommand } from "../lib/hls";

const STATUS_TABS = [
  ["all", "All"],
  ["pending", "Pending"],
  ["in_progress", "In progress"],
  ["done", "Done"],
];

function isOverdue(task) {
  if (!task.dueDate || task.status === "done") return false;
  return task.dueDate < new Date().toISOString().slice(0, 10);
}
function isDueSoon(task) {
  if (!task.dueDate || task.status === "done" || isOverdue(task)) return false;
  const today = new Date().toISOString().slice(0, 10);
  const in2days = new Date(); in2days.setDate(in2days.getDate() + 2);
  return task.dueDate <= in2days.toISOString().slice(0, 10) && task.dueDate >= today;
}

export default function TasksScreen({ user, profiles, channels, tasks, runs, isSupervisor, onCreate, onUpdateStatus, onUpdateTask, onDelete, onBack }) {
  const [formOpen, setFormOpen] = useState(false);
  const [recordingFormOpen, setRecordingFormOpen] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [assigneeFilter, setAssigneeFilter] = useState("all");

  const teamMembers = Object.keys(profiles || {}).map((uidVal) => ({ uid: uidVal, name: displayNameFor(uidVal, profiles) }));

  const myTasks = tasks.filter((t) => t.assignedToUid === user.uid);
  const baseTasks = isSupervisor ? tasks : myTasks;

  // Rank and reordering are always scoped to ONE person's own full queue —
  // computed from ALL of their tasks, not whatever a status filter happens
  // to be showing right now. Two different people's task lists have no real
  // shared order, so a number that mixed them together would be meaningless
  // the moment more than one person's tasks appear in the same view.
  const sortByOrder = (arr) => [...arr].sort((a, b) => {
    const ao = a.order != null ? a.order : Infinity;
    const bo = b.order != null ? b.order : Infinity;
    if (ao !== bo) return ao - bo;
    return new Date(b.createdAt) - new Date(a.createdAt);
  });
  const queueFor = (uid) => sortByOrder(tasks.filter((t) => t.assignedToUid === uid));
  const rankOf = (task) => queueFor(task.assignedToUid).findIndex((t) => t.id === task.id) + 1;

  const visibleTasks = useMemo(() => {
    let list = [...baseTasks];
    if (statusFilter !== "all") list = list.filter((t) => t.status === statusFilter);
    if (isSupervisor && assigneeFilter !== "all") list = list.filter((t) => t.assignedToUid === assigneeFilter);
    // Grouped by person, each person's own tasks kept together in their own
    // real order — not interleaved with anyone else's. Groups themselves are
    // ordered by name, for a stable layout rather than an arbitrary one.
    const byAssignee = {};
    list.forEach((t) => { (byAssignee[t.assignedToUid] = byAssignee[t.assignedToUid] || []).push(t); });
    const assigneeUids = Object.keys(byAssignee).sort((a, b) => displayNameFor(a, profiles).localeCompare(displayNameFor(b, profiles)));
    return assigneeUids.flatMap((uid) => sortByOrder(byAssignee[uid]));
  }, [baseTasks, statusFilter, assigneeFilter, isSupervisor, tasks, profiles]);

  // Always swaps within the task's own assignee's FULL queue, regardless of
  // any status filter currently narrowing the display — "what's next for
  // this person" should reflect their real, whole queue, not a filtered
  // slice of it.
  const moveTask = (taskId, dir) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    const queue = queueFor(task.assignedToUid);
    const idx = queue.findIndex((t) => t.id === taskId);
    const swapIdx = idx + dir;
    if (idx === -1 || swapIdx < 0 || swapIdx >= queue.length) return;
    const a = queue[idx], b = queue[swapIdx];
    const aOrder = a.order != null ? a.order : 0;
    const bOrder = b.order != null ? b.order : 0;
    onUpdateTask(a.id, { order: bOrder });
    onUpdateTask(b.id, { order: aOrder });
  };

  const startCreate = () => { setEditingTaskId(null); setFormOpen(true); };
  const startEdit = (task) => { setEditingTaskId(task.id); setFormOpen(true); };
  const formRef = useRef(null);
  // The form renders at the top of the page. Clicking Edit on a task further
  // down a long list DID open it — just silently off-screen above whatever
  // the person was actually looking at, which is indistinguishable from the
  // button doing nothing at all. Scroll it into view whenever it opens.
  useEffect(() => {
    if (formOpen && formRef.current) {
      formRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [formOpen, editingTaskId]);
  const closeForm = () => { setFormOpen(false); setEditingTaskId(null); };

  const editingTask = editingTaskId ? tasks.find((t) => t.id === editingTaskId) : null;

  const handleSubmit = (data) => {
    if (editingTask) onUpdateTask(editingTask.id, data);
    else onCreate(data);
    closeForm();
  };

  return (
    <div className="flex-1 flex flex-col max-w-3xl w-full mx-auto px-6 py-8 sm:py-10 overflow-y-auto fade-in">
      <div className="flex items-center justify-between mb-6">
        <h2 style={{ color: COLORS.textPrimary }} className="text-2xl sm:text-3xl font-bold">Tasks</h2>
        <button onClick={onBack} aria-label="Home" style={{ borderColor: COLORS.border, color: COLORS.textMuted }} className="rounded-full border p-2 hover:opacity-80 transition-opacity"><HomeIcon size={18} /></button>
      </div>

      {isSupervisor && (
        <div className="flex gap-2 mb-5">
          <button onClick={formOpen && !editingTask ? closeForm : startCreate}
            style={{ backgroundColor: (formOpen && !editingTask) ? COLORS.tealSoft : COLORS.teal, color: (formOpen && !editingTask) ? COLORS.teal : "#04211D", borderColor: COLORS.teal }}
            className="flex-1 flex items-center justify-center gap-2 rounded-xl border py-3 text-sm font-bold hover:brightness-105 transition-all">
            <Plus size={16} /> {(formOpen && !editingTask) ? "Close" : "Assign new task"}
          </button>
          <button onClick={() => setRecordingFormOpen((o) => !o)}
            style={{ backgroundColor: recordingFormOpen ? COLORS.violetSoft : COLORS.bgElevated, color: recordingFormOpen ? COLORS.violet : COLORS.textMuted, borderColor: recordingFormOpen ? COLORS.violet : COLORS.border }}
            className="flex-1 flex items-center justify-center gap-2 rounded-xl border py-3 text-sm font-bold hover:brightness-105 transition-all">
            <Plus size={16} /> {recordingFormOpen ? "Close" : "Send a script"}
          </button>
        </div>
      )}

      {recordingFormOpen && (
        <RecordingTaskForm channels={channels} teamMembers={teamMembers} profiles={profiles}
          onSubmit={(data) => { onCreate({ ...data, taskType: "record" }); setRecordingFormOpen(false); }}
          onCancel={() => setRecordingFormOpen(false)} />
      )}

      {formOpen && (
        <div ref={formRef}>
          <TaskForm
            key={editingTaskId || "new"}
            initial={editingTask}
            teamMembers={teamMembers}
            channels={channels}
            onSubmit={handleSubmit}
            onCancel={closeForm}
          />
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-2 mb-5 flex-wrap">
        <div className="flex gap-1.5">
          {STATUS_TABS.map(([val, label]) => (
            <button key={val} onClick={() => setStatusFilter(val)}
              style={{ backgroundColor: statusFilter === val ? COLORS.tealSoft : "transparent", color: statusFilter === val ? COLORS.teal : COLORS.textMuted, borderColor: statusFilter === val ? COLORS.teal : COLORS.border }}
              className="rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-all">
              {label}
            </button>
          ))}
        </div>
        {isSupervisor && (
          <select value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)}
            style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, color: COLORS.textPrimary }}
            className="rounded-lg border px-2.5 py-1.5 text-xs outline-none focus:ring-2 ml-auto">
            <option value="all">Everyone</option>
            {teamMembers.map((m) => <option key={m.uid} value={m.uid}>{m.name}</option>)}
          </select>
        )}
      </div>

      <div className="flex flex-col gap-3">
        {visibleTasks.length === 0 && (
          <p style={{ color: COLORS.textFaint }} className="text-sm italic text-center py-10">
            {isSupervisor ? "No tasks match this filter." : "Nothing assigned to you right now."}
          </p>
        )}
        {visibleTasks.map((t, i) => {
          const queue = queueFor(t.assignedToUid);
          const posInQueue = queue.findIndex((x) => x.id === t.id);
          // A name header wherever a new person's group starts — only
          // meaningful once more than one person's tasks share the view.
          const showGroupHeader = isSupervisor && assigneeFilter === "all" && (i === 0 || visibleTasks[i - 1].assignedToUid !== t.assignedToUid);
          return (
            <React.Fragment key={t.id}>
              {showGroupHeader && (
                <p style={{ color: COLORS.textFaint }} className="font-mono text-[10px] tracking-[0.15em] uppercase mt-2 first:mt-0">
                  {displayNameFor(t.assignedToUid, profiles)}
                </p>
              )}
              <TaskCard task={t} profiles={profiles} channels={channels} isSupervisor={isSupervisor} isMine={t.assignedToUid === user.uid}
                overdue={isOverdue(t)} dueSoon={isDueSoon(t)}
                rank={posInQueue + 1} isFirst={posInQueue === 0} isLast={posInQueue === queue.length - 1}
                onMoveUp={() => moveTask(t.id, -1)} onMoveDown={() => moveTask(t.id, 1)}
                taskRuns={(runs || []).filter((r) => r.taskId === t.id)}
                onUpdateStatus={onUpdateStatus} onEdit={() => startEdit(t)} onDelete={onDelete} />
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

function Label({ children }) {
  return (
    <p style={{ color: COLORS.textFaint }} className="font-mono text-[10px] tracking-[0.15em] uppercase mb-1.5">
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

function TaskForm({ initial, teamMembers, channels, onSubmit, onCancel }) {
  const evField = { backgroundColor: COLORS.bgCard, borderColor: COLORS.border, color: COLORS.textPrimary };
  const evCls = "rounded-lg border px-3 py-2 text-xs outline-none focus:ring-2";
  const [title, setTitle] = useState(initial?.title || "");
  const [description, setDescription] = useState(initial?.description || "");
  const [aiContext, setAiContext] = useState(initial?.aiContext || "");
  const [assignedToUid, setAssignedToUid] = useState(initial?.assignedToUid || "");
  const [channelId, setChannelId] = useState(initial?.channelId || (channels[0] ? channels[0].id : ""));
  const [dueDate, setDueDate] = useState(initial?.dueDate || "");
  const [linkLabel, setLinkLabel] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [links, setLinks] = useState(initial?.links || []);
  const [linkIsStream, setLinkIsStream] = useState(false);
  const [eventOpen, setEventOpen] = useState(!!(initial && initial.event && initial.event.title));
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

  const addLink = () => {
    if (!linkUrl.trim()) return;
    setLinks((l) => [...l, {
      label: linkLabel.trim() || linkUrl.trim(),
      url: linkUrl.trim(),
      isStream: linkIsStream || isM3u8(linkUrl),
    }]);
    setLinkLabel(""); setLinkUrl(""); setLinkIsStream(false);
  };
  const removeLink = (i) => setLinks((l) => l.filter((_, idx) => idx !== i));

  const submit = () => {
    if (!title.trim() || !assignedToUid || !channelId) return;
    // A URL typed but not yet "Added" used to be silently discarded on submit.
    // Treat anything left in the field as intended.
    const pending = linkUrl.trim()
      ? [{
          label: linkLabel.trim() || linkUrl.trim(),
          url: linkUrl.trim(),
          isStream: linkIsStream || isM3u8(linkUrl),
        }]
      : [];
    // Drop any empty boxes left over from adding-then-not-filling-in a person entry.
    const cleanEv = { ...ev,
      witnesses: (ev.witnesses || []).map((w) => w.trim()).filter(Boolean),
      spokespeople: (ev.spokespeople || []).map((w) => w.trim()).filter(Boolean),
      participants: (ev.participants || []).map((w) => w.trim()).filter(Boolean),
    };
    onSubmit({
      title, description, aiContext: aiContext.trim(), assignedToUid,
      channelId, dueDate: dueDate || null,
      links: [...links, ...pending],
      event: cleanEv,
    });
  };

  return (
    <div style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border }} className="rounded-2xl border p-5 mb-6 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p style={{ color: COLORS.textFaint }} className="font-mono text-[11px] tracking-[0.2em] uppercase">{initial ? "Edit task" : "New task"}</p>
        <button onClick={onCancel} style={{ color: COLORS.textMuted }}><X size={16} /></button>
      </div>

      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Task title"
        style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, color: COLORS.textPrimary }}
        className="rounded-xl border px-4 py-2.5 text-sm outline-none focus:ring-2" />

      <select value={assignedToUid} onChange={(e) => setAssignedToUid(e.target.value)}
        style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, color: COLORS.textPrimary }}
        className="rounded-xl border px-4 py-2.5 text-sm outline-none focus:ring-2">
        <option value="">Assign to…</option>
        {teamMembers.map((m) => <option key={m.uid} value={m.uid}>{m.name}</option>)}
      </select>

      <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} placeholder="Instructions, prompts to use, notes…"
        style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, color: COLORS.textPrimary }}
        className="rounded-xl border px-4 py-2.5 text-sm outline-none focus:ring-2" />

      <div style={{ borderColor: COLORS.border }} className="border rounded-xl p-3">
        <button onClick={() => setEventOpen((o) => !o)} className="w-full flex items-center justify-between">
          <span style={{ color: COLORS.textFaint }} className="font-mono text-[10px] tracking-[0.15em] uppercase">
            Hearing record
          </span>
          <span style={{ color: COLORS.teal }} className="font-mono text-[10px]">{eventOpen ? "Hide" : "Add"}</span>
        </button>
        {eventOpen && (
          <div className="flex flex-col gap-2 mt-3">
            <p style={{ color: COLORS.textFaint }} className="text-[10px] leading-relaxed">
              Copy this from the official page. It's treated as fact, so the studio won't guess or second-guess it.
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
                    <p style={{ color: COLORS.textFaint }} className="text-[10px] leading-relaxed">
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
                    <p style={{ color: COLORS.textFaint }} className="text-[10px] leading-relaxed">
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
                <p style={{ color: COLORS.textFaint }} className="text-[10px] leading-relaxed">
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
                <p style={{ color: COLORS.textFaint }} className="text-[10px] leading-relaxed">
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
            <input value={ev.url} onChange={(e) => setEv({ ...ev, url: e.target.value })}
              placeholder="Official page URL" style={evField} className={evCls} />
            <input value={ev.source} onChange={(e) => setEv({ ...ev, source: e.target.value })}
              placeholder="Source — used exactly as typed" style={evField} className={evCls} />
          </div>
        )}
      </div>

      <div>
        <p style={{ color: COLORS.textFaint }} className="font-mono text-[10px] tracking-[0.15em] uppercase mb-2">Links (source files, docs, etc.)</p>
        {links.length > 0 && (
          <div className="flex flex-col gap-1.5 mb-2">
            {links.map((l, i) => (
              <div key={i} style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border }} className="flex items-center gap-2 rounded-lg border px-3 py-1.5">
                <LinkIcon size={13} style={{ color: COLORS.teal }} />
                <span style={{ color: COLORS.textPrimary }} className="text-xs flex-1 truncate">{l.label}</span>
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
      </div>

      <div className="flex gap-3">
        <div className="flex-1">
          <p style={{ color: COLORS.textFaint }} className="font-mono text-[10px] tracking-[0.15em] uppercase mb-1.5">Channel</p>
          <select value={channelId} onChange={(e) => setChannelId(e.target.value)}
            style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, color: COLORS.textPrimary }}
            className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none focus:ring-2">
            <option value="">Choose a channel</option>
            {channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="flex-1">
          <p style={{ color: COLORS.textFaint }} className="font-mono text-[10px] tracking-[0.15em] uppercase mb-1.5">Due date (optional)</p>
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)}
            style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, color: COLORS.textPrimary }}
            className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none focus:ring-2" />
        </div>
      </div>

      <div>
        <p style={{ color: COLORS.textFaint }} className="font-mono text-[10px] tracking-[0.15em] uppercase mb-1.5">Context for Clip Studio (optional)</p>
        <textarea value={aiContext} onChange={(e) => setAiContext(e.target.value)} rows={2}
          placeholder="Anything Clip Studio should know that isn't obvious from the transcript — background, why this clip matters, names it might not otherwise recognize"
          style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, color: COLORS.textPrimary }}
          className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none focus:ring-2 leading-relaxed" />
      </div>

      <button onClick={submit} disabled={!title.trim() || !assignedToUid || !channelId} style={{ backgroundColor: COLORS.teal, color: "#04211D", opacity: (!title.trim() || !assignedToUid || !channelId) ? 0.4 : 1 }}
        className="rounded-xl py-3 text-sm font-bold mt-1 hover:brightness-105 transition-all disabled:cursor-not-allowed">
        {initial ? "Save changes" : "Assign task"}
      </button>
    </div>
  );
}

function TaskCard({ task, profiles, channels, isSupervisor, isMine, overdue, dueSoon, rank, isFirst, isLast, onMoveUp, onMoveDown, taskRuns, onUpdateStatus, onEdit, onDelete }) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [justDone, setJustDone] = useState(false);
  const totalOnTask = (taskRuns || []).reduce((s2, r) => s2 + (r.totalSeconds || 0), 0);
  const statusColor = task.status === "done" ? COLORS.teal : task.status === "in_progress" ? COLORS.orange : COLORS.textFaint;
  const statusBg = task.status === "done" ? COLORS.tealSoft : task.status === "in_progress" ? COLORS.orangeSoft : COLORS.bgElevated;
  const channel = task.channelId ? channels.find((c) => c.id === task.channelId) : null;

  return (
    <div style={{ backgroundColor: COLORS.bgCard, borderColor: overdue ? COLORS.danger : dueSoon ? COLORS.orange : COLORS.border }} className="rounded-2xl border p-5">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0 flex items-start gap-3">
          {/* The actual answer to "what order do I work on these" — an
              explicit number, not a hint the person has to interpret. */}
          <div className="flex flex-col items-center shrink-0 mt-0.5">
            {isSupervisor && (
              <button onClick={onMoveUp} disabled={isFirst} aria-label="Move up"
                style={{ color: isFirst ? COLORS.border : COLORS.textFaint }} className="p-0.5 hover:opacity-70 disabled:cursor-not-allowed leading-none">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M6 15l6-6 6 6" /></svg>
              </button>
            )}
            <span style={{ backgroundColor: COLORS.violetSoft, color: COLORS.violet }} className="font-mono text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center my-0.5">
              {rank}
            </span>
            {isSupervisor && (
              <button onClick={onMoveDown} disabled={isLast} aria-label="Move down"
                style={{ color: isLast ? COLORS.border : COLORS.textFaint }} className="p-0.5 hover:opacity-70 disabled:cursor-not-allowed leading-none">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M6 9l6 6 6-6" /></svg>
              </button>
            )}
          </div>
        <div className="min-w-0">
          <p style={{ color: COLORS.textPrimary }} className="font-semibold text-base">{task.title}</p>
          {task.event && (task.event.committee || task.event.chamber || task.event.organization || task.event.otherEventType) && (
            <p style={{ color: COLORS.textMuted }} className="text-[11px] mt-1 truncate">
              {task.event.sourceType === "floor"
                ? `${task.event.chamber || ""} floor`.trim()
                : task.event.sourceType === "briefing"
                ? (task.event.organization || "Press briefing")
                : task.event.sourceType === "other"
                ? (task.event.otherEventType || "Other")
                : (task.event.subcommittee || task.event.committee)}
              {task.event.date ? ` · ${task.event.date}` : ""}
            </p>
          )}
          <p style={{ color: COLORS.textFaint }} className="font-mono text-[11px] mt-1">
            {isSupervisor ? `Assigned to ${displayNameFor(task.assignedToUid, profiles)}` : `From ${displayNameFor(task.assignedByUid, profiles)}`}
            {channel ? ` · ${channel.name}` : ""}
            {task.dueDate ? ` · Due ${formatFullDate(task.dueDate)}` : ""}
          </p>
        </div>
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <span style={{ backgroundColor: statusBg, color: statusColor }} className="font-mono text-[10px] rounded-full px-2.5 py-1">
            {task.status === "done" ? "Done" : task.status === "in_progress" ? "In progress" : "Pending"}
          </span>
          {overdue && (
            <span style={{ backgroundColor: "rgba(225,90,90,0.14)", color: COLORS.danger }} className="font-mono text-[10px] rounded-full px-2.5 py-1">
              Overdue
            </span>
          )}
          {dueSoon && (
            <span style={{ backgroundColor: COLORS.orangeSoft, color: COLORS.orange }} className="font-mono text-[10px] rounded-full px-2.5 py-1">
              Due soon
            </span>
          )}
        </div>
      </div>

      {task.description && (
        <p style={{ color: COLORS.textMuted }} className="text-sm mb-3 whitespace-pre-wrap">{task.description}</p>
      )}

      {task.taskType === "record" && (
        <div style={{ backgroundColor: COLORS.violetSoft, borderColor: COLORS.violet }} className="rounded-lg border px-3 py-2 mb-3">
          <div className="flex items-center justify-between flex-wrap gap-1.5 mb-1">
            <p style={{ color: COLORS.violet }} className="font-mono text-[10px] tracking-[0.15em] uppercase">
              Script {task.recordingLink ? "· recorded" : ""}
            </p>
            {((task.longFormCount || 0) + (task.shortsCount || 0)) > 0 && (
              <p style={{ color: COLORS.violet }} className="font-mono text-[10px]">
                {task.longFormCount || 0} long-form · {task.shortsCount || 0} shorts
              </p>
            )}
          </div>
          <p style={{ color: COLORS.textMuted }} className="text-xs whitespace-pre-wrap leading-relaxed">{task.script}</p>
          {task.recordingLink && (
            <a href={task.recordingLink} target="_blank" rel="noopener noreferrer" style={{ color: COLORS.violet }} className="text-xs underline underline-offset-2 mt-1.5 inline-block">
              View recording
            </a>
          )}
        </div>
      )}

      {task.links && task.links.length > 0 && (
        <div className="flex flex-col gap-1.5 mb-3">
          {task.links.map((l, i) => (
            isYouTube(l.url)
              ? <YouTubeDownload key={i} link={l} taskTitle={task.title} />
              : (l.isStream || isM3u8(l.url))
              ? <VideoDownload key={i} link={l} taskTitle={task.title} />
              : (
                <a key={i} href={l.url} target="_blank" rel="noopener noreferrer"
                  style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, color: COLORS.teal }}
                  className="flex items-center gap-2 rounded-lg border px-3 py-2 text-xs hover:opacity-80 transition-opacity">
                  <LinkIcon size={13} /> {l.label}
                </a>
              )
          ))}
        </div>
      )}

      {taskRuns && taskRuns.length > 0 && (
        <div style={{ borderColor: COLORS.border }} className="border-t mt-3 pt-3">
          <button onClick={() => setHistoryOpen((o) => !o)} className="flex items-center gap-2 w-full text-left">
            <span style={{ color: COLORS.textFaint }} className="font-mono text-[11px] flex-1">
              {taskRuns.length} run{taskRuns.length === 1 ? "" : "s"} · {formatTime(totalOnTask)} on this video
            </span>
            <span style={{ color: COLORS.teal }} className="font-mono text-[11px]">{historyOpen ? "Hide" : "History"}</span>
          </button>
          {historyOpen && (
            <div className="flex flex-col gap-1.5 mt-2">
              {[...taskRuns].sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt)).map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-2">
                  <span style={{ color: COLORS.textMuted }} className="font-mono text-[11px] truncate">
                    {formatDateShort(r.completedAt)} · {displayNameFor(r.completedByUid, profiles, r.completedBy)}
                  </span>
                  <span style={{ color: COLORS.orange }} className="font-mono text-[11px] shrink-0">{formatTime(r.totalSeconds)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-3 mt-3 flex-wrap">
        {isMine && task.status !== "done" && !justDone && (
          <button
            onClick={() => {
              if (task.status === "pending") { onUpdateStatus(task.id, "in_progress"); return; }
              setJustDone(true);
              setTimeout(() => onUpdateStatus(task.id, "done"), 550); // let the checkmark finish drawing first
              setTimeout(() => setJustDone(false), 900); // then hand off to the plain, settled state
            }}
            style={{ backgroundColor: COLORS.tealSoft, color: COLORS.teal }} className="rounded-lg px-3 py-1.5 text-xs font-semibold hover:brightness-110 transition-all active:scale-[0.96]">
            {task.status === "pending" ? "Start" : "Mark done"}
          </button>
        )}
        {justDone && (
          <span style={{ backgroundColor: COLORS.tealSoft, color: COLORS.teal }} className="rounded-lg px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
              <path d="M4 12.5L9.5 18L20 6" stroke={COLORS.teal} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
                style={{ strokeDasharray: 48, animation: "checkDraw 0.5s ease-out" }} />
            </svg>
            Done
          </span>
        )}
        {isMine && task.status === "done" && !justDone && (
          <button onClick={() => onUpdateStatus(task.id, "in_progress")} style={{ color: COLORS.textFaint }} className="text-xs hover:opacity-80">
            Reopen
          </button>
        )}
        {isSupervisor && (
          <button onClick={onEdit} style={{ color: COLORS.textMuted }} className="text-xs font-semibold hover:opacity-80 flex items-center gap-1">
            <Settings size={13} /> Edit
          </button>
        )}
        {isSupervisor && (
          <button onClick={() => { if (window.confirm("Delete this task?")) onDelete(task.id); }} style={{ color: COLORS.danger }} className="text-xs hover:opacity-80 ml-auto">
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

// Pulls an HLS stream straight from its source to this machine. Nothing passes
// through our storage, which is the entire point — but it also means the source
// server has to permit cross-origin reads, and many don't.
function VideoDownload({ link, taskTitle }) {
  const [state, setState] = useState("idle"); // idle | working | done | error
  const [progress, setProgress] = useState({ done: 0, total: 0, phase: "" });
  const [error, setError] = useState(null);
  const [errorCode, setErrorCode] = useState(null);
  const [fallbackCopied, setFallbackCopied] = useState(false);
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
    try {
      await navigator.clipboard.writeText(ytDlpCommand(link.url, taskTitle || link.label));
      setFallbackCopied(true);
      setTimeout(() => setFallbackCopied(false), 2500);
    } catch (e) { /* clipboard unavailable */ }
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
          <button onClick={start} style={{ backgroundColor: COLORS.teal, color: "#04211D" }}
            className="rounded-lg px-3 py-1.5 text-xs font-bold hover:brightness-105 transition-all active:scale-[0.98] shrink-0">
            Download
          </button>
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

      {state === "working" && (
        <div className="mt-2">
          <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: COLORS.border }}>
            <div className="h-full rounded-full transition-all duration-200"
              style={{ width: `${pct}%`, backgroundColor: COLORS.teal }} />
          </div>
          <p style={{ color: COLORS.textFaint }} className="font-mono text-[10px] mt-1.5">
            {progress.phase === "manifest"
              ? "Reading playlist…"
              : `${progress.done} / ${progress.total} segments · ${pct}%`}
          </p>
        </div>
      )}

      {state === "error" && (
        <div className="mt-2">
          <p style={{ color: COLORS.danger }} className="text-[11px] leading-relaxed">{error}</p>
          {errorCode === "CORS" ? (
            <>
              <button onClick={copyFallback} style={{ backgroundColor: COLORS.tealSoft, color: COLORS.teal }}
                className="rounded-lg px-3 py-1.5 text-xs font-semibold hover:brightness-110 transition-all mt-1.5">
                {fallbackCopied ? "Copied ✓" : "Copy download command instead"}
              </button>
              <p style={{ color: COLORS.textFaint }} className="text-[10px] mt-1.5 leading-relaxed">
                Paste into Terminal and press enter. Needs yt-dlp installed once — same tool as the YouTube downloads.
              </p>
            </>
          ) : (
            <p style={{ color: COLORS.textFaint }} className="text-[10px] mt-1.5">
              Let your admin know so they can sort it out.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// Some sources can't be fetched by the browser, so the editor gets a prepared
// command on the clipboard instead. Nothing about the source is shown in the UI.
function YouTubeDownload({ link, taskTitle }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(ytDlpCommand(link.url, taskTitle || link.label));
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch (e) {
      setCopied(false);
    }
  };

  return (
    <div style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border }} className="rounded-lg border px-3 py-2.5">
      <div className="flex items-center gap-2">
        <LinkIcon size={13} style={{ color: COLORS.teal }} />
        <span style={{ color: COLORS.textMuted }} className="text-xs flex-1 truncate">{link.label}</span>
        <button onClick={copy} style={{ backgroundColor: COLORS.teal, color: "#04211D" }}
          className="rounded-lg px-3 py-1.5 text-xs font-bold hover:brightness-105 transition-all active:scale-[0.98] shrink-0">
          {copied ? "Copied ✓" : "Download"}
        </button>
      </div>
    </div>
  );
}

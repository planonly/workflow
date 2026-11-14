import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { COLORS, progKey, formatTime, formatHours, formatDuration, formatClock, formatDateShort, formatFullDate, dayKey, displayNameFor, attendanceWorkedSeconds } from "../lib/core";
import { BarChart2, CalendarIcon, ChannelIcon, ChatIcon, ClipboardIcon, ClockIcon, SparkIcon, Copy, LogOut, Play, Plus, RotateCcw, Settings, TargetIcon, Trash2, Users } from "./Icon";
import { AttendanceWidget, DailyBars, StatCard } from "./shared";
import { MyTargetsCard } from "./TargetsWidget";
import { RevisionsCard } from "./RevisionsPanel";
import { DayBar, DayFigures, TimeLegend } from "./DayTime";
import { computeDay, judgeDay } from "../lib/dayLog";


// Combines the two average-length stats into one card, matching StatCard's
// visual style — this is what lets Checks join the second row without
// leaving it at only two cards: Checks + Time tracked + this combined card
// keeps every row at a clean three, whether or not Checks is present.
function AvgLengthCard({ avgLong, avgShort, longCount, shortsCount }) {
  return (
    <div style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border }} className="rounded-2xl border px-4 py-4">
      <p style={{ color: COLORS.textFaint }} className="font-mono text-[10px] tracking-[0.15em] uppercase mb-1">Avg length</p>
      <div className="flex items-center gap-3">
        <div>
          <p style={{ color: longCount ? COLORS.teal : COLORS.textFaint }} className="text-lg font-bold font-mono leading-none">
            {longCount ? formatTime(avgLong) : "—"}
          </p>
          <p style={{ color: COLORS.textFaint }} className="text-[9px] font-mono mt-1">long</p>
        </div>
        <div style={{ color: COLORS.border }} className="text-lg font-light">|</div>
        <div>
          <p style={{ color: shortsCount ? COLORS.orange : COLORS.textFaint }} className="text-lg font-bold font-mono leading-none">
            {shortsCount ? formatTime(avgShort) : "—"}
          </p>
          <p style={{ color: COLORS.textFaint }} className="text-[9px] font-mono mt-1">short</p>
        </div>
      </div>
    </div>
  );
}

// Small uppercase heading used above every section on this screen.
function SectionLabel({ children, className = "" }) {
  return <p style={{ color: COLORS.textMuted }} className={`font-mono text-[11px] tracking-[0.18em] uppercase ${className}`}>{children}</p>;
}

const TYPE_LABEL = { short: "Short", checking: "Checking", long: "Long" };
const typeColors = (t) => t === "short"
  ? { backgroundColor: COLORS.orangeSoft, color: COLORS.orange }
  : t === "checking" ? { backgroundColor: COLORS.violetSoft, color: COLORS.violet } : { backgroundColor: COLORS.tealSoft, color: COLORS.teal };

// One row per person: what each editor is doing this minute. Built from two
// things that already exist — today's punch record and the live workflow
// progress — so it also catches the gaps between them (on the clock with no
// workflow running; working without having punched in).
// "1h 12m", "12m", "0m" — whole minutes, for the per-person totals.
const hmFmt = (sec) => { const m = Math.floor(Math.max(0, sec || 0) / 60); return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : `${m}m`; };

export function buildTeamNow({ liveActivity, teamEditors, attendance, profiles, runs, now }) {
  const doneToday = {};
  (runs || []).forEach((r) => {
    if (!r.completedByUid || !r.completedAt || dayKey(r.completedAt) !== dayKey(new Date(now).toISOString())) return;
    const d = doneToday[r.completedByUid] || (doneToday[r.completedByUid] = { seconds: 0, count: 0 });
    d.seconds += r.totalSeconds || 0; d.count += 1;
  });
  const today = dayKey(new Date(now).toISOString());
  const live = {};
  (liveActivity || []).forEach((a) => { if (!live[a.uid] || (live[a.uid].paused && !a.paused)) live[a.uid] = a; });
  const people = {};
  (teamEditors || []).forEach((e) => { people[e.uid] = e.name; });
  Object.keys(live).forEach((u) => { if (!people[u]) people[u] = live[u].name; });
  const ORDER = { working: 0, paused: 1, idle: 2, break: 3, done: 4, out: 5 };
  return Object.keys(people).map((uid) => {
    const rec = (attendance || {})[`${uid}_${today}`] || null;
    const a = live[uid] || null;
    const onBreak = !!(rec && !rec.punchOut && rec.onBreak);
    const openBreak = onBreak ? (rec.breaks || []).find((b) => !b.end) : null;
    let state;
    if (onBreak) state = "break";
    else if (a && !a.paused) state = "working";
    else if (a && a.paused && !(rec && rec.punchOut)) state = "paused";
    else if (rec && rec.punchOut) state = "done";
    else if (rec) state = "idle";
    else state = "out";
    const sinceActive = a ? Math.max(0, (now - new Date(a.lastActiveAt).getTime()) / 1000) : 0;
    return {
      uid, name: people[uid] || displayNameFor(uid, profiles), state, rec, a,
      punchedIn: !!rec,
      // Time on this video: everything logged so far, plus the stretch since the last save while the clock is running.
      elapsed: a ? Object.values(a.stepTimes || {}).reduce((s, t) => s + t, 0) + (a.paused ? 0 : sinceActive) : 0,
      pausedFor: a && a.paused ? sinceActive : 0,
      breakFor: openBreak ? Math.max(0, (now - new Date(openBreak.start).getTime()) / 1000) : 0,
      // Two different clocks, shown side by side: "onClock" is punch-in to now
      // minus breaks; "tracked" is time actually spent inside workflows today
      // (finished runs plus the one in progress).
      onClock: rec ? attendanceWorkedSeconds(rec) : 0,
      worked: rec ? attendanceWorkedSeconds(rec) : 0,
      finishedToday: (doneToday[uid] || {}).count || 0,
      tracked: ((doneToday[uid] || {}).seconds || 0) + (a ? Object.values(a.stepTimes || {}).reduce((s, t) => s + t, 0) + (a.paused ? 0 : sinceActive) : 0),
    };
  }).sort((x, y) => ORDER[x.state] - ORDER[y.state] || x.name.localeCompare(y.name));
}

const STATE_STYLE = {
  working: { label: "Working", color: COLORS.teal, soft: COLORS.tealSoft },
  paused: { label: "Paused", color: COLORS.orange, soft: COLORS.orangeSoft },
  idle: { label: "No workflow running", color: COLORS.orange, soft: COLORS.orangeSoft },
  break: { label: "On a break", color: COLORS.orange, soft: COLORS.orangeSoft },
  done: { label: "Punched out", color: COLORS.textMuted, soft: COLORS.bgElevated },
  out: { label: "Not punched in", color: COLORS.textMuted, soft: COLORS.bgElevated },
};

function TeamNow({ liveActivity, teamEditors, attendance, profiles, runs, onPick, onOpenPersonDay, onOpenWeek, expect }) {
  // Keeps the timers moving; the data itself arrives live from the database.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const rows = buildTeamNow({ liveActivity, teamEditors, attendance, profiles, runs, now });
  const count = (s) => rows.filter((r) => r.state === s).length;
  const summary = [
    [count("working"), "working", COLORS.teal],
    [count("paused"), "paused", COLORS.orange],
    [count("idle"), "on the clock, no workflow", COLORS.orange],
    [count("break"), "on a break", COLORS.orange],
    [count("done"), "punched out", COLORS.textMuted],
    [count("out"), "not in", COLORS.textMuted],
  ].filter(([n]) => n > 0);

  return (
    <div style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border }} className="rounded-2xl border p-5 mb-6" data-testid="team-now">
      <div className="flex items-center justify-between gap-x-4 gap-y-2 flex-wrap mb-4">
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="live-dot" style={{ width: 8, height: 8, borderRadius: 9999, backgroundColor: count("working") ? COLORS.teal : COLORS.textFaint, display: "inline-block" }} />
          <SectionLabel>Team right now</SectionLabel>
        </div>
        {onOpenWeek && <button type="button" onClick={onOpenWeek} data-testid="open-week" style={{ color: COLORS.teal }} className="text-xs font-semibold underline underline-offset-2 order-last">This week →</button>}
        <p className="text-xs flex items-center gap-x-3 gap-y-1 flex-wrap" data-testid="team-now-summary">
          {summary.map(([n, label, color]) => (
            <span key={label} style={{ color: COLORS.textMuted }}><span style={{ color }} className="font-bold">{n}</span> {label}</span>
          ))}
        </p>
      </div>
      <TimeLegend className="mb-2" />
      {rows.length === 0 ? (
        <p style={{ color: COLORS.textMuted }} className="text-sm">No editors on the team yet. Add people from your profile and team settings.</p>
      ) : (
        <div className="flex flex-col">
          {rows.map((r, i) => {
            const st = STATE_STYLE[r.state];
            const a = r.a;
            const dim = r.state === "out" || r.state === "done";
            let main, sub;
            if (r.state === "working" || r.state === "paused") {
              main = a.taskTitle || a.workflowTitle;
              sub = `${a.taskTitle ? a.workflowTitle + " · " : ""}Step ${a.stepIndex} of ${a.stepCount}${a.stepLabel ? " — " + a.stepLabel : ""} · ${r.state === "paused" ? `paused for ${hmFmt(r.pausedFor)}` : `${formatDuration(r.elapsed)} on this video`}`;
            } else if (r.state === "break") {
              main = `On a break for ${hmFmt(r.breakFor)}`;
              sub = a ? `Left off: ${a.taskTitle || a.workflowTitle} · step ${a.stepIndex} of ${a.stepCount}` : `Punched in at ${formatClock(r.rec.punchIn)}`;
            } else if (r.state === "idle") {
              main = `Punched in at ${formatClock(r.rec.punchIn)}`;
              sub = r.tracked >= 60 ? "No workflow running right now" : "On the clock, but no workflow time yet today";
            } else if (r.state === "done") {
              main = `${formatClock(r.rec.punchIn)} to ${formatClock(r.rec.punchOut)}`;
              sub = "";
            } else {
              main = "Not punched in today";
              sub = "";
            }
            // The right-hand figure is the same for everyone: time inside workflows today, with time on the clock under it.
            return (
              <button key={r.uid} type="button" onClick={() => (r.punchedIn && onOpenPersonDay ? onOpenPersonDay(r.uid) : onPick && onPick(r.uid))} data-testid={`team-now-${r.uid}`} data-state={r.state}
                title={r.punchedIn ? `Open ${r.name}'s day` : `Show ${r.name}'s numbers below`}
                style={{ borderTop: i ? `1px solid ${COLORS.border}` : "none", opacity: dim ? 0.72 : 1 }}
                className="flex flex-wrap items-center gap-x-5 gap-y-3 py-3.5 text-left w-full hover:brightness-125 transition-all">
                <div className="flex items-center gap-3 min-w-0" style={{ flex: "1 1 280px" }}>
                <div className="relative shrink-0">
                  <div style={{ backgroundColor: st.soft, color: st.color }} className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm">
                    {r.name.slice(0, 1).toUpperCase()}
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-x-2 gap-y-1 flex-wrap">
                    <span style={{ color: COLORS.textPrimary }} className="text-sm font-semibold">{r.name}</span>
                    <span style={{ backgroundColor: st.soft, color: st.color }} className="text-[11px] font-semibold rounded-full px-2 py-0.5">{st.label}</span>
                    {a && r.state !== "break" && <span style={typeColors(a.contentType)} className="text-[11px] font-semibold rounded-full px-2 py-0.5">{TYPE_LABEL[a.contentType] || "Long"}</span>}
                    {(r.state === "working" || r.state === "paused") && !r.punchedIn && (
                      <span style={{ backgroundColor: "rgba(225,90,90,0.14)", color: COLORS.danger }} className="text-[11px] font-semibold rounded-full px-2 py-0.5" data-testid={`team-now-nopunch-${r.uid}`}>Not punched in</span>
                    )}
                  </div>
                  {(r.state !== "out") && (
                    <p style={{ color: dim ? COLORS.textMuted : COLORS.textPrimary }} className="text-sm mt-1 sm:truncate">{main}</p>
                  )}
                  {sub && <p style={{ color: COLORS.textMuted }} className="text-xs mt-0.5 sm:truncate">{sub}</p>}
                  {(r.state === "working" || r.state === "paused") && a.stepCount > 0 && (
                    <div role="progressbar" aria-label={`${r.name}: step ${a.stepIndex} of ${a.stepCount}`} aria-valuemin={0} aria-valuemax={a.stepCount} aria-valuenow={a.stepIndex - 1}
                      className="flex gap-1 mt-2" style={{ maxWidth: 260 }}>
                      {Array.from({ length: a.stepCount }).map((_, k) => (
                        <span key={k} style={{ flex: 1, height: 4, borderRadius: 9999, backgroundColor: k < a.stepIndex - 1 ? st.color : k === a.stepIndex - 1 ? st.color : COLORS.border, opacity: k === a.stepIndex - 1 ? 0.45 : 1 }} />
                      ))}
                    </div>
                  )}
                </div>
                </div>
                {r.punchedIn && (() => {
                  const day = computeDay({ uid: r.uid, rec: r.rec, runs, live: liveActivity, now });
                  const t = day.totals;
                  const bad = judgeDay(day, expect);
                  const high = (bad.judged && !bad.ok) || t.un >= 1800;
                  return (
                    <div className="min-w-0 flex flex-col gap-1.5" style={{ flex: "1 1 260px" }} data-testid={`team-now-time-${r.uid}`}>
                      <div className="flex items-baseline justify-between gap-2.5">
                        <span className="text-sm" style={{ color: COLORS.textMuted }}><span style={{ color: COLORS.textPrimary, fontVariantNumeric: "tabular-nums" }} className="text-lg font-bold">{hmFmt(t.wf)}</span> in workflows</span>
                        <span style={{ color: high ? COLORS.orange : COLORS.textMuted, fontVariantNumeric: "tabular-nums" }} className={`text-[13px] ${high ? "font-bold" : ""}`}>{hmFmt(t.un)} unexplained</span>
                      </div>
                      <DayBar day={day} />
                      <span style={{ color: COLORS.textMuted }} className="text-xs">
                        of {hmFmt(t.clock)} on the clock{day.finished ? ` · ${day.finished} finished` : ""}{t.dl >= 60 ? ` · ${hmFmt(t.dl)} downloading` : ""}{t.cs >= 60 ? ` · ${hmFmt(t.cs)} Clip Studio` : ""}{t.ex >= 60 ? ` · ${hmFmt(t.ex)} explained` : ""}
                      </span>
                    </div>
                  );
                })()}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// One labelled destination in the bar under the title.
function NavItem({ icon, label, badge, badgeTone, onClick, href, target, title, testid }) {
  const inner = (
    <>
      {icon}
      <span>{label}</span>
      {badge > 0 && (
        <span style={badgeTone === "teal" ? { backgroundColor: COLORS.teal, color: "#04211D" } : { backgroundColor: COLORS.orange, color: "#2A1200" }}
          className="rounded-full min-w-[18px] h-[18px] px-1 text-[10px] font-bold flex items-center justify-center">
          {badge > 9 ? "9+" : badge}
        </span>
      )}
    </>
  );
  const cls = "shrink-0 inline-flex items-center gap-2 rounded-xl border px-2.5 py-2.5 text-[13px] font-semibold transition-all hover:brightness-150 active:scale-95";
  const style = { borderColor: COLORS.border, color: COLORS.textPrimary, backgroundColor: COLORS.bgCard };
  if (href) return <a href={href} target={target} aria-label={label} title={title} style={style} className={cls} data-testid={testid}>{inner}</a>;
  return <button type="button" onClick={onClick} aria-label={label} title={title} style={style} className={cls} data-testid={testid}>{inner}</button>;
}

export default function Dashboard({ user, profiles, workflows, runs, progress, channels, syncStatus, canManage, isSupervisor, canManageChannels, myAttendance, onPunchIn, onStartBreak, onEndBreak, onPunchOut, onUndoPunchOut, myPendingTaskCount, onOpenTasks, pendingAttendanceCount, onOpenAttendance, onOpenMessages, unreadRoomCount, onCreate, onEditWorkflow, onDeleteWorkflow, onDuplicateWorkflow, onRestartWorkflow, onOpenInsights, onSignOut, onCreateChannel, onOpenChannel, onDeleteChannel, liveActivity, teamEditors, attendance, onOpenProfile, onOpenDay, targetsCtx, onOpenTargets, revisionsCtx, myDay, tracksTime, onOpenMyDay, onOpenPersonDay, onOpenWeek, timeExpect }) {
  const [openMenuId, setOpenMenuId] = useState(null);
  const [confirmId, setConfirmId] = useState(null);
  const [filterUid, setFilterUid] = useState("all");
  const [newChannelOpen, setNewChannelOpen] = useState(false);
  const [newChannelName, setNewChannelName] = useState("");
  const [search, setSearch] = useState("");
  const [teamStatsSearch, setTeamStatsSearch] = useState("");
  const [rangePreset, setRangePreset] = useState("today");
  const [customStart, setCustomStart] = useState(dayKey(new Date().toISOString()));
  const [customEnd, setCustomEnd] = useState(dayKey(new Date().toISOString()));

  const videosFor = (channelId) => {
    const wfIds = new Set(workflows.filter((w) => w.channelId === channelId).map((w) => w.id));
    return runs.filter((r) => wfIds.has(r.workflowId)).length;
  };
  const editorsFor = (channel) => (channel.memberUids || []).length;
  const submitNewChannel = () => {
    if (!newChannelName.trim()) return;
    onCreateChannel(newChannelName);
    setNewChannelName("");
    setNewChannelOpen(false);
  };

  const teamUids = useMemo(() => {
    const s = new Set(Object.keys(profiles || {}));
    runs.forEach((r) => { if (r.completedByUid) s.add(r.completedByUid); });
    return Array.from(s);
  }, [profiles, runs]);

  // Date range. Defaults to today: an ops dashboard should answer "what happened
  // today" first — all-time totals stop being actionable once data piles up.
  const todayKey = () => dayKey(new Date().toISOString());
  const shiftKey = (days) => {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return dayKey(d.toISOString());
  };
  const RANGE_PRESETS = [
    ["today", "Today"],
    ["7d", "7 days"],
    ["30d", "30 days"],
    ["all", "All time"],
    ["custom", "Custom"],
  ];
  const range = useMemo(() => {
    if (rangePreset === "today") return { start: todayKey(), end: todayKey() };
    if (rangePreset === "7d") return { start: shiftKey(6), end: todayKey() };
    if (rangePreset === "30d") return { start: shiftKey(29), end: todayKey() };
    if (rangePreset === "custom") return { start: customStart, end: customEnd };
    return { start: null, end: null }; // all time
  }, [rangePreset, customStart, customEnd]);

  const inRange = (r) => {
    if (!range.start || !range.end) return true;
    const k = dayKey(r.completedAt);
    return k >= range.start && k <= range.end;
  };

  const runsByUser = filterUid === "all" ? runs : runs.filter((r) => r.completedByUid === filterUid);
  const runsFiltered = runsByUser.filter(inRange);
  const workflowById = useMemo(() => {
    const m = {};
    workflows.forEach((w) => { m[w.id] = w; });
    return m;
  }, [workflows]);
  const totalRuns = runsFiltered.filter((r) => (workflowById[r.workflowId] || {}).contentType !== "checking").length;
  const totalTime = runsFiltered.reduce((s, r) => s + r.totalSeconds, 0);
  const workflowsTouched = new Set(runsFiltered.map((r) => r.workflowId)).size;
  const avgSession = totalRuns ? totalTime / totalRuns : 0;

  const isShort = (r) => (workflowById[r.workflowId] || {}).contentType === "short";
  const isChecking = (r) => (workflowById[r.workflowId] || {}).contentType === "checking";
  const shortRuns = runsFiltered.filter(isShort);
  const checkRuns = runsFiltered.filter(isChecking);
  const longRuns = runsFiltered.filter((r) => !isShort(r) && !isChecking(r));
  const shortsCount = shortRuns.length;
  const checksCount = checkRuns.length;
  const longCount = longRuns.length;
  // Averaged per content type — a blended figure describes neither format,
  // since a short and a long-form edit aren't comparable units of work.
  const avgLong = longCount ? longRuns.reduce((s2, r) => s2 + r.totalSeconds, 0) / longCount : 0;
  const avgShort = shortsCount ? shortRuns.reduce((s2, r) => s2 + r.totalSeconds, 0) / shortsCount : 0;

  const runsFor = (wid) => runsFiltered.filter((r) => r.workflowId === wid);
  const lastRunFor = (wid) => {
    const rs = runsFor(wid);
    if (!rs.length) return null;
    return rs.reduce((a, b) => (new Date(a.completedAt) > new Date(b.completedAt) ? a : b));
  };

  const teamStats = useMemo(() => {
    return teamUids.map((tuid) => {
      const all = runs.filter((r) => r.completedByUid === tuid);
      const rs = all.filter(inRange);
      const time = rs.reduce((s, r) => s + r.totalSeconds, 0);
      const checks = rs.filter((r) => (workflowById[r.workflowId] || {}).contentType === "checking").length;
      const last = rs.length ? rs.reduce((a, b) => (new Date(a.completedAt) > new Date(b.completedAt) ? a : b)) : null;
      return {
        uid: tuid,
        name: displayNameFor(tuid, profiles, (profiles[tuid] && profiles[tuid].email) || (all[0] && all[0].completedBy)),
        runs: rs.length,
        videos: rs.length - checks,
        checks,
        time,
        last,
      };
    }).sort((a, b) => b.videos - a.videos || b.time - a.time || a.name.localeCompare(b.name));
  }, [teamUids, runs, profiles, range, workflowById]);

  // Daily bars across whatever range is selected (capped so long ranges stay legible).
  const dailyData = useMemo(() => {
    const end = range.end ? new Date(range.end + "T00:00:00") : new Date();
    let start;
    if (range.start) {
      start = new Date(range.start + "T00:00:00");
    } else {
      const allKeys = runsByUser.map((r) => dayKey(r.completedAt)).filter(Boolean).sort();
      start = allKeys.length ? new Date(allKeys[0] + "T00:00:00") : new Date(end);
    }
    let span = Math.round((end - start) / 86400000) + 1;
    if (span < 1) span = 1;
    if (span > 60) { span = 60; start = new Date(end); start.setDate(start.getDate() - 59); }

    const days = [];
    for (let i = 0; i < span; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      const key = dayKey(d.toISOString());
      days.push({
        key,
        label: span > 21 ? "" : d.toLocaleDateString(undefined, { weekday: "narrow" }),
        long: 0, short: 0,
      });
    }
    const map = {};
    days.forEach((d) => { map[d.key] = d; });
    runsFiltered.forEach((r) => {
      const k = dayKey(r.completedAt);
      if (!map[k]) return;
      map[k][isShort(r) ? "short" : "long"] += 1;
    });
    return days;
  }, [runsFiltered, runsByUser, workflowById, range]);

  const isSingleDay = !!range.start && range.start === range.end;
  const rangeLabel = rangePreset === "all"
    ? "All time"
    : isSingleDay
      ? (range.start === todayKey() ? "Today" : formatFullDate(range.start))
      : `${formatFullDate(range.start)} – ${formatFullDate(range.end)}`;

  // For a single day, a one-bar chart tells you nothing — who did what is the useful view.
  const perEditorToday = useMemo(() => {
    const by = {};
    runsFiltered.filter((r) => !isChecking(r)).forEach((r) => {
      const id = r.completedByUid || "unknown";
      if (!by[id]) by[id] = { uid: id, videos: 0, time: 0 };
      by[id].videos += 1;
      by[id].time += r.totalSeconds;
    });
    return Object.values(by)
      .map((e) => ({ ...e, name: displayNameFor(e.uid, profiles) }))
      .sort((a, b) => b.videos - a.videos);
  }, [runsFiltered, profiles]);

  const myName = displayNameFor(user.uid, profiles, user.email);
  const progOf = (w) => (progress && progress[progKey(w.id, user.uid)]) || {};
  const inProgress = (w) => { const pr = progOf(w); return !pr.isComplete && ((pr.stepIndex || 0) > 0 || Object.values(pr.stepTimes || {}).some((t) => t > 0)); };
  // Whatever you already started comes first — that is the one you came back for.
  const sortedWorkflows = [...workflows].sort((a, b) => (inProgress(b) ? 1 : 0) - (inProgress(a) ? 1 : 0));
  const teamShown = teamStats.filter((t) => t.name.toLowerCase().includes(teamStatsSearch.trim().toLowerCase()));
  // On a single day the team list already says who posted what, so supervisors get one list instead of two.
  const teamListOn = isSupervisor && filterUid === "all" && teamStats.length > 0;

  const headerEl = (
    <React.Fragment>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <p style={{ color: COLORS.textMuted }} className="font-mono text-[11px] tracking-[0.2em] uppercase mb-1">Workflow Controller</p>
          <h1 style={{ color: COLORS.textPrimary }} className="text-2xl sm:text-3xl font-bold">Home</h1>
        </div>
        <div className="flex items-center gap-2">
          {syncStatus === "error" && (
            <span style={{ backgroundColor: "rgba(225,90,90,0.14)", color: COLORS.danger }} className="text-[11px] font-semibold rounded-full px-2.5 py-1 flex items-center gap-1.5" title="Changes are saved on this device but haven't synced to the cloud yet">
              <span style={{ width: 6, height: 6, borderRadius: 9999, backgroundColor: COLORS.danger, display: "inline-block" }} />
              Offline
            </span>
          )}
          <button onClick={onOpenProfile} style={{ borderColor: COLORS.border, backgroundColor: COLORS.bgCard }} className="flex items-center gap-2 rounded-full border pl-1 pr-3 py-1 hover:brightness-150 transition-all" aria-label="Edit profile" title="Your profile and team settings">
            <div style={{ backgroundColor: COLORS.tealSoft, color: COLORS.teal }} className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs shrink-0">
              {myName.slice(0, 1).toUpperCase()}
            </div>
            <span style={{ color: COLORS.textPrimary }} className="text-sm font-semibold truncate max-w-[140px]">{myName}</span>
          </button>
          <button onClick={onSignOut} aria-label="Sign out" title="Sign out" style={{ color: COLORS.textMuted }} className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-2 text-xs font-semibold hover:brightness-150 transition-all">
            <LogOut size={15} /> <span className="hidden sm:inline">Sign out</span>
          </button>
        </div>
      </div>

      <nav aria-label="Sections" className="db-nav flex items-center gap-1.5 mb-6 overflow-x-auto sm:flex-wrap sm:overflow-visible" data-testid="db-nav">
        <style>{`.db-nav{scrollbar-width:none;-webkit-overflow-scrolling:touch;margin-left:-1.5rem;margin-right:-1.5rem;padding-left:1.5rem;padding-right:1.5rem}.db-nav::-webkit-scrollbar{display:none}
          @keyframes db-live{0%,100%{opacity:1}50%{opacity:.35}} .live-dot{animation:db-live 1.8s ease-in-out infinite} @media (prefers-reduced-motion: reduce){.live-dot{animation:none}}`}</style>
        {canManage && <NavItem icon={<ClipboardIcon size={16} />} label="Tasks" badge={myPendingTaskCount} onClick={onOpenTasks} title="Tasks — assigned work" />}
        <NavItem icon={<ChatIcon size={16} />} label="Messages" badge={unreadRoomCount} badgeTone="teal" onClick={onOpenMessages} title="Messages" />
        {canManage && <NavItem icon={<SparkIcon size={16} />} label="Clip Studio" href={`${window.location.origin}${window.location.pathname}#/studio`} target="wfc-studio" title="Clip Studio — titles, descriptions and scripts" />}
        {canManage && <NavItem icon={<TargetIcon size={16} />} label="Targets" onClick={onOpenTargets} title={isSupervisor ? "Targets — daily goals for editors" : "Your targets and history"} />}
        {canManage && <NavItem icon={<ClockIcon size={16} />} label="Attendance" badge={pendingAttendanceCount} onClick={onOpenAttendance} title="Attendance — punch times and timesheets" />}
        {isSupervisor && <NavItem icon={<CalendarIcon size={16} />} label="Day view" onClick={() => onOpenDay(dayKey(new Date().toISOString()))} title="Day view — who posted what, by date" />}
        {isSupervisor && <NavItem icon={<BarChart2 size={16} />} label="Insights" onClick={onOpenInsights} title="Insights — run history and step timings" />}
      </nav>
    </React.Fragment>
  );

  const numbersEl = (
    <React.Fragment>
      <div className="flex items-center justify-between gap-x-4 gap-y-2 flex-wrap mt-2 mb-3">
        <SectionLabel>{isSupervisor ? "Output" : "Team output"} · {rangeLabel}{filterUid !== "all" ? ` · ${(teamStats.find((t) => t.uid === filterUid) || {}).name || "one person"}` : ""}</SectionLabel>
        {isSupervisor && (
          <label className="flex items-center gap-2 text-xs" style={{ color: COLORS.textMuted }}>
            <Users size={14} />
            <span className="sr-only">Show numbers for</span>
            <select value={filterUid} onChange={(e) => setFilterUid(e.target.value)} data-testid="team-filter"
              style={{ backgroundColor: COLORS.bgElevated, borderColor: filterUid === "all" ? COLORS.border : COLORS.teal, color: COLORS.textPrimary }}
              className="rounded-lg border px-2.5 py-2 text-xs font-semibold outline-none focus:ring-2">
              <option value="all">Everyone</option>
              {teamStats.map((t) => <option key={t.uid} value={t.uid}>{t.name}</option>)}
            </select>
            {filterUid !== "all" && (
              <button type="button" onClick={() => setFilterUid("all")} style={{ color: COLORS.teal }} className="font-semibold underline underline-offset-2">Show everyone</button>
            )}
          </label>
        )}
      </div>
      <div className="flex items-center gap-1.5 mb-4 flex-wrap">
        {RANGE_PRESETS.map(([val, label]) => (
          <button key={val} onClick={() => setRangePreset(val)}
            style={{
              backgroundColor: rangePreset === val ? COLORS.tealSoft : "transparent",
              color: rangePreset === val ? COLORS.teal : COLORS.textMuted,
              borderColor: rangePreset === val ? COLORS.teal : COLORS.border,
            }}
            className="rounded-lg border px-3 py-2 text-xs font-semibold transition-all">
            {label}
          </button>
        ))}
      </div>
      {rangePreset === "custom" && (
        <div className="flex items-center gap-2 mb-4 -mt-2 flex-wrap">
          <input type="date" value={customStart} max={customEnd} onChange={(e) => setCustomStart(e.target.value)}
            style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, color: COLORS.textPrimary }}
            className="rounded-lg border px-2.5 py-1.5 text-xs outline-none focus:ring-2" />
          <span style={{ color: COLORS.textFaint }} className="text-xs">to</span>
          <input type="date" value={customEnd} min={customStart} onChange={(e) => setCustomEnd(e.target.value)}
            style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, color: COLORS.textPrimary }}
            className="rounded-lg border px-2.5 py-1.5 text-xs outline-none focus:ring-2" />
        </div>
      )}
      

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
        <StatCard label="Videos posted" value={totalRuns} color={totalRuns === 0 ? COLORS.textFaint : COLORS.textPrimary} />
        <StatCard label="Long-form" value={longCount} color={longCount === 0 ? COLORS.textFaint : COLORS.teal} />
        <StatCard label="Shorts" value={shortsCount} color={shortsCount === 0 ? COLORS.textFaint : COLORS.orange} />
        {checksCount > 0 ? (
          <>
            <StatCard label="Checks" value={checksCount} color={COLORS.violet} />
            <StatCard label="Time tracked" value={formatHours(totalTime)} color={totalTime === 0 ? COLORS.textFaint : COLORS.orange} />
            <AvgLengthCard avgLong={avgLong} avgShort={avgShort} longCount={longCount} shortsCount={shortsCount} />
          </>
        ) : (
          <>
            <StatCard label="Time tracked" value={formatHours(totalTime)} color={totalTime === 0 ? COLORS.textFaint : COLORS.orange} />
            <StatCard label="Avg long-form" value={longCount ? formatTime(avgLong) : "—"} color={longCount === 0 ? COLORS.textFaint : COLORS.teal} />
            <StatCard label="Avg short" value={shortsCount ? formatTime(avgShort) : "—"} color={shortsCount === 0 ? COLORS.textFaint : COLORS.orange} />
          </>
        )}
      </div>

      {/* A single day gets a per-editor breakdown; a span gets the trend chart. */}
      {!(isSingleDay && teamListOn) && (
      <div style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border }} className="rounded-2xl border p-5 mb-6">
        {isSingleDay ? (
          <React.Fragment>
            <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
              <SectionLabel>Who posted</SectionLabel>
              <button onClick={() => onOpenDay(range.start)} style={{ color: COLORS.teal }}
                className="font-mono text-[11px] tracking-wide hover:opacity-80 underline underline-offset-2">
                Full day view
              </button>
            </div>
            {perEditorToday.length === 0 ? (
              <p style={{ color: COLORS.textMuted }} className="text-sm">
                Nothing posted yet{range.start === todayKey() ? " today" : " this day"}.
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                {perEditorToday.map((e) => (
                  <div key={e.uid} className="flex items-center gap-3">
                    <div style={{ backgroundColor: COLORS.tealSoft, color: COLORS.teal }}
                      className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs shrink-0">
                      {e.name.slice(0, 1).toUpperCase()}
                    </div>
                    <p style={{ color: COLORS.textPrimary }} className="text-sm font-semibold flex-1 truncate">{e.name}</p>
                    <p style={{ color: COLORS.textMuted }} className="text-xs shrink-0">{e.videos} video{e.videos === 1 ? "" : "s"}</p>
                    <p style={{ color: COLORS.orange }} className="text-xs font-semibold shrink-0 w-20 text-right" title="Time tracked on those videos">{formatDuration(e.time)}</p>
                  </div>
                ))}
              </div>
            )}
          </React.Fragment>
        ) : (
          <React.Fragment>
            <SectionLabel className="mb-4">Videos posted</SectionLabel>
            <DailyBars days={dailyData} onOpenDay={onOpenDay} />
          </React.Fragment>
        )}
      </div>
      )}

      {/* Team — the same date range as the numbers above, not all-time. */}
      {teamListOn && (
        <div style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border }} className="rounded-2xl border p-5 mb-6" data-testid="team-list">
          <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
            <SectionLabel>Team · {rangeLabel}</SectionLabel>
            <div className="flex items-center gap-3">
              {teamStats.length > 6 && (
                <input value={teamStatsSearch} onChange={(e) => setTeamStatsSearch(e.target.value)} placeholder="Search the team…"
                  style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, color: COLORS.textPrimary }}
                  className="rounded-lg border px-3 py-1.5 text-xs outline-none focus:ring-2 w-40" />
              )}
              {isSingleDay && (
                <button onClick={() => onOpenDay(range.start)} style={{ color: COLORS.teal }} className="text-xs font-semibold hover:opacity-80 underline underline-offset-2">Full day view</button>
              )}
            </div>
          </div>
          <div className="flex flex-col">
            {teamShown.map((t, i) => {
              const memberChannels = (channels || []).filter((c) => (c.memberUids || []).includes(t.uid));
              const quiet = t.runs === 0;
              return (
                <button key={t.uid} onClick={() => setFilterUid(t.uid)} data-testid={`team-row-${t.uid}`} title={`Show only ${t.name}'s numbers`}
                  style={{ borderTop: i ? `1px solid ${COLORS.border}` : "none" }}
                  className="flex items-center gap-3 py-2.5 text-left hover:brightness-125 transition-all">
                  <div style={{ backgroundColor: quiet ? COLORS.bgElevated : COLORS.tealSoft, color: quiet ? COLORS.textMuted : COLORS.teal }} className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm shrink-0">
                    {t.name.slice(0, 1).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p style={{ color: COLORS.textPrimary }} className="text-sm font-semibold truncate">{t.name}</p>
                      {memberChannels.map((c) => (
                        <span key={c.id} style={{ backgroundColor: COLORS.violetSoft, color: COLORS.violet }} className="text-[10px] font-semibold rounded-full px-1.5 py-0.5 shrink-0">
                          {c.name}
                        </span>
                      ))}
                    </div>
                    <p style={{ color: COLORS.textMuted }} className="text-xs mt-0.5">
                      {quiet ? (rangePreset === "all" ? "Nothing posted yet" : "Nothing posted in this period") : `Last posted ${formatDateShort(t.last.completedAt)}`}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p style={{ color: quiet ? COLORS.textMuted : COLORS.textPrimary }} className="text-sm font-bold">{t.videos} video{t.videos === 1 ? "" : "s"}{t.checks ? ` · ${t.checks} check${t.checks === 1 ? "" : "s"}` : ""}</p>
                    <p style={{ color: quiet ? COLORS.textMuted : COLORS.orange }} className="text-[11px] mt-0.5">{formatHours(t.time)} tracked</p>
                  </div>
                </button>
              );
            })}
            {teamShown.length === 0 && (
              <p style={{ color: COLORS.textMuted }} className="text-sm">No one matches that search.</p>
            )}
          </div>
        </div>
      )}
    </React.Fragment>
  );

  const channelsEl = (
    <React.Fragment>
      <div className="flex items-center justify-between mb-3">
        <SectionLabel>Channels</SectionLabel>
        {canManageChannels && (
          <button onClick={() => setNewChannelOpen((o) => !o)} style={{ color: COLORS.teal }} className="font-mono text-[11px] tracking-wide hover:opacity-80 flex items-center gap-1">
            <Plus size={13} /> New channel
          </button>
        )}
      </div>

      {newChannelOpen && (
        <div className="flex gap-2 mb-4">
          <input value={newChannelName} onChange={(e) => setNewChannelName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submitNewChannel()}
            placeholder="Channel name…" autoFocus
            style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, color: COLORS.textPrimary }}
            className="flex-1 rounded-xl border px-4 py-2.5 text-sm outline-none focus:ring-2" />
          <button onClick={submitNewChannel} style={{ backgroundColor: COLORS.tealSoft, color: COLORS.teal }} className="rounded-xl px-4 py-2.5 text-sm font-semibold hover:brightness-110 transition-all">Create</button>
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-4 mb-6">
        {channels.map((ch) => (
          <div key={ch.id}
            style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border }}
            className="rounded-2xl border p-5 flex items-center gap-4">
            <button onClick={() => onOpenChannel(ch.id)} className="flex items-center gap-4 flex-1 min-w-0 text-left hover:opacity-80 transition-opacity">
              <div style={{ backgroundColor: COLORS.violetSoft, color: COLORS.violet }} className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0">
                <ChannelIcon size={20} />
              </div>
              <div className="flex-1 min-w-0">
                <p style={{ color: COLORS.textPrimary }} className="font-semibold truncate">{ch.name}</p>
                <p style={{ color: COLORS.textMuted }} className="text-xs mt-0.5">
                  {editorsFor(ch)} editor{editorsFor(ch) === 1 ? "" : "s"} · {videosFor(ch.id)} video{videosFor(ch.id) === 1 ? "" : "s"} posted
                </p>
                <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                  {ch.country && (
                    <span style={{ backgroundColor: COLORS.bgElevated, color: COLORS.textMuted }} className="font-mono text-[10px] rounded-full px-2 py-0.5">
                      {ch.country}
                    </span>
                  )}
                  <span
                    style={{
                      backgroundColor: ch.monetised ? COLORS.tealSoft : COLORS.bgElevated,
                      color: ch.monetised ? COLORS.teal : COLORS.textFaint,
                    }}
                    className="font-mono text-[10px] rounded-full px-2 py-0.5">
                    {ch.monetised ? "Monetised" : "Not monetised"}
                  </span>
                </div>
              </div>
            </button>
          </div>
        ))}
        {channels.length === 0 && !newChannelOpen && (
          <p style={{ color: COLORS.textFaint }} className="text-sm italic sm:col-span-2 py-2">No channels yet — add one to start tracking editors and output per channel.</p>
        )}
      </div>
    </React.Fragment>
  );

  /* Workflow cards — partners can't see step content, so this section is hidden for them */
  const workflowsEl = canManage && (
        <React.Fragment>
      <div className="flex items-center justify-between mb-3">
        <SectionLabel>Workflows</SectionLabel>
        {workflows.length > 4 && (
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search workflows…"
            style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, color: COLORS.textPrimary }}
            className="rounded-lg border px-3 py-1.5 text-xs outline-none focus:ring-2 w-40" />
        )}
      </div>
      <div className="grid sm:grid-cols-2 gap-4 mb-4">
        {sortedWorkflows.filter((w) => (w.title || "").toLowerCase().includes(search.toLowerCase())).map((w) => {
          const last = lastRunFor(w.id);
          const prog = (progress && progress[progKey(w.id, user.uid)]) || {};
          // A finished run isn't "in progress" — it's done. Without excluding
          // isComplete here, the card said "Continue" forever after the first
          // completion and clicking it just reopened the same old summary
          // screen instead of offering a fresh run.
          const hasProgress = !prog.isComplete && ((prog.stepIndex || 0) > 0 || Object.values(prog.stepTimes || {}).some((t) => t > 0));
          const menuOpen = openMenuId === w.id;
          return (
            <div key={w.id} data-testid={`wf-card-${w.id}`} style={{ backgroundColor: COLORS.bgCard, borderColor: hasProgress ? COLORS.teal : COLORS.border }} className="rounded-2xl border p-5 flex flex-col relative">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <p style={{ color: COLORS.textPrimary }} className="font-semibold text-lg truncate">{w.title || "Untitled workflow"}</p>
                </div>
                <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
                  {w.channelId && channels.find((c) => c.id === w.channelId) && (
                    <span style={{ backgroundColor: COLORS.violetSoft, color: COLORS.violet }} className="inline-block font-mono text-[10px] rounded-full px-2 py-0.5">
                      {channels.find((c) => c.id === w.channelId).name}
                    </span>
                  )}
                  <span style={{
                    backgroundColor: w.contentType === "short" ? COLORS.orangeSoft : w.contentType === "checking" ? COLORS.violetSoft : COLORS.tealSoft,
                    color: w.contentType === "short" ? COLORS.orange : w.contentType === "checking" ? COLORS.violet : COLORS.teal,
                  }} className="inline-block font-mono text-[10px] rounded-full px-2 py-0.5">
                    {w.contentType === "short" ? "Shorts" : w.contentType === "checking" ? "Checking" : "Long-form"}
                  </span>
                  {!w.channelId && canManage && (
                    <span
                      title="Editors and partners only see workflows that belong to one of their channels"
                      style={{ backgroundColor: "rgba(225,90,90,0.14)", color: COLORS.danger }}
                      className="inline-block font-mono text-[10px] rounded-full px-2 py-0.5">
                      No channel — hidden from editors
                    </span>
                  )}
                </div>
                {hasProgress ? (
                  <p style={{ color: COLORS.teal }} className="text-xs font-semibold" data-testid={`wf-progress-${w.id}`}>In progress · step {(prog.stepIndex || 0) + 1} of {w.steps.length}</p>
                ) : (
                  <p style={{ color: COLORS.textMuted }} className="text-xs">{w.steps.length} step{w.steps.length === 1 ? "" : "s"}</p>
                )}
              </div>
              <div className="flex items-center gap-2 mt-4">
                {myAttendance && myAttendance.onBreak && !hasProgress ? (
                  <button disabled title="End your break to start a workflow"
                    style={{ backgroundColor: COLORS.bgElevated, color: COLORS.textFaint, cursor: "not-allowed" }}
                    className="flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-bold">
                    <Play size={15} /> On break
                  </button>
                ) : (
                  <a
                    href={`${window.location.origin}${window.location.pathname}#/run/${w.id}`}
                    target="wfc-run"
                    onClick={() => {
                      // A completed workflow has no "in progress" to continue —
                      // starting it again means a fresh run, not reopening the
                      // last one's summary screen. This fires alongside the
                      // browser's own navigation, not instead of it.
                      if (prog.isComplete) onRestartWorkflow(w.id);
                    }}
                    style={{ backgroundColor: COLORS.teal, color: "#04211D" }}
                    className="hover-lift flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-bold">
                    <Play size={15} /> {hasProgress ? "Continue" : "Start"}
                  </a>
                )}
                {(canManage || hasProgress) && (
                  <button onClick={() => setOpenMenuId(menuOpen ? null : w.id)} aria-label="More options"
                    style={{ borderColor: COLORS.border, color: COLORS.textMuted }} className="rounded-xl border px-3 py-2.5 hover:opacity-80 transition-opacity font-bold">
                    ⋯
                  </button>
                )}
              </div>

              {menuOpen && (
                <React.Fragment>
                  <div className="fixed inset-0 z-10" onClick={() => setOpenMenuId(null)} />
                  <div style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border }} className="absolute right-5 bottom-16 rounded-xl border py-1.5 z-20 w-44 shadow-lg">
                    {canManage && (
                      <button onClick={() => { onEditWorkflow(w.id); setOpenMenuId(null); }} style={{ color: COLORS.textPrimary }} className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm hover:opacity-70 text-left">
                        <Settings size={15} /> Edit
                      </button>
                    )}
                    {canManage && (
                      <button onClick={() => { onDuplicateWorkflow(w.id); setOpenMenuId(null); }} style={{ color: COLORS.textPrimary }} className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm hover:opacity-70 text-left">
                        <Copy size={15} /> Duplicate
                      </button>
                    )}
                    {hasProgress && (
                      <button onClick={() => { if (window.confirm("Restart this workflow from step 1? Current progress will be cleared.")) onRestartWorkflow(w.id); setOpenMenuId(null); }} style={{ color: COLORS.textPrimary }} className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm hover:opacity-70 text-left">
                        <RotateCcw size={15} /> Restart progress
                      </button>
                    )}
                    {canManage && (
                      <button onClick={() => { setConfirmId(w.id); setOpenMenuId(null); }} style={{ color: COLORS.danger }} className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm hover:opacity-70 text-left">
                        <Trash2 size={15} /> Delete
                      </button>
                    )}
                  </div>
                </React.Fragment>
              )}
            </div>
          );
        })}

        {canManage && (
          <button onClick={onCreate} style={{ backgroundColor: COLORS.tealSoft, color: COLORS.teal, borderColor: COLORS.teal }}
            className="flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed py-10 text-base font-semibold hover:brightness-110 transition-all">
            <Plus size={22} /> New Workflow
          </button>
        )}
      </div>
        </React.Fragment>
  );

  return (
    <div className="flex-1 flex flex-col max-w-4xl w-full mx-auto px-6 py-8 sm:py-10 overflow-y-auto fade-in">
      {headerEl}

      <AttendanceWidget record={myAttendance} onPunchIn={onPunchIn} onStartBreak={onStartBreak} onEndBreak={onEndBreak} onPunchOut={onPunchOut} onUndoPunchOut={onUndoPunchOut}>
        {myDay && myDay.punched && (() => {
          const waiting = tracksTime ? myDay.gaps.filter((g) => !g.open) : [];
          return (
            <div style={{ borderColor: COLORS.border }} className="border-t pt-4 flex flex-col gap-3" data-testid="my-day">
              <DayBar day={myDay} height={14} testid="my-day-bar" />
              <DayFigures day={myDay} />
              {waiting.length > 0 && (
                <div style={{ backgroundColor: "rgba(242,120,75,0.10)", borderColor: "#7A3A22" }} className="rounded-xl border px-3.5 py-3 flex flex-wrap items-center gap-2.5" data-testid="my-day-gaps">
                  <span style={{ color: COLORS.textPrimary, flex: "1 1 220px" }} className="text-[13px]">{waiting.length === 1 ? "1 gap is waiting for a reason" : `${waiting.length} gaps are waiting for a reason`}</span>
                  <button type="button" onClick={onOpenMyDay} style={{ backgroundColor: COLORS.orange, color: "#2A1200" }} className="min-h-[44px] px-4 rounded-xl text-[13px] font-bold">Say what {waiting.length === 1 ? "it was" : "they were"}</button>
                </div>
              )}
              <button type="button" onClick={onOpenMyDay} data-testid="open-my-day" style={{ color: COLORS.teal }} className="self-start text-xs font-semibold underline underline-offset-2">See my whole day</button>
            </div>
          );
        })()}
      </AttendanceWidget>

      {canManage && <MyTargetsCard ctx={targetsCtx} />}
      {canManage && <RevisionsCard ctx={revisionsCtx} />}

      <div className="h-6 shrink-0" />
      {/* Supervisors watch the team first; editors get straight to their work. */}
      {isSupervisor
        ? <TeamNow liveActivity={liveActivity} teamEditors={teamEditors} attendance={attendance} profiles={profiles} runs={runs} onPick={setFilterUid} onOpenPersonDay={onOpenPersonDay} onOpenWeek={onOpenWeek} expect={timeExpect} />
        : workflowsEl}
      {numbersEl}
      {channelsEl}
      {isSupervisor && workflowsEl}

      {confirmId && (
        <div className="fixed inset-0 flex items-center justify-center px-6" style={{ backgroundColor: "rgba(0,0,0,0.6)" }}>
          <div style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border }} className="rounded-2xl border p-6 max-w-sm w-full">
            <p style={{ color: COLORS.textPrimary }} className="font-semibold mb-2">Delete this workflow?</p>
            <p style={{ color: COLORS.textMuted }} className="text-sm mb-6">This removes its steps and progress for everyone. Run history stays in Insights.</p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmId(null)} style={{ borderColor: COLORS.border, color: COLORS.textMuted }} className="flex-1 rounded-xl border py-3 text-sm font-semibold">Cancel</button>
              <button onClick={() => { onDeleteWorkflow(confirmId); setConfirmId(null); }} style={{ backgroundColor: COLORS.danger, color: "#2A0A0A" }} className="flex-1 rounded-xl py-3 text-sm font-bold">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

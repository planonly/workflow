import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { COLORS, progKey, formatTime, formatHours, formatDateShort, formatFullDate, dayKey, displayNameFor } from "../lib/core";
import { BarChart2, CalendarIcon, ChannelIcon, ClipboardIcon, ClockIcon, SparkIcon, Copy, LogOut, Play, Plus, RotateCcw, Settings, Trash2, Users } from "./Icon";
import { AttendanceWidget, DailyBars, StatCard } from "./shared";


export default function Dashboard({ user, profiles, workflows, runs, progress, channels, syncStatus, canManage, isSupervisor, canManageChannels, myAttendance, onPunchIn, onStartBreak, onEndBreak, onPunchOut, myPendingTaskCount, onOpenTasks, pendingAttendanceCount, onOpenAttendance, onCreate, onEditWorkflow, onDeleteWorkflow, onDuplicateWorkflow, onRestartWorkflow, onOpenInsights, onSignOut, onCreateChannel, onOpenChannel, onDeleteChannel, liveActivity, onOpenProfile, onOpenDay }) {
  const [openMenuId, setOpenMenuId] = useState(null);
  const [confirmId, setConfirmId] = useState(null);
  const [filterUid, setFilterUid] = useState("all");
  const [newChannelOpen, setNewChannelOpen] = useState(false);
  const [newChannelName, setNewChannelName] = useState("");
  const [search, setSearch] = useState("");
  const [rangePreset, setRangePreset] = useState("today");
  const [customStart, setCustomStart] = useState(new Date().toISOString().slice(0, 10));
  const [customEnd, setCustomEnd] = useState(new Date().toISOString().slice(0, 10));

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
  const todayKey = () => new Date().toISOString().slice(0, 10);
  const shiftKey = (days) => {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString().slice(0, 10);
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
  const totalRuns = runsFiltered.length;
  const totalTime = runsFiltered.reduce((s, r) => s + r.totalSeconds, 0);
  const workflowsTouched = new Set(runsFiltered.map((r) => r.workflowId)).size;
  const avgSession = totalRuns ? totalTime / totalRuns : 0;

  const workflowById = useMemo(() => {
    const m = {};
    workflows.forEach((w) => { m[w.id] = w; });
    return m;
  }, [workflows]);
  const isShort = (r) => (workflowById[r.workflowId] || {}).contentType === "short";
  const shortRuns = runsFiltered.filter(isShort);
  const longRuns = runsFiltered.filter((r) => !isShort(r));
  const shortsCount = shortRuns.length;
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
      const rs = runs.filter((r) => r.completedByUid === tuid);
      const time = rs.reduce((s, r) => s + r.totalSeconds, 0);
      const last = rs.length ? rs.reduce((a, b) => (new Date(a.completedAt) > new Date(b.completedAt) ? a : b)) : null;
      return {
        uid: tuid,
        name: displayNameFor(tuid, profiles, (profiles[tuid] && profiles[tuid].email) || (rs[0] && rs[0].completedBy)),
        runs: rs.length,
        time,
        last,
      };
    }).sort((a, b) => b.time - a.time);
  }, [teamUids, runs, profiles]);

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
      const key = d.toISOString().slice(0, 10);
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
    runsFiltered.forEach((r) => {
      const id = r.completedByUid || "unknown";
      if (!by[id]) by[id] = { uid: id, videos: 0, time: 0 };
      by[id].videos += 1;
      by[id].time += r.totalSeconds;
    });
    return Object.values(by)
      .map((e) => ({ ...e, name: displayNameFor(e.uid, profiles) }))
      .sort((a, b) => b.videos - a.videos);
  }, [runsFiltered, profiles]);

  return (
    <div className="flex-1 flex flex-col max-w-4xl w-full mx-auto px-6 py-8 sm:py-10 overflow-y-auto fade-in">
      <div className="flex items-start justify-between mb-2 flex-wrap gap-3">
        <div>
          <p style={{ color: COLORS.textFaint }} className="font-mono text-[11px] tracking-[0.2em] uppercase mb-1">Workflow Controller</p>
          <h1 style={{ color: COLORS.textPrimary }} className="text-2xl sm:text-3xl font-bold">Home</h1>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onOpenProfile} className="flex items-center gap-2 hover:opacity-80 transition-opacity" aria-label="Edit profile" title="Your profile and team settings">
            <div style={{ backgroundColor: COLORS.tealSoft, color: COLORS.teal }} className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs shrink-0">
              {displayNameFor(user.uid, profiles, user.email).slice(0, 1).toUpperCase()}
            </div>
            <span style={{ color: COLORS.textMuted }} className="font-mono text-xs hidden sm:inline truncate max-w-[140px]">{displayNameFor(user.uid, profiles, user.email)}</span>
          </button>
          {syncStatus === "error" && (
            <span style={{ backgroundColor: "rgba(225,90,90,0.14)", color: COLORS.danger }} className="font-mono text-[10px] rounded-full px-2.5 py-1 flex items-center gap-1.5" title="Changes are saved on this device but haven't synced to the cloud yet">
              <span style={{ width: 6, height: 6, borderRadius: 9999, backgroundColor: COLORS.danger, display: "inline-block" }} />
              Offline
            </span>
          )}
          {isSupervisor && (
            <button onClick={onOpenInsights} aria-label="Insights" title="Insights — run history and step timings" style={{ borderColor: COLORS.border, color: COLORS.textMuted }} className="rounded-full border p-2 transition-all hover:brightness-150 hover:scale-105 active:scale-95"><BarChart2 size={18} /></button>
          )}
          {isSupervisor && (
          <button onClick={() => onOpenDay(new Date().toISOString().slice(0, 10))} aria-label="Today's activity" title="Day view — who posted what, by date" style={{ borderColor: COLORS.border, color: COLORS.textMuted }} className="rounded-full border p-2 transition-all hover:brightness-150 hover:scale-105 active:scale-95"><CalendarIcon size={18} /></button>
          )}
          {canManage && (
            <button onClick={onOpenTasks} aria-label="Tasks" title="Tasks — assigned work" style={{ borderColor: COLORS.border, color: COLORS.textMuted }} className="relative rounded-full border p-2 transition-all hover:brightness-150 hover:scale-105 active:scale-95">
              <ClipboardIcon size={18} />
              {myPendingTaskCount > 0 && (
                <span style={{ backgroundColor: COLORS.orange, color: "#2A1200" }} className="absolute -top-1.5 -right-1.5 rounded-full w-4 h-4 text-[9px] font-bold flex items-center justify-center">
                  {myPendingTaskCount > 9 ? "9+" : myPendingTaskCount}
                </span>
              )}
            </button>
          )}
          {canManage && (
            <a href={`${window.location.origin}${window.location.pathname}#/studio`} target="wfc-studio"
              aria-label="Clip studio" title="Clip studio — metadata and voiceover"
              style={{ borderColor: COLORS.border, color: COLORS.textMuted }}
              className="rounded-full border p-2 transition-all hover:brightness-150 hover:scale-105 active:scale-95 inline-flex items-center justify-center">
              <SparkIcon size={18} />
            </a>
          )}
          {canManage && (
            <button onClick={onOpenAttendance} aria-label="Attendance" title="Attendance — punch times and timesheets" style={{ borderColor: COLORS.border, color: COLORS.textMuted }} className="relative rounded-full border p-2 transition-all hover:brightness-150 hover:scale-105 active:scale-95">
              <ClockIcon size={18} />
              {pendingAttendanceCount > 0 && (
                <span style={{ backgroundColor: COLORS.orange, color: "#2A1200" }} className="absolute -top-1.5 -right-1.5 rounded-full w-4 h-4 text-[9px] font-bold flex items-center justify-center">
                  {pendingAttendanceCount > 9 ? "9+" : pendingAttendanceCount}
                </span>
              )}
            </button>
          )}
          <button onClick={onSignOut} aria-label="Sign out" title="Sign out" style={{ borderColor: COLORS.border, color: COLORS.textMuted }} className="rounded-full border p-2 transition-all hover:brightness-150 hover:scale-105 active:scale-95"><LogOut size={18} /></button>
        </div>
      </div>

      <AttendanceWidget record={myAttendance} onPunchIn={onPunchIn} onStartBreak={onStartBreak} onEndBreak={onEndBreak} onPunchOut={onPunchOut} />

      {/* Team filter */}
      <div className={`items-center gap-2 mt-6 mb-4 flex-wrap ${isSupervisor ? "flex" : "hidden"}`}>
        <Users size={16} style={{ color: COLORS.textFaint }} />
        <select
          value={filterUid}
          onChange={(e) => setFilterUid(e.target.value)}
          style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, color: COLORS.textPrimary }}
          className="rounded-xl border px-3 py-2 text-sm font-medium outline-none focus:ring-2"
        >
          <option value="all">All team members</option>
          {teamStats.map((t) => <option key={t.uid} value={t.uid}>{t.name}</option>)}
        </select>
      </div>

      {/* Working on right now — read straight from live progress, so it needs
          nothing from editors beyond actually using the app. */}
      {liveActivity && liveActivity.length > 0 && (
        <div style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border }} className="rounded-2xl border p-5 mb-5">
          <p style={{ color: COLORS.textFaint }} className="font-mono text-[11px] tracking-[0.2em] uppercase mb-4">Working on right now</p>
          <div className="flex flex-col gap-3">
            {liveActivity.map((a) => (
              <div key={a.uid} className="flex items-center gap-3">
                <div style={{ backgroundColor: a.paused ? COLORS.orangeSoft : COLORS.tealSoft, color: a.paused ? COLORS.orange : COLORS.teal }}
                  className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs shrink-0">
                  {a.name.slice(0, 1).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p style={{ color: COLORS.textPrimary }} className="text-sm font-semibold truncate">
                    {a.name}
                    {a.taskTitle && <span style={{ color: COLORS.textMuted }} className="font-normal"> · {a.taskTitle}</span>}
                  </p>
                  <p style={{ color: COLORS.textFaint }} className="font-mono text-[11px] truncate">
                    {a.workflowTitle} · step {a.stepIndex}/{a.stepCount}{a.stepLabel ? ` — ${a.stepLabel}` : ""}
                  </p>
                </div>
                <span
                  style={{
                    backgroundColor: a.contentType === "short" ? COLORS.orangeSoft : COLORS.tealSoft,
                    color: a.contentType === "short" ? COLORS.orange : COLORS.teal,
                  }}
                  className="font-mono text-[10px] rounded-full px-2 py-0.5 shrink-0">
                  {a.contentType === "short" ? "Short" : "Long"}
                </span>
                <span style={{ backgroundColor: a.paused ? COLORS.orangeSoft : COLORS.tealSoft, color: a.paused ? COLORS.orange : COLORS.teal }}
                  className="font-mono text-[10px] rounded-full px-2 py-0.5 shrink-0">
                  {a.paused ? "paused" : "active"}
                </span>
                <span style={{ color: COLORS.textFaint }} className="font-mono text-[10px] shrink-0 hidden sm:inline">
                  {formatDateShort(a.lastActiveAt)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Date range */}
      <div className="flex items-center gap-1.5 mb-2 flex-wrap">
        {RANGE_PRESETS.map(([val, label]) => (
          <button key={val} onClick={() => setRangePreset(val)}
            style={{
              backgroundColor: rangePreset === val ? COLORS.tealSoft : "transparent",
              color: rangePreset === val ? COLORS.teal : COLORS.textMuted,
              borderColor: rangePreset === val ? COLORS.teal : COLORS.border,
            }}
            className="rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-all">
            {label}
          </button>
        ))}
      </div>
      {rangePreset === "custom" && (
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <input type="date" value={customStart} max={customEnd} onChange={(e) => setCustomStart(e.target.value)}
            style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, color: COLORS.textPrimary }}
            className="rounded-lg border px-2.5 py-1.5 text-xs outline-none focus:ring-2" />
          <span style={{ color: COLORS.textFaint }} className="text-xs">to</span>
          <input type="date" value={customEnd} min={customStart} onChange={(e) => setCustomEnd(e.target.value)}
            style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, color: COLORS.textPrimary }}
            className="rounded-lg border px-2.5 py-1.5 text-xs outline-none focus:ring-2" />
        </div>
      )}
      <p style={{ color: COLORS.textFaint }} className="font-mono text-[11px] mb-4">{rangeLabel}</p>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-3">
        <StatCard label="Videos posted" value={totalRuns} color={COLORS.textPrimary} />
        <StatCard label="Long-form" value={longCount} color={COLORS.teal} />
        <StatCard label="Shorts" value={shortsCount} color={COLORS.orange} />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
        <StatCard label="Time tracked" value={formatHours(totalTime)} color={COLORS.orange} />
        <StatCard label="Avg long-form" value={longCount ? formatTime(avgLong) : "—"} color={COLORS.teal} />
        <StatCard label="Avg short" value={shortsCount ? formatTime(avgShort) : "—"} color={COLORS.orange} />
      </div>

      {/* A single day gets a per-editor breakdown; a span gets the trend chart. */}
      <div style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border }} className="rounded-2xl border p-5 mb-6">
        {isSingleDay ? (
          <React.Fragment>
            <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
              <p style={{ color: COLORS.textFaint }} className="font-mono text-[11px] tracking-[0.2em] uppercase">Who posted</p>
              <button onClick={() => onOpenDay(range.start)} style={{ color: COLORS.teal }}
                className="font-mono text-[11px] tracking-wide hover:opacity-80 underline underline-offset-2">
                Full day view
              </button>
            </div>
            {perEditorToday.length === 0 ? (
              <p style={{ color: COLORS.textFaint }} className="text-sm italic">
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
                    <p style={{ color: COLORS.textFaint }} className="font-mono text-xs shrink-0">{e.videos} video{e.videos === 1 ? "" : "s"}</p>
                    <p style={{ color: COLORS.orange }} className="font-mono text-xs font-semibold shrink-0 w-14 text-right">{formatTime(e.time)}</p>
                  </div>
                ))}
              </div>
            )}
          </React.Fragment>
        ) : (
          <React.Fragment>
            <p style={{ color: COLORS.textFaint }} className="font-mono text-[11px] tracking-[0.2em] uppercase mb-4">Videos posted</p>
            <DailyBars days={dailyData} onOpenDay={onOpenDay} />
          </React.Fragment>
        )}
      </div>

      {/* Channels */}
      <div className="flex items-center justify-between mb-3">
        <p style={{ color: COLORS.textFaint }} className="font-mono text-[11px] tracking-[0.2em] uppercase">Channels</p>
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
                <p style={{ color: COLORS.textFaint }} className="font-mono text-xs mt-0.5">
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

      {/* Team breakdown */}
      {isSupervisor && filterUid === "all" && teamStats.length > 0 && (
        <div style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border }} className="rounded-2xl border p-5 mb-6">
          <p style={{ color: COLORS.textFaint }} className="font-mono text-[11px] tracking-[0.2em] uppercase mb-4">Team</p>
          <div className="flex flex-col gap-3">
            {teamStats.map((t) => (
              <button key={t.uid} onClick={() => setFilterUid(t.uid)} className="flex items-center gap-3 text-left hover:opacity-80 transition-opacity">
                <div style={{ backgroundColor: COLORS.tealSoft, color: COLORS.teal }} className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm shrink-0">
                  {t.name.slice(0, 1).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p style={{ color: COLORS.textPrimary }} className="text-sm font-semibold truncate">{t.name}</p>
                  <p style={{ color: COLORS.textFaint }} className="font-mono text-[11px]">{t.runs} runs · {t.last ? `active ${formatDateShort(t.last.completedAt)}` : "no runs yet"}</p>
                </div>
                <span style={{ color: COLORS.orange }} className="font-mono text-sm font-semibold shrink-0">{formatHours(t.time)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Workflow cards — partners can't see step content, so this section is hidden for them */}
      {canManage && (
        <React.Fragment>
      <div className="flex items-center justify-between mb-3">
        <p style={{ color: COLORS.textFaint }} className="font-mono text-[11px] tracking-[0.2em] uppercase">Workflows</p>
        {workflows.length > 4 && (
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search workflows…"
            style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, color: COLORS.textPrimary }}
            className="rounded-lg border px-3 py-1.5 text-xs outline-none focus:ring-2 w-40" />
        )}
      </div>
      <div className="grid sm:grid-cols-2 gap-4 mb-4">
        {workflows.filter((w) => (w.title || "").toLowerCase().includes(search.toLowerCase())).map((w) => {
          const last = lastRunFor(w.id);
          const prog = (progress && progress[progKey(w.id, user.uid)]) || {};
          // A finished run isn't "in progress" — it's done. Without excluding
          // isComplete here, the card said "Continue" forever after the first
          // completion and clicking it just reopened the same old summary
          // screen instead of offering a fresh run.
          const hasProgress = !prog.isComplete && ((prog.stepIndex || 0) > 0 || Object.values(prog.stepTimes || {}).some((t) => t > 0));
          const menuOpen = openMenuId === w.id;
          return (
            <div key={w.id} style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border }} className="rounded-2xl border p-5 flex flex-col relative">
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
                  <span style={{ backgroundColor: w.contentType === "short" ? COLORS.orangeSoft : COLORS.tealSoft, color: w.contentType === "short" ? COLORS.orange : COLORS.teal }} className="inline-block font-mono text-[10px] rounded-full px-2 py-0.5">
                    {w.contentType === "short" ? "Shorts" : "Long-form"}
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
                <p style={{ color: COLORS.textFaint }} className="font-mono text-xs mb-1">{w.steps.length} steps · {runsFor(w.id).length} runs{filterUid !== "all" ? " (this user)" : ""}</p>
                <p style={{ color: COLORS.textFaint }} className="font-mono text-xs">{last ? `Last run ${formatDateShort(last.completedAt)}` : "Not started yet"}</p>
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
                    className="flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-bold hover:brightness-105 transition-all active:scale-[0.98]">
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
      )}

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


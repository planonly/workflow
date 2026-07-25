import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { COLORS, progKey, formatTime, formatHours, formatDateShort, dayKey, displayNameFor } from "../lib/core";
import { BarChart2, CalendarIcon, ChannelIcon, ClipboardIcon, ClockIcon, Copy, LogOut, Play, Plus, RotateCcw, Settings, Trash2, Users } from "./Icon";
import { AttendanceWidget, DailyBars, StatCard } from "./shared";


export default function Dashboard({ user, profiles, workflows, runs, progress, channels, syncStatus, canManage, canManageChannels, myAttendance, onPunchIn, onStartBreak, onEndBreak, onPunchOut, myPendingTaskCount, onOpenTasks, pendingAttendanceCount, onOpenAttendance, onOpenWorkflow, onCreate, onEditWorkflow, onDeleteWorkflow, onDuplicateWorkflow, onRestartWorkflow, onOpenInsights, onSignOut, onCreateChannel, onOpenChannel, onOpenProfile, onOpenDay }) {
  const [openMenuId, setOpenMenuId] = useState(null);
  const [confirmId, setConfirmId] = useState(null);
  const [filterUid, setFilterUid] = useState("all");
  const [newChannelOpen, setNewChannelOpen] = useState(false);
  const [newChannelName, setNewChannelName] = useState("");
  const [search, setSearch] = useState("");

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

  const runsFiltered = filterUid === "all" ? runs : runs.filter((r) => r.completedByUid === filterUid);
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
  const shortsCount = runsFiltered.filter(isShort).length;
  const longCount = totalRuns - shortsCount;

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

  // Daily time totals for the last 14 days, scoped to current filter.
  const dailyData = useMemo(() => {
    const days = [];
    const now = new Date();
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      days.push({ key, label: d.toLocaleDateString(undefined, { weekday: "narrow" }), long: 0, short: 0 });
    }
    const map = {};
    days.forEach((d) => { map[d.key] = d; });
    runsFiltered.forEach((r) => {
      const k = dayKey(r.completedAt);
      if (!map[k]) return;
      map[k][isShort(r) ? "short" : "long"] += 1;
    });
    return days;
  }, [runsFiltered, workflowById]);

  return (
    <div className="flex-1 flex flex-col max-w-4xl w-full mx-auto px-6 py-8 sm:py-10 overflow-y-auto fade-in">
      <div className="flex items-start justify-between mb-2 flex-wrap gap-3">
        <div>
          <p style={{ color: COLORS.textFaint }} className="font-mono text-[11px] tracking-[0.2em] uppercase mb-1">Workflow Controller</p>
          <h1 style={{ color: COLORS.textPrimary }} className="text-2xl sm:text-3xl font-bold">Home</h1>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onOpenProfile} className="flex items-center gap-2 hover:opacity-80 transition-opacity" aria-label="Edit profile">
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
          {canManage && (
            <button onClick={onOpenInsights} aria-label="Insights" style={{ borderColor: COLORS.border, color: COLORS.textMuted }} className="rounded-full border p-2 hover:opacity-80 transition-opacity"><BarChart2 size={18} /></button>
          )}
          <button onClick={() => onOpenDay(new Date().toISOString().slice(0, 10))} aria-label="Today's activity" style={{ borderColor: COLORS.border, color: COLORS.textMuted }} className="rounded-full border p-2 hover:opacity-80 transition-opacity"><CalendarIcon size={18} /></button>
          {canManage && (
            <button onClick={onOpenTasks} aria-label="Tasks" style={{ borderColor: COLORS.border, color: COLORS.textMuted }} className="relative rounded-full border p-2 hover:opacity-80 transition-opacity">
              <ClipboardIcon size={18} />
              {myPendingTaskCount > 0 && (
                <span style={{ backgroundColor: COLORS.orange, color: "#2A1200" }} className="absolute -top-1.5 -right-1.5 rounded-full w-4 h-4 text-[9px] font-bold flex items-center justify-center">
                  {myPendingTaskCount > 9 ? "9+" : myPendingTaskCount}
                </span>
              )}
            </button>
          )}
          {canManage && (
            <button onClick={onOpenAttendance} aria-label="Attendance" style={{ borderColor: COLORS.border, color: COLORS.textMuted }} className="relative rounded-full border p-2 hover:opacity-80 transition-opacity">
              <ClockIcon size={18} />
              {pendingAttendanceCount > 0 && (
                <span style={{ backgroundColor: COLORS.orange, color: "#2A1200" }} className="absolute -top-1.5 -right-1.5 rounded-full w-4 h-4 text-[9px] font-bold flex items-center justify-center">
                  {pendingAttendanceCount > 9 ? "9+" : pendingAttendanceCount}
                </span>
              )}
            </button>
          )}
          <button onClick={onSignOut} aria-label="Sign out" style={{ borderColor: COLORS.border, color: COLORS.textMuted }} className="rounded-full border p-2 hover:opacity-80 transition-opacity"><LogOut size={18} /></button>
        </div>
      </div>

      <AttendanceWidget record={myAttendance} onPunchIn={onPunchIn} onStartBreak={onStartBreak} onEndBreak={onEndBreak} onPunchOut={onPunchOut} />

      {/* Team filter */}
      <div className="flex items-center gap-2 mt-6 mb-4 flex-wrap">
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

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-3">
        <StatCard label="Videos posted" value={totalRuns} color={COLORS.textPrimary} />
        <StatCard label="Long-form" value={longCount} color={COLORS.teal} />
        <StatCard label="Shorts" value={shortsCount} color={COLORS.orange} />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
        <StatCard label="Time tracked" value={formatHours(totalTime)} color={COLORS.orange} />
        <StatCard label="Workflows touched" value={workflowsTouched} color={COLORS.violet} />
        <StatCard label="Avg session" value={formatTime(avgSession)} color={COLORS.teal} />
      </div>

      {/* Daily activity chart */}
      <div style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border }} className="rounded-2xl border p-5 mb-6">
        <p style={{ color: COLORS.textFaint }} className="font-mono text-[11px] tracking-[0.2em] uppercase mb-4">Videos posted, last 14 days</p>
        <DailyBars days={dailyData} onOpenDay={onOpenDay} />
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
          <button key={ch.id} onClick={() => onOpenChannel(ch.id)}
            style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border }}
            className="rounded-2xl border p-5 text-left flex items-center gap-4 hover:brightness-110 transition-all">
            <div style={{ backgroundColor: COLORS.violetSoft, color: COLORS.violet }} className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0">
              <ChannelIcon size={20} />
            </div>
            <div className="flex-1 min-w-0">
              <p style={{ color: COLORS.textPrimary }} className="font-semibold truncate">{ch.name}</p>
              <p style={{ color: COLORS.textFaint }} className="font-mono text-xs mt-0.5">{editorsFor(ch)} editor{editorsFor(ch) === 1 ? "" : "s"} · {videosFor(ch.id)} video{videosFor(ch.id) === 1 ? "" : "s"} posted</p>
            </div>
          </button>
        ))}
        {channels.length === 0 && !newChannelOpen && (
          <p style={{ color: COLORS.textFaint }} className="text-sm italic sm:col-span-2 py-2">No channels yet — add one to start tracking editors and output per channel.</p>
        )}
      </div>

      {/* Team breakdown */}
      {filterUid === "all" && teamStats.length > 0 && (
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
          const hasProgress = !!prog.isComplete || (prog.stepIndex || 0) > 0 || Object.values(prog.stepTimes || {}).some((t) => t > 0);
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
                </div>
                <p style={{ color: COLORS.textFaint }} className="font-mono text-xs mb-1">{w.steps.length} steps · {runsFor(w.id).length} runs{filterUid !== "all" ? " (this user)" : ""}</p>
                <p style={{ color: COLORS.textFaint }} className="font-mono text-xs">{last ? `Last run ${formatDateShort(last.completedAt)}` : "Not started yet"}</p>
              </div>
              <div className="flex items-center gap-2 mt-4">
                <button onClick={() => onOpenWorkflow(w.id)} style={{ backgroundColor: COLORS.teal, color: "#04211D" }}
                  className="flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-bold hover:brightness-105 transition-all active:scale-[0.98]">
                  <Play size={15} /> {hasProgress ? "Continue" : "Start"}
                </button>
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


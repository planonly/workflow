import React, { useState, useMemo } from "react";
import { COLORS, dayKey, displayNameFor, formatTime, formatFullDate } from "../lib/core";
import { ChatIcon, LogOut } from "./Icon";
import { DailyBars, StatCard } from "./shared";

function RecordingCard({ task, onMarkRecorded }) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [link, setLink] = useState("");
  const done = task.status === "done";

  return (
    <div style={{ backgroundColor: COLORS.bgCard, borderColor: done ? COLORS.border : COLORS.violet }} className="rounded-2xl border p-5">
      <div className="flex items-start justify-between gap-3 mb-2">
        <p style={{ color: COLORS.textPrimary }} className="font-semibold text-sm">{task.title}</p>
        {task.dueDate && (
          <span style={{ color: COLORS.textFaint }} className="font-mono text-[11px] shrink-0">Due {task.dueDate}</span>
        )}
      </div>
      <div style={{ backgroundColor: COLORS.bgElevated }} className="rounded-xl p-3 mb-3 max-h-48 overflow-y-auto">
        <p style={{ color: COLORS.textMuted }} className="text-sm whitespace-pre-wrap leading-relaxed">{task.script}</p>
      </div>
      {done ? (
        <p style={{ color: COLORS.teal }} className="text-xs font-semibold">Recorded and handed off for editing.</p>
      ) : linkOpen ? (
        <div className="flex gap-2">
          <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Paste the Dropbox link"
            style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, color: COLORS.textPrimary }}
            className="flex-1 rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2" />
          <button onClick={() => { if (link.trim()) onMarkRecorded(task.id, link.trim()); }}
            disabled={!link.trim()}
            style={{ backgroundColor: COLORS.violet, color: "#1A0B2E", opacity: link.trim() ? 1 : 0.4 }}
            className="rounded-lg px-4 py-2 text-sm font-bold shrink-0">
            Done
          </button>
        </div>
      ) : (
        <button onClick={() => setLinkOpen(true)} style={{ backgroundColor: COLORS.violetSoft, color: COLORS.violet }}
          className="rounded-lg px-4 py-2 text-sm font-bold hover:brightness-110 transition-all">
          Mark recorded
        </button>
      )}
    </div>
  );
}

export default function PartnerDashboard({ user, profiles, channel, workflows, runs, progress, attendance, tasks, onMarkRecorded, onOpenDay, onOpenMessages, unreadRoomCount, onOpenProfile, onSignOut }) {
  const myRecordings = useMemo(
    () => tasks.filter((t) => t.taskType === "record" && t.assignedToUid === user.uid && t.status !== "done")
      .sort((a, b) => (a.dueDate || "9999") < (b.dueDate || "9999") ? -1 : 1),
    [tasks, user.uid]
  );

  const dailyData = useMemo(() => {
    const days = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const dayRuns = runs.filter((r) => dayKey(r.completedAt) === key);
      const wfType = (id) => (workflows.find((w) => w.id === id) || {}).contentType || "long";
      days.push({
        key,
        long: dayRuns.filter((r) => wfType(r.workflowId) === "long").length,
        short: dayRuns.filter((r) => wfType(r.workflowId) === "short").length,
      });
    }
    return days;
  }, [runs, workflows]);

  const last7 = runs.filter((r) => (Date.now() - new Date(r.completedAt).getTime()) < 7 * 86400000);
  const last7Prev = runs.filter((r) => {
    const age = Date.now() - new Date(r.completedAt).getTime();
    return age >= 7 * 86400000 && age < 14 * 86400000;
  });
  const trend = last7Prev.length === 0 ? null : Math.round(((last7.length - last7Prev.length) / last7Prev.length) * 100);

  const workflowIds = new Set(workflows.map((w) => w.id));
  const liveNow = Object.values(progress || {}).filter((pr) => {
    if (!pr || !pr.uid || !pr.lastActiveAt || pr.isComplete) return false;
    if (!workflowIds.has(pr.workflowId)) return false;
    const anyTime = Object.values(pr.stepTimes || {}).some((t) => t > 0);
    if (!((pr.stepIndex || 0) > 0 || anyTime)) return false;
    const ageMins = (Date.now() - new Date(pr.lastActiveAt).getTime()) / 60000;
    return ageMins <= 60;
  }).map((pr) => ({
    name: displayNameFor(pr.uid, profiles),
    // Deliberately no step number or step text here — a partner sees that
    // someone's working, not the internal detail of what step they're on.
    workflowTitle: (workflows.find((w) => w.id === pr.workflowId) || {}).title || "a workflow",
    paused: !!pr.paused,
  }));

  const channelUids = new Set((channel && channel.memberUids) || []);
  const today = new Date().toISOString().slice(0, 10);
  const attendanceToday = Object.values(attendance || {})
    .filter((rec) => rec.date === today && channelUids.has(rec.uid))
    .map((rec) => ({ ...rec, name: displayNameFor(rec.uid, profiles) }));

  return (
    <div className="flex-1 flex flex-col max-w-5xl w-full mx-auto px-6 py-8 sm:py-10 overflow-y-auto fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 style={{ color: COLORS.textPrimary }} className="text-2xl sm:text-3xl font-bold">{channel ? channel.name : "Your channel"}</h2>
          <p style={{ color: COLORS.textFaint }} className="text-sm mt-0.5">Welcome back, {displayNameFor(user.uid, profiles, user.email)}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onOpenMessages} aria-label="Messages" style={{ borderColor: COLORS.border, color: COLORS.textMuted }} className="relative rounded-full border p-2 hover:brightness-150 transition-all">
            <ChatIcon size={18} />
            {unreadRoomCount > 0 && (
              <span style={{ backgroundColor: COLORS.teal, color: "#04211D" }} className="absolute -top-1.5 -right-1.5 rounded-full w-4 h-4 text-[9px] font-bold flex items-center justify-center">
                {unreadRoomCount > 9 ? "9+" : unreadRoomCount}
              </span>
            )}
          </button>
          <button onClick={onOpenProfile} className="flex items-center gap-2 hover:opacity-80 transition-opacity" aria-label="Your profile" title="Your profile">
            <div style={{ backgroundColor: COLORS.tealSoft, color: COLORS.teal }} className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs shrink-0">
              {displayNameFor(user.uid, profiles, user.email).slice(0, 1).toUpperCase()}
            </div>
          </button>
          <button onClick={onSignOut} aria-label="Sign out" style={{ borderColor: COLORS.border, color: COLORS.textMuted }} className="rounded-full border p-2 hover:brightness-150 transition-all">
            <LogOut size={18} />
          </button>
        </div>
      </div>

      {/* Recording queue — the one thing that's actually actionable, so it comes
          first. Always shown, even when empty — a section that just vanishes
          when there's nothing to show is indistinguishable from being broken. */}
      <div className="mb-8">
        <p style={{ color: COLORS.violet }} className="font-mono text-[11px] tracking-[0.2em] uppercase mb-3">Scripts to record</p>
        {myRecordings.length > 0 ? (
          <div className="flex flex-col gap-3">
            {myRecordings.map((t) => <RecordingCard key={t.id} task={t} onMarkRecorded={onMarkRecorded} />)}
          </div>
        ) : (
          <div style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border }} className="rounded-2xl border p-5">
            <p style={{ color: COLORS.textFaint }} className="text-sm italic">Nothing assigned right now — your admin will send a script here when there's one to record.</p>
          </div>
        )}
      </div>

      {/* Performance pulse */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <StatCard label="Videos, last 7 days" value={last7.length} color={COLORS.textPrimary} />
        <StatCard label="Long-form" value={last7.filter((r) => (workflows.find((w) => w.id === r.workflowId) || {}).contentType !== "short").length} color={COLORS.teal} />
        <StatCard label="Shorts" value={last7.filter((r) => (workflows.find((w) => w.id === r.workflowId) || {}).contentType === "short").length} color={COLORS.orange} />
        <StatCard label="Trend vs prior week" value={trend == null ? "—" : `${trend > 0 ? "+" : ""}${trend}%`} color={trend == null ? COLORS.textFaint : trend >= 0 ? COLORS.teal : COLORS.danger} />
      </div>

      <div style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border }} className="rounded-2xl border p-5 mb-6">
        <DailyBars days={dailyData} onOpenDay={onOpenDay} />
      </div>

      {/* Live tracker — step-free */}
      {liveNow.length > 0 && (
        <div style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border }} className="rounded-2xl border p-5 mb-6">
          <p style={{ color: COLORS.textFaint }} className="font-mono text-[11px] tracking-[0.2em] uppercase mb-3">Working on right now</p>
          <div className="flex flex-col gap-2">
            {liveNow.map((a, i) => (
              <div key={i} className="flex items-center justify-between gap-3">
                <span style={{ color: COLORS.textPrimary }} className="text-sm">{a.name} — {a.workflowTitle}</span>
                {a.paused && <span style={{ color: COLORS.orange }} className="font-mono text-[10px]">paused</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Attendance — read only, today's snapshot */}
      <div style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border }} className="rounded-2xl border p-5">
        <p style={{ color: COLORS.textFaint }} className="font-mono text-[11px] tracking-[0.2em] uppercase mb-3">Team today</p>
        {attendanceToday.length === 0 ? (
          <p style={{ color: COLORS.textFaint }} className="text-sm italic">Nobody's clocked in yet today.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {attendanceToday.map((rec) => (
              <div key={rec.uid} className="flex items-center justify-between gap-3">
                <span style={{ color: COLORS.textPrimary }} className="text-sm">{rec.name}</span>
                <span style={{ color: rec.punchOut ? COLORS.textFaint : rec.onBreak ? COLORS.orange : COLORS.teal }} className="font-mono text-xs">
                  {rec.punchOut ? "Clocked out" : rec.onBreak ? "On break" : "On the clock"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

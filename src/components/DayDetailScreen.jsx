import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { COLORS, formatTime, dayKey, attendanceWorkedSeconds, formatClock, displayNameFor, formatFullDate } from "../lib/core";
import { ArrowLeft, ArrowRight, HomeIcon } from "./Icon";
import { StatCard } from "./shared";


export default function DayDetailScreen({ dateKey, workflows, runs, profiles, channels, channelId, attendance, onChangeDate, onBack }) {
  const scopedWorkflowIds = channelId ? new Set(workflows.filter((w) => w.channelId === channelId).map((w) => w.id)) : null;
  const dayRuns = useMemo(
    () => runs.filter((r) => dayKey(r.completedAt) === dateKey && (!scopedWorkflowIds || scopedWorkflowIds.has(r.workflowId))),
    [runs, dateKey, channelId]
  );
  const totalTime = dayRuns.reduce((s, r) => s + r.totalSeconds, 0);
  const workflowById = useMemo(() => {
    const m = {};
    workflows.forEach((w) => { m[w.id] = w; });
    return m;
  }, [workflows]);
  const isShort = (r) => (workflowById[r.workflowId] || {}).contentType === "short";
  const shortsCount = dayRuns.filter(isShort).length;
  const longCount = dayRuns.length - shortsCount;

  const byEditor = {};
  dayRuns.forEach((r) => {
    const eid = r.completedByUid || "unknown";
    if (!byEditor[eid]) byEditor[eid] = { uid: eid, videos: 0, time: 0 };
    byEditor[eid].videos += 1;
    byEditor[eid].time += r.totalSeconds;
  });
  const editorList = Object.values(byEditor)
    .map((e) => ({ ...e, name: displayNameFor(e.uid, profiles, e.uid === "unknown" ? null : undefined) }))
    .sort((a, b) => b.time - a.time);

  const byChannel = {};
  dayRuns.forEach((r) => {
    const wf = workflows.find((w) => w.id === r.workflowId);
    const chId = (wf && wf.channelId) || "none";
    if (!byChannel[chId]) byChannel[chId] = { id: chId, videos: 0, time: 0 };
    byChannel[chId].videos += 1;
    byChannel[chId].time += r.totalSeconds;
  });
  const channelList = Object.values(byChannel).map((c) => ({
    ...c,
    name: c.id === "none" ? "No channel" : ((channels.find((ch) => ch.id === c.id) || {}).name || "Unknown channel"),
  })).sort((a, b) => b.time - a.time);

  const attendanceForDay = useMemo(() => {
    return Object.values(attendance || {})
      .filter((rec) => rec.date === dateKey)
      // This tracks the team's production hours, not whoever happened to
      // punch in — an admin's own clock record isn't part of that.
      .filter((rec) => (profiles[rec.uid] || {}).role !== "admin")
      .map((rec) => ({ ...rec, name: displayNameFor(rec.uid, profiles), worked: attendanceWorkedSeconds(rec) }))
      .sort((a, b) => new Date(a.punchIn) - new Date(b.punchIn));
  }, [attendance, dateKey, profiles]);

  const shiftDay = (delta) => {
    const d = new Date(dateKey + "T00:00:00");
    d.setDate(d.getDate() + delta);
    onChangeDate(d.toISOString().slice(0, 10));
  };

  const isToday = dateKey === new Date().toISOString().slice(0, 10);

  return (
    <div className="flex-1 flex flex-col max-w-3xl w-full mx-auto px-6 py-8 sm:py-10 overflow-y-auto fade-in">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h2 style={{ color: COLORS.textPrimary }} className="text-2xl sm:text-3xl font-bold">Day view</h2>
        <button onClick={onBack} aria-label="Home" style={{ borderColor: COLORS.border, color: COLORS.textMuted }} className="rounded-full border p-2 hover:opacity-80 transition-opacity"><HomeIcon size={18} /></button>
      </div>

      <div className="flex items-center gap-2 mb-6 flex-wrap">
        <button onClick={() => shiftDay(-1)} aria-label="Previous day" style={{ borderColor: COLORS.border, color: COLORS.textMuted }} className="rounded-full border p-2 hover:opacity-80 transition-opacity"><ArrowLeft size={16} /></button>
        <input type="date" value={dateKey} onChange={(e) => onChangeDate(e.target.value)}
          style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, color: COLORS.textPrimary }}
          className="rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2" />
        <button onClick={() => shiftDay(1)} disabled={isToday} aria-label="Next day" style={{ borderColor: COLORS.border, color: COLORS.textMuted, opacity: isToday ? 0.35 : 1 }} className="rounded-full border p-2 hover:opacity-80 transition-opacity disabled:cursor-not-allowed"><ArrowRight size={16} /></button>
        <p style={{ color: COLORS.textFaint }} className="font-mono text-sm ml-1">{formatFullDate(dateKey)}</p>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-3">
        <StatCard label="Videos posted" value={dayRuns.length} color={COLORS.textPrimary} />
        <StatCard label="Long-form" value={longCount} color={COLORS.teal} />
        <StatCard label="Shorts" value={shortsCount} color={COLORS.orange} />
      </div>
      <div className="grid grid-cols-2 gap-3 mb-6">
        <StatCard label="Time worked" value={formatTime(totalTime)} color={COLORS.orange} />
        <StatCard label="Active editors" value={editorList.length} color={COLORS.violet} />
      </div>

      <div style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border }} className="rounded-2xl border p-5 mb-5">
        <p style={{ color: COLORS.textFaint }} className="font-mono text-[11px] tracking-[0.2em] uppercase mb-4">By editor</p>
        {editorList.length === 0 ? (
          <p style={{ color: COLORS.textFaint }} className="text-sm italic">No work logged this day.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {editorList.map((e) => (
              <div key={e.uid} className="flex items-center gap-3">
                <div style={{ backgroundColor: COLORS.tealSoft, color: COLORS.teal }} className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs shrink-0">
                  {e.name.slice(0, 1).toUpperCase()}
                </div>
                <p style={{ color: COLORS.textPrimary }} className="text-sm font-semibold flex-1 truncate">{e.name}</p>
                <p style={{ color: COLORS.textFaint }} className="font-mono text-xs shrink-0">{e.videos} video{e.videos === 1 ? "" : "s"}</p>
                <p style={{ color: COLORS.orange }} className="font-mono text-xs font-semibold shrink-0 w-14 text-right">{formatTime(e.time)}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {!channelId && channelList.length > 0 && (
        <div style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border }} className="rounded-2xl border p-5 mb-5">
          <p style={{ color: COLORS.textFaint }} className="font-mono text-[11px] tracking-[0.2em] uppercase mb-4">By channel</p>
          <div className="flex flex-col gap-3">
            {channelList.map((c) => (
              <div key={c.id} className="flex items-center gap-3">
                <p style={{ color: COLORS.textPrimary }} className="text-sm flex-1 truncate">{c.name}</p>
                <p style={{ color: COLORS.textFaint }} className="font-mono text-xs shrink-0">{c.videos} video{c.videos === 1 ? "" : "s"}</p>
                <p style={{ color: COLORS.violet }} className="font-mono text-xs font-semibold shrink-0 w-14 text-right">{formatTime(c.time)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border }} className="rounded-2xl border p-5 mb-5">
        <p style={{ color: COLORS.textFaint }} className="font-mono text-[11px] tracking-[0.2em] uppercase mb-4">Attendance</p>
        {attendanceForDay.length === 0 ? (
          <p style={{ color: COLORS.textFaint }} className="text-sm italic">No one punched in this day.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {attendanceForDay.map((rec) => (
              <div key={rec.uid} className="flex items-center gap-3">
                <div style={{ backgroundColor: COLORS.tealSoft, color: COLORS.teal }} className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs shrink-0">
                  {rec.name.slice(0, 1).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p style={{ color: COLORS.textPrimary }} className="text-sm font-semibold truncate">{rec.name}</p>
                  <p style={{ color: COLORS.textFaint }} className="font-mono text-[11px]">
                    {formatClock(rec.punchIn)} – {rec.punchOut ? formatClock(rec.punchOut) : "now"}
                    {rec.breaks && rec.breaks.length > 0 ? ` · ${rec.breaks.length} break${rec.breaks.length === 1 ? "" : "s"}` : ""}
                  </p>
                </div>
                <p style={{ color: COLORS.orange }} className="font-mono text-xs font-semibold shrink-0">{formatTime(rec.worked)}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border }} className="rounded-2xl border p-5 mb-4">
        <p style={{ color: COLORS.textFaint }} className="font-mono text-[11px] tracking-[0.2em] uppercase mb-4">Videos posted this day</p>
        {dayRuns.length === 0 ? (
          <p style={{ color: COLORS.textFaint }} className="text-sm italic">Nothing posted this day.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {dayRuns.map((r) => <DayRunRow key={r.id} run={r} profiles={profiles} />)}
          </div>
        )}
      </div>
    </div>
  );
}

function DayRunRow({ run: r, profiles }) {
  const [open, setOpen] = useState(false);
  const steps = (r.stepOrder || []).map((id) => ({
    id, label: (r.stepLabels || {})[id] || id, seconds: (r.stepTimes || {})[id] || 0,
  }));
  return (
    <div style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border }} className="rounded-lg border px-3 py-2">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between gap-3 text-left">
        <div className="flex-1 min-w-0">
          {/* The actual video, not the workflow template it was produced with — the template name shows underneath for context. */}
          <p style={{ color: COLORS.textPrimary }} className="text-sm truncate">{r.taskTitle || r.workflowTitle || "Untitled"}</p>
          {r.taskTitle && r.workflowTitle && (
            <p style={{ color: COLORS.textFaint }} className="font-mono text-[10px] truncate">{r.workflowTitle}</p>
          )}
        </div>
        <span style={{ color: COLORS.textFaint }} className="font-mono text-xs shrink-0">{displayNameFor(r.completedByUid, profiles, r.completedBy)}</span>
        <span style={{ color: COLORS.textMuted }} className="font-mono text-xs font-semibold shrink-0">{formatTime(r.totalSeconds)}</span>
        <span style={{ color: COLORS.teal }} className="font-mono text-[10px] shrink-0">{open ? "Hide" : "Steps"}</span>
      </button>
      {open && steps.length > 0 && (
        <div className="mt-2 pt-2 flex flex-col gap-1" style={{ borderTop: `1px solid ${COLORS.border}` }}>
          {steps.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-3">
              <span style={{ color: COLORS.textMuted }} className="text-xs flex-1 truncate">{s.label}</span>
              <span style={{ color: COLORS.textFaint }} className="font-mono text-[11px] shrink-0">{formatTime(s.seconds)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------- RUN MODE ------------------------- */


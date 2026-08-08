import React, { useState, useEffect, useRef } from "react";
import { COLORS, formatTime, formatFullDate, formatDateShort, formatClock, displayNameFor, attendanceWorkedSeconds, runCode } from "../lib/core";
import { X, ChevronUp, ChevronDown, ClockIcon, CoffeeIcon } from "./Icon";

// Small, reusable pieces shared across multiple screens: stat cards,
// the two chart types, the recent-runs row, and the punch-clock widget.

export function StatCard({ label, value, color }) {
  return (
    <div className="cs-glass rounded-2xl px-4 py-4">
      <p style={{ color: "rgba(255,255,255,0.4)" }} className="font-mono text-[10px] tracking-[0.15em] uppercase mb-1">{label}</p>
      <p style={{ color }} className="text-xl font-bold font-mono">{value}</p>
    </div>
  );
}

/* -------------------------- EDIT MODE -------------------------- */


export function ScreenHeader({ title, onClose }) {
  return (
    <div className="flex items-center justify-between mb-6">
      <h2 style={{ color: COLORS.textPrimary }} className="text-2xl sm:text-3xl font-bold">{title}</h2>
      <button onClick={onClose} aria-label="Close" style={{ borderColor: COLORS.border, color: COLORS.textMuted }} className="rounded-full border p-2 hover:opacity-80 transition-opacity"><X size={18} /></button>
    </div>
  );
}


export function WorkflowSelect({ workflows, activeId, onSelect, noMargin }) {
  return (
    <select
      value={activeId}
      onChange={(e) => onSelect(e.target.value)}
      style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, color: COLORS.textPrimary }}
      className={`rounded-xl border px-4 py-2.5 text-sm font-medium outline-none focus:ring-2 w-full sm:w-auto ${noMargin ? "" : "mb-6"}`}
    >
      {workflows.map((w) => <option key={w.id} value={w.id}>{w.title || "Untitled workflow"}</option>)}
    </select>
  );
}


export function LineSpark({ points, width = 560, height = 120, color }) {
  const [hoverIdx, setHoverIdx] = useState(null);
  if (!points.length) return null;
  // Accepts either plain numbers (backward compatible) or rich points with a
  // label for hover — {value, label}. Normalizing once here means the rest
  // of the component never has to branch on which shape it got.
  const rich = points.map((p) => (typeof p === "object" && p !== null ? p : { value: p, label: null }));
  const values = rich.map((p) => p.value);
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = Math.max(max - min, 1);
  const stepX = rich.length > 1 ? width / (rich.length - 1) : width;
  const coords = rich.map((p, i) => {
    const x = rich.length > 1 ? i * stepX : width / 2;
    const y = height - ((p.value - min) / range) * (height - 16) - 8;
    return [x, y];
  });
  const pathD = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const areaD = `${pathD} L${coords[coords.length - 1][0].toFixed(1)},${height} L0,${height} Z`;
  const gid = "grad-" + Math.random().toString(36).slice(2, 8);

  return (
    <div style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} preserveAspectRatio="none"
        onMouseLeave={() => setHoverIdx(null)}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.28" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={areaD} fill={`url(#${gid})`} stroke="none" />
        <path d={pathD} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        {coords.map(([x, y], i) => (
          <g key={i}>
            {/* A generous invisible hit target — the visible dot alone is too small to hover reliably */}
            <circle cx={x} cy={y} r="12" fill="transparent" onMouseEnter={() => setHoverIdx(i)} style={{ cursor: "pointer" }} />
            <circle cx={x} cy={y} r={hoverIdx === i ? 5 : 3} fill={color} style={{ transition: "r .12s ease" }} />
          </g>
        ))}
      </svg>
      {hoverIdx !== null && (
        <div style={{
          position: "absolute", left: `${(coords[hoverIdx][0] / width) * 100}%`, top: 0,
          transform: `translateX(${hoverIdx === 0 ? "0%" : hoverIdx === rich.length - 1 ? "-100%" : "-50%"})`,
          backgroundColor: COLORS.bgElevated, borderColor: color, color: COLORS.textPrimary,
          pointerEvents: "none", whiteSpace: "nowrap",
        }} className="rounded-lg border px-2.5 py-1.5 text-xs font-mono shadow-lg -mt-2">
          {rich[hoverIdx].label || formatTime(rich[hoverIdx].value)}
        </div>
      )}
    </div>
  );
}


export function DailyBars({ days, onOpenDay }) {
  const [active, setActive] = useState(null);
  const max = Math.max(...days.map((d) => d.long + d.short), 1);
  const totalLong = days.reduce((s, d) => s + d.long, 0);
  const totalShort = days.reduce((s, d) => s + d.short, 0);
  const shown = active != null ? days[active] : null;

  return (
    <div>
      <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
        <p className="font-mono text-sm" style={{ color: "#fff" }}>
          {shown ? formatFullDate(shown.key) : "Last 14 days total"}
        </p>
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs flex items-center gap-1.5" style={{ color: COLORS.teal }}>
            <span style={{ width: 8, height: 8, borderRadius: 9999, backgroundColor: COLORS.teal, display: "inline-block" }} />
            {shown ? shown.long : totalLong} long
          </span>
          <span className="font-mono text-xs flex items-center gap-1.5" style={{ color: COLORS.orange }}>
            <span style={{ width: 8, height: 8, borderRadius: 9999, backgroundColor: COLORS.orange, display: "inline-block" }} />
            {shown ? shown.short : totalShort} shorts
          </span>
          {shown && onOpenDay && (
            <button onClick={() => onOpenDay(shown.key)} style={{ color: COLORS.teal }} className="cs-brighten font-mono text-[11px] tracking-wide underline underline-offset-2">
              View day
            </button>
          )}
        </div>
      </div>
      <div className="flex items-end gap-1.5" style={{ height: 90 }} onMouseLeave={() => setActive(null)}>
        {days.map((d, i) => {
          const total = d.long + d.short;
          const totalH = total > 0 ? Math.max(6, (total / max) * 80) : 3;
          const shortH = total > 0 ? (d.short / total) * totalH : 0;
          const longH = total > 0 ? (d.long / total) * totalH : 0;
          const isActive = active === i;
          return (
            <button key={i} type="button"
              onMouseEnter={() => setActive(i)}
              onClick={() => (active === i && onOpenDay ? onOpenDay(d.key) : setActive(i))}
              className="flex-1 flex flex-col items-center justify-end gap-1.5 outline-none">
              <div className="w-full rounded-t-sm overflow-hidden flex flex-col" style={{ height: totalH }}>
                {total === 0 ? (
                  <div className="w-full h-full" style={{ background: "rgba(255,255,255,0.08)" }} />
                ) : (
                  <React.Fragment>
                    {d.short > 0 && <div style={{ height: shortH, backgroundColor: COLORS.orange, opacity: isActive ? 1 : 0.8 }} />}
                    {d.long > 0 && <div style={{ height: longH, backgroundColor: COLORS.teal, opacity: isActive ? 1 : 0.8 }} />}
                  </React.Fragment>
                )}
              </div>
              <span className="font-mono text-[9px] transition-colors" style={{ color: isActive ? "#fff" : "rgba(255,255,255,0.3)" }}>{d.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------------------- CHANNEL DASHBOARD ---------------------------- */


export function RunRow({ run, profiles, isOpen, onToggle, onDelete, onSave }) {
  const stepIds = run.stepOrder || Object.keys(run.stepTimes || {});
  const [editing, setEditing] = useState(false);
  const [minutes, setMinutes] = useState(() => {
    const m = {};
    stepIds.forEach((sid) => { m[sid] = ((run.stepTimes && run.stepTimes[sid]) || 0) / 60; });
    return m;
  });

  const startEdit = () => {
    const m = {};
    stepIds.forEach((sid) => { m[sid] = ((run.stepTimes && run.stepTimes[sid]) || 0) / 60; });
    setMinutes(m);
    setEditing(true);
  };

  const commit = () => {
    const newStepTimes = {};
    let total = 0;
    stepIds.forEach((sid) => {
      const secs = Math.max(0, (parseFloat(minutes[sid]) || 0) * 60);
      newStepTimes[sid] = secs;
      total += secs;
    });
    onSave({ ...run, stepTimes: newStepTimes, totalSeconds: total });
    setEditing(false);
  };

  return (
    <div style={{ borderColor: COLORS.border }} className="border-b last:border-b-0 py-2">
      <div className="flex items-center justify-between gap-3">
        <button onClick={onToggle} className="flex-1 text-left flex items-center gap-2 min-w-0">
          {isOpen ? <ChevronUp size={13} style={{ color: COLORS.textFaint }} /> : <ChevronDown size={13} style={{ color: COLORS.textFaint }} />}
          <span style={{ color: COLORS.violet }} className="font-mono text-xs font-bold shrink-0">{runCode(run.id)}</span>
          {run.contentType && (
            <span style={{ backgroundColor: run.contentType === "short" ? COLORS.orangeSoft : run.contentType === "checking" ? COLORS.violetSoft : COLORS.tealSoft, color: run.contentType === "short" ? COLORS.orange : run.contentType === "checking" ? COLORS.violet : COLORS.teal }}
              className="font-mono text-[9px] rounded-full px-1.5 py-0.5 shrink-0 uppercase">
              {run.contentType === "short" ? "Short" : run.contentType === "checking" ? "Checking" : "Long"}
            </span>
          )}
          <span className="min-w-0 truncate">
            {run.taskTitle && (
              <span style={{ color: COLORS.textPrimary }} className="text-xs">{run.taskTitle} · </span>
            )}
            <span style={{ color: COLORS.textMuted }} className="font-mono text-xs">
              {formatDateShort(run.completedAt)}{run.completedBy ? ` · ${displayNameFor(run.completedByUid, profiles, run.completedBy)}` : ""}
            </span>
          </span>
        </button>
        <div className="flex items-center gap-2 shrink-0">
          <span style={{ color: COLORS.textPrimary }} className="font-mono text-xs font-semibold">{formatTime(run.totalSeconds)}</span>
          <button onClick={onDelete} aria-label="Delete run" style={{ color: COLORS.textFaint }} className="hover:opacity-70"><X size={14} /></button>
        </div>
      </div>

      {isOpen && !editing && (
        <div style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border }} className="rounded-xl border p-3 mt-2 flex flex-col gap-1.5">
          {stepIds.map((sid) => (
            <div key={sid} className="flex items-center justify-between gap-2">
              <span style={{ color: COLORS.textMuted }} className="text-xs flex-1 truncate">{(run.stepLabels && run.stepLabels[sid]) || "Step"}</span>
              <span style={{ color: COLORS.orange }} className="font-mono text-xs shrink-0">{formatTime((run.stepTimes && run.stepTimes[sid]) || 0)}</span>
            </div>
          ))}
          <button onClick={startEdit} style={{ color: COLORS.teal }} className="font-mono text-[11px] tracking-wide hover:opacity-80 mt-1.5 text-left">
            Edit these times
          </button>
        </div>
      )}

      {isOpen && editing && (
        <div style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border }} className="rounded-xl border p-3 mt-2 flex flex-col gap-2">
          {stepIds.map((sid) => (
            <div key={sid} className="flex items-center gap-2">
              <span style={{ color: COLORS.textMuted }} className="text-xs flex-1 truncate">{(run.stepLabels && run.stepLabels[sid]) || "Step"}</span>
              <input type="number" min="0" step="0.1" value={minutes[sid]}
                onChange={(e) => setMinutes((m) => ({ ...m, [sid]: e.target.value }))}
                style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border, color: COLORS.textPrimary }}
                className="w-20 rounded-lg border px-2 py-1 text-xs outline-none focus:ring-2" />
              <span style={{ color: COLORS.textFaint }} className="text-[10px] font-mono">min</span>
            </div>
          ))}
          <div className="flex gap-2 mt-1">
            <button onClick={() => setEditing(false)} style={{ borderColor: COLORS.border, color: COLORS.textMuted }} className="flex-1 rounded-lg border py-2 text-xs font-semibold hover:opacity-80">
              Cancel
            </button>
            <button onClick={commit} style={{ backgroundColor: COLORS.tealSoft, color: COLORS.teal }} className="flex-1 rounded-lg py-2 text-xs font-semibold hover:brightness-110 transition-all">
              Save changes
            </button>
          </div>
        </div>
      )}
    </div>
  );
}


export function AttendanceWidget({ record, onPunchIn, onStartBreak, onEndBreak, onPunchOut, onUndoPunchOut }) {
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (!record || record.punchOut) return;
    const id = setInterval(() => forceTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [record]);

  const worked = attendanceWorkedSeconds(record);
  const status = !record ? "out" : record.punchOut ? "done" : record.onBreak ? "break" : "in";
  const accentColor = status === "in" ? COLORS.teal : status === "break" ? COLORS.orange : COLORS.border;

  // A status CHANGE (not just the current status) is what deserves the
  // "just happened" treatment — the stamp ring, the bounce, the label
  // sliding in. Comparing against the previous render is what makes that
  // possible instead of re-playing the animation on every re-render.
  const prevStatusRef = useRef(status);
  const [justChanged, setJustChanged] = useState(false);
  useEffect(() => {
    if (prevStatusRef.current !== status) {
      setJustChanged(true);
      const t = setTimeout(() => setJustChanged(false), 700);
      prevStatusRef.current = status;
      return () => clearTimeout(t);
    }
  }, [status]);

  return (
    <div className="cs-glass rounded-2xl p-5 mb-6 flex items-center justify-between flex-wrap gap-4"
      style={{ borderColor: accentColor === COLORS.border ? "rgba(255,255,255,0.2)" : accentColor, transition: "border-color .45s ease" }}>
      <style>{`
        @keyframes aw-stamp-ring {
          0% { transform: scale(0.6); opacity: 0.55; }
          100% { transform: scale(2.1); opacity: 0; }
        }
        @keyframes aw-badge-bounce {
          0% { transform: scale(0.85); }
          55% { transform: scale(1.12); }
          100% { transform: scale(1); }
        }
        @keyframes aw-label-in {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: none; }
        }
        .aw-badge { position: relative; transition: background-color .45s ease, color .45s ease; }
        .aw-badge.changed { animation: aw-badge-bounce .5s cubic-bezier(.34,1.56,.64,1); }
        .aw-ring { position: absolute; inset: 0; border-radius: 12px; border: 2px solid currentColor; animation: aw-stamp-ring .7s ease-out; pointer-events: none; }
        .aw-icon-layer { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; transition: opacity .35s ease, transform .35s ease; pointer-events: none; }
        .aw-label.changed { animation: aw-label-in .35s ease both; }
        @media (prefers-reduced-motion: reduce) {
          .aw-badge.changed, .aw-ring, .aw-label.changed { animation: none !important; }
        }
      `}</style>

      <div className="flex items-center gap-3">
        <div className={`aw-badge w-11 h-11 rounded-xl flex items-center justify-center shrink-0${justChanged ? " changed" : ""}`}
          style={{
            background: status === "in" ? "rgba(45,212,196,0.18)" : status === "break" ? "rgba(242,120,75,0.18)" : "rgba(255,255,255,0.08)",
            color: status === "in" ? COLORS.teal : status === "break" ? COLORS.orange : "rgba(255,255,255,0.6)",
          }}>
          {justChanged && <span className="aw-ring" />}
          {/* Crossfading both icons instead of a hard conditional swap — a
              clock-to-coffee change reads as a transition, not a pop. */}
          <span className="aw-icon-layer" style={{ opacity: status === "break" ? 1 : 0, transform: status === "break" ? "scale(1)" : "scale(0.7)" }}>
            <CoffeeIcon size={20} />
          </span>
          <span className="aw-icon-layer" style={{ opacity: status === "break" ? 0 : 1, transform: status === "break" ? "scale(0.7)" : "scale(1)" }}>
            <ClockIcon size={20} />
          </span>
        </div>
        <div>
          <p key={status} style={{ color: "#fff" }} className={`font-semibold text-sm aw-label${justChanged ? " changed" : ""}`}>
            {status === "out" && "Not clocked in"}
            {status === "in" && "On the clock"}
            {status === "break" && "On a break"}
            {status === "done" && "Clocked out for today"}
          </p>
          <p style={{ color: "rgba(255,255,255,0.4)" }} className="font-mono text-xs mt-0.5">
            {record ? `Since ${formatClock(record.punchIn)} · ${formatTime(worked)} worked` : "Punch in to start tracking today"}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {status === "out" && (
          <button onClick={onPunchIn} style={{ color: COLORS.teal }} className="cs-glass cs-glass-hover cs-spring rounded-xl px-4 py-2.5 text-sm font-bold">Punch In</button>
        )}
        {status === "in" && (
          <React.Fragment>
            <button onClick={onStartBreak} style={{ color: "rgba(255,255,255,0.7)" }} className="cs-glass cs-glass-hover cs-spring rounded-xl px-4 py-2.5 text-sm font-semibold">Take a break</button>
            <button onClick={onPunchOut} style={{ backgroundColor: COLORS.danger, color: "#2A0A0A" }} className="cs-spring rounded-xl px-4 py-2.5 text-sm font-bold hover:brightness-105 active:scale-95">Punch Out</button>
          </React.Fragment>
        )}
        {status === "break" && (
          <React.Fragment>
            <button onClick={onEndBreak} style={{ color: COLORS.orange }} className="cs-glass cs-glass-hover cs-spring rounded-xl px-4 py-2.5 text-sm font-bold">End break</button>
            <button onClick={onPunchOut} style={{ backgroundColor: COLORS.danger, color: "#2A0A0A" }} className="cs-spring rounded-xl px-4 py-2.5 text-sm font-bold hover:brightness-105 active:scale-95">Punch Out</button>
          </React.Fragment>
        )}
        {status === "done" && onUndoPunchOut && (
          <button onClick={() => { if (window.confirm("Undo this punch out and go back on the clock?")) onUndoPunchOut(); }}
            style={{ color: "rgba(255,255,255,0.7)" }}
            className="cs-glass cs-glass-hover cs-spring rounded-xl px-4 py-2.5 text-sm font-semibold">
            Punched out by mistake?
          </button>
        )}
      </div>
    </div>
  );
}

/* ---------------------------- TASKS SCREEN ---------------------------- */


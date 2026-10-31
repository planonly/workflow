import React, { useState, useEffect } from "react";
import { COLORS, dayKey } from "../lib/core";
import { history, streakOf, dayResult } from "../lib/targets";

// Shared pieces for the Targets feature: the progress bars, the day-by-day
// strip, and the card an editor sees on their own dashboard. The supervisor
// screen builds on the same pieces so the two never disagree on what a "hit"
// looks like.

// Today's local date key, refreshed once a minute so a screen left open past
// midnight rolls over to the new day on its own instead of showing yesterday.
export function useTodayKey() {
  const [dk, setDk] = useState(() => dayKey(new Date().toISOString()));
  useEffect(() => {
    const id = setInterval(() => {
      const next = dayKey(new Date().toISOString());
      setDk((cur) => (cur === next ? cur : next));
    }, 60000);
    return () => clearInterval(id);
  }, []);
  return dk;
}

const STATUS_STYLE = {
  hit:         { bg: COLORS.teal,   border: COLORS.teal,   label: "Target hit" },
  partial:     { bg: COLORS.orange, border: COLORS.orange, label: "Fell short" },
  missed:      { bg: COLORS.danger, border: COLORS.danger, label: "Missed" },
  off:         { bg: "transparent", border: COLORS.border, label: "Day off" },
  in_progress: { bg: COLORS.tealSoft, border: COLORS.teal, label: "In progress" },
  none:        { bg: "transparent", border: COLORS.border, label: "No target" },
};

const WEEKDAY = ["S", "M", "T", "W", "T", "F", "S"];
const weekdayOf = (dk) => {
  const [y, m, d] = dk.split("-").map(Number);
  return new Date(y, m - 1, d, 12).getDay();
};

function describeDay(d) {
  const st = STATUS_STYLE[d.status];
  if (!d.parts.length) return `${d.dk} — ${st.label}`;
  return `${d.dk} — ${st.label}: ` + d.parts.map((p) => `${p.done}/${p.goal} ${p.label.toLowerCase()}`).join(", ");
}

export function HistoryStrip({ hist, compact }) {
  // hist is newest-first; read left-to-right oldest-to-newest.
  const ordered = [...hist].reverse();
  const size = compact ? "w-5 h-5" : "w-6 h-6";
  return (
    <div className="flex items-end gap-1 flex-wrap">
      {ordered.map((d) => {
        const st = STATUS_STYLE[d.status];
        return (
          <div key={d.dk} className="flex flex-col items-center gap-0.5" title={describeDay(d)}>
            <div style={{ backgroundColor: st.bg, borderColor: st.border }}
              className={`${size} rounded-md border ${d.status === "off" || d.status === "none" ? "border-dashed" : ""}`}
              data-status={d.status} data-testid="history-cell" />
            <span style={{ color: COLORS.textFaint }} className="text-[8px] font-mono leading-none">{WEEKDAY[weekdayOf(d.dk)]}</span>
          </div>
        );
      })}
    </div>
  );
}

export function ProgressRows({ parts }) {
  return (
    <div className="flex flex-col gap-2">
      {parts.map((p) => {
        const ratio = Math.min(1, p.done / p.goal);
        const color = p.met ? COLORS.teal : COLORS.orange;
        return (
          <div key={p.key} data-testid="progress-row">
            <div className="flex items-baseline justify-between mb-1">
              <span style={{ color: COLORS.textMuted }} className="text-xs">{p.label}</span>
              <span style={{ color: p.met ? COLORS.teal : COLORS.textPrimary }} className="font-mono text-xs font-semibold">
                {p.done}<span style={{ color: COLORS.textFaint }} className="font-normal"> / {p.goal}</span>
                {p.met ? " ✓" : ""}
              </span>
            </div>
            <div style={{ backgroundColor: COLORS.bgElevated }} className="h-1.5 rounded-full overflow-hidden">
              <div style={{ width: `${Math.round(ratio * 100)}%`, backgroundColor: color, transition: "width 0.3s" }} className="h-full rounded-full" />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function StreakBadge({ streak }) {
  if (!streak) return null;
  return (
    <span style={{ backgroundColor: COLORS.orangeSoft, color: COLORS.orange }} className="font-mono text-[10px] rounded-full px-2 py-0.5 whitespace-nowrap" data-testid="streak-badge">
      {streak}-day streak
    </span>
  );
}

// The editor's own view, on their dashboard. Renders nothing at all when no
// target applies to them — no empty box, no "ask your supervisor" prompt.
export function MyTargetsCard({ ctx }) {
  const todayDk = useTodayKey();
  if (!ctx) return null;
  const { uid: uidVal, targets, runs, tasks, attendance } = ctx;
  const args = { uid: uidVal, todayDk, targets, runs, tasks, attendance };
  const today = dayResult({ ...args, dk: todayDk });
  if (today.status === "none") return null;
  const hist = history({ ...args, days: 7 });
  const streak = streakOf(hist);
  const hit = today.status === "hit";
  return (
    <div style={{ backgroundColor: COLORS.bgCard, borderColor: hit ? COLORS.teal : COLORS.border }}
      className="rounded-2xl border px-4 py-4 mt-4" data-testid="my-targets">
      <div className="flex items-center justify-between gap-2 mb-3">
        <p style={{ color: COLORS.textFaint }} className="font-mono text-[10px] tracking-[0.15em] uppercase">Today's targets</p>
        <div className="flex items-center gap-2">
          <StreakBadge streak={streak} />
          {hit && (
            <span style={{ backgroundColor: COLORS.tealSoft, color: COLORS.teal }} className="font-mono text-[10px] rounded-full px-2 py-0.5">All done</span>
          )}
        </div>
      </div>
      <ProgressRows parts={today.parts} />
      <div className="mt-4">
        <HistoryStrip hist={hist} compact />
      </div>
    </div>
  );
}


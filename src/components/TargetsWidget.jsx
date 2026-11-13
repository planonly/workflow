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


// ---- The always-there pill ------------------------------------------------
// Sits in the bottom corner of every screen. It can shrink to a small chip so
// it never has to cover what someone is working on, but it can't be closed —
// the point is that today's target is always one glance away.
//
// An editor sees their own progress. A supervisor sees how the team is doing
// (and their own target too, in the rare case one has been set for them).
// Someone with nothing to show — no target of their own and no team to watch
// — gets no pill at all rather than an empty one.
const PILL_KEY = "targets-pill-collapsed";

function capped(parts) {
  const goal = parts.reduce((n, p) => n + p.goal, 0);
  const done = parts.reduce((n, p) => n + Math.min(p.done, p.goal), 0);
  return { done, goal };
}

export function TargetsPill({ uid: uidVal, isSupervisor, editors, targets, runs, tasks, attendance, onOpenTargets, raised }) {
  const todayDk = useTodayKey();
  const [collapsed, setCollapsed] = useState(() => {
    try { return window.localStorage.getItem(PILL_KEY) === "1"; } catch (e) { return false; }
  });
  const toggle = () => setCollapsed((c) => {
    const next = !c;
    try { window.localStorage.setItem(PILL_KEY, next ? "1" : "0"); } catch (e) { /* not remembered, still works */ }
    return next;
  });

  const base = { todayDk, targets, runs, tasks, attendance };
  const mine = dayResult({ ...base, uid: uidVal, dk: todayDk });
  const hasMine = mine.status !== "none";
  const team = isSupervisor
    ? (editors || []).filter((e) => e.uid !== uidVal)
      .map((e) => ({ ...e, day: dayResult({ ...base, uid: e.uid, dk: todayDk }) }))
      .filter((e) => e.day.status !== "none")
    : [];
  if (!hasMine && !team.length) return null;

  const mineTotals = hasMine ? capped(mine.parts) : null;
  const mineHit = hasMine && mine.status === "hit";
  const teamHit = team.filter((e) => e.day.status === "hit").length;
  const allGood = hasMine ? mineHit : team.length > 0 && teamHit === team.length;
  const streak = hasMine ? streakOf(history({ ...base, uid: uidVal, days: 14 })) : 0;
  const chipText = hasMine ? `${mineTotals.done}/${mineTotals.goal}` : `${teamHit}/${team.length}`;
  const chipLabel = hasMine
    ? `Today's target: ${mineTotals.done} of ${mineTotals.goal} done. Show details.`
    : `${teamHit} of ${team.length} editors on target today. Show details.`;

  const place = { position: "fixed", right: 16, bottom: `calc(${raised ? 88 : 16}px + env(safe-area-inset-bottom, 0px))`, zIndex: 40 };
  const ring = (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
      <circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="0.6" fill="currentColor" />
    </svg>
  );

  if (collapsed) {
    return (
      <button onClick={toggle} aria-expanded="false" aria-label={chipLabel} title={chipLabel} data-testid="targets-chip"
        style={{ ...place, minHeight: 44, padding: "0 14px", borderRadius: 999, boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
          backgroundColor: allGood ? COLORS.teal : COLORS.bgCard, color: allGood ? "#04211D" : COLORS.textPrimary,
          border: `1px solid ${allGood ? COLORS.teal : COLORS.border}` }}
        className="flex items-center gap-2 font-mono text-sm font-bold">
        <span style={{ color: allGood ? "#04211D" : COLORS.teal }} className="flex">{ring}</span>
        {chipText}{allGood ? " ✓" : ""}
      </button>
    );
  }

  return (
    <aside aria-label="Today's targets" data-testid="targets-pill"
      style={{ ...place, width: 268, maxWidth: "calc(100vw - 32px)", maxHeight: "70vh", overflowY: "auto", borderRadius: 16, boxShadow: "0 12px 32px rgba(0,0,0,0.55)",
        backgroundColor: COLORS.bgCard, border: `1px solid ${allGood ? COLORS.teal : COLORS.border}`, color: COLORS.textPrimary }}
      className="px-4 py-3">
      <div className="flex items-center justify-between gap-2 mb-2.5">
        <span style={{ color: COLORS.teal }} className="flex items-center gap-2 font-mono text-[10px] tracking-[0.15em] uppercase font-bold">
          {ring}{hasMine ? "Today's targets" : "Team targets today"}
        </span>
        <button onClick={toggle} aria-expanded="true" aria-label="Shrink the targets widget" title="Shrink" data-testid="targets-shrink"
          style={{ color: COLORS.textMuted, width: 32, height: 32, borderRadius: 8, border: `1px solid ${COLORS.border}` }}
          className="flex items-center justify-center shrink-0">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
        </button>
      </div>

      {hasMine && (
        <div data-testid="targets-mine">
          <ProgressRows parts={mine.parts} />
          <div className="flex items-center gap-2 mt-2.5 flex-wrap">
            {mineHit && <span style={{ backgroundColor: COLORS.tealSoft, color: COLORS.teal }} className="font-mono text-[10px] rounded-full px-2 py-0.5">All done</span>}
            <StreakBadge streak={streak} />
            {!mineHit && !streak && <span style={{ color: COLORS.textMuted }} className="text-[11px]">{mineTotals.goal - mineTotals.done} to go today</span>}
          </div>
        </div>
      )}

      {team.length > 0 && (
        <div data-testid="targets-team" className={hasMine ? "mt-3 pt-3" : ""} style={hasMine ? { borderTop: `1px solid ${COLORS.border}` } : undefined}>
          <p style={{ color: COLORS.textPrimary }} className="text-sm font-semibold mb-2">
            {teamHit} of {team.length} editor{team.length === 1 ? "" : "s"} on target
          </p>
          <div className="flex flex-col gap-1.5">
            {team.map((e) => {
              const t = capped(e.day.parts); const hit = e.day.status === "hit";
              return (
                <div key={e.uid} className="flex items-center justify-between gap-3" data-testid="targets-team-row">
                  <span style={{ color: COLORS.textMuted }} className="text-xs truncate">{e.name}</span>
                  <span style={{ color: hit ? COLORS.teal : COLORS.textPrimary }} className="font-mono text-xs font-semibold shrink-0">{t.done}/{t.goal}{hit ? " ✓" : ""}</span>
                </div>
              );
            })}
          </div>
          {onOpenTargets && (
            <button onClick={onOpenTargets} style={{ color: COLORS.teal, minHeight: 32 }} className="font-mono text-[11px] font-semibold mt-2" data-testid="targets-open">
              Open Targets →
            </button>
          )}
        </div>
      )}
    </aside>
  );
}

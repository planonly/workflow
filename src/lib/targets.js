// Daily targets for editors — pure logic, no React or Firebase in here.
//
// A target is a per-editor daily goal across up to three measures:
//   long   — completed long-form runs
//   shorts — completed short runs
//   tasks  — assigned tasks marked done
// 0 for a measure means "no goal for this one" and it's ignored everywhere
// (progress, hit/miss, streaks) rather than counting as trivially met.
//
// Progress is never entered by hand — it's counted from the same runs and
// tasks the rest of the app already records, so a target can't drift from
// what actually happened.

import { dayKey } from "./core";

export const DEFAULT_TARGET_KEY = "_default";
export const MEASURES = [
  { key: "long", label: "Long-form", short: "long" },
  { key: "shorts", label: "Shorts", short: "shorts" },
  { key: "tasks", label: "Tasks", short: "tasks" },
];

const toCount = (v) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.min(n, 999) : 0;
};

export function normalizeTarget(t) {
  return { long: toCount(t && t.long), shorts: toCount(t && t.shorts), tasks: toCount(t && t.tasks) };
}

export function hasAnyTarget(t) {
  const n = normalizeTarget(t);
  return n.long + n.shorts + n.tasks > 0;
}

// An editor's own target wins; otherwise the team default applies. An
// editor explicitly saved with all zeros is respected as "no target" rather
// than silently falling through to the default.
export function resolveTarget(targets, uidVal) {
  const map = targets || {};
  if (map[uidVal]) return { target: normalizeTarget(map[uidVal]), source: "own" };
  if (map[DEFAULT_TARGET_KEY]) return { target: normalizeTarget(map[DEFAULT_TARGET_KEY]), source: "default" };
  return { target: normalizeTarget(null), source: "none" };
}

// Calendar-day arithmetic on "YYYY-MM-DD" keys. Built at local noon so a
// daylight-saving shift can never push the result onto the wrong date.
export function shiftDay(dk, delta) {
  const [y, m, d] = dk.split("-").map(Number);
  const dt = new Date(y, m - 1, d + delta, 12, 0, 0);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

// What an editor actually got done on one local calendar day.
export function countsForDay({ uid: uidVal, dk, runs, tasks }) {
  let long = 0, shorts = 0, taskCount = 0;
  (runs || []).forEach((r) => {
    if (r.completedByUid !== uidVal || !r.completedAt) return;
    if (dayKey(r.completedAt) !== dk) return;
    if (r.contentType === "short") shorts += 1; else long += 1;
  });
  (tasks || []).forEach((t) => {
    if (t.assignedToUid !== uidVal || t.status !== "done" || !t.doneAt) return;
    if (dayKey(t.doneAt) !== dk) return;
    taskCount += 1;
  });
  return { long, shorts, tasks: taskCount };
}

// A day only counts against someone if they were actually working: either
// they punched in, or they got something done anyway (forgetting to punch in
// shouldn't turn a productive day into an "off" day). Everything else is a
// day off — leave, weekend, not scheduled — and is never a miss.
export function wasActive({ uid: uidVal, dk, attendance, counts }) {
  const rec = attendance && attendance[`${uidVal}_${dk}`];
  if (rec && rec.punchIn) return true;
  return !!counts && counts.long + counts.shorts + counts.tasks > 0;
}

// Per-measure progress plus one overall 0..1 figure (the mean of each
// measure that actually has a goal, each capped at 100% so overshooting
// shorts can't paper over zero long-form).
export function evaluate(target, counts) {
  const t = normalizeTarget(target);
  const parts = MEASURES.map((m) => ({
    key: m.key, label: m.label, goal: t[m.key], done: counts[m.key] || 0,
    met: t[m.key] > 0 ? (counts[m.key] || 0) >= t[m.key] : null,
  })).filter((p) => p.goal > 0);
  if (!parts.length) return { parts, pct: null, hit: false, anyProgress: false };
  const pct = parts.reduce((s, p) => s + Math.min(1, p.done / p.goal), 0) / parts.length;
  return {
    parts, pct,
    hit: parts.every((p) => p.met),
    anyProgress: parts.some((p) => p.done > 0),
  };
}

// One day's verdict.
//   none        — no target is set for this editor
//   off         — not a working day for them (never a miss)
//   hit         — every measure with a goal was met
//   partial     — worked, made progress, but fell short
//   missed      — worked (punched in) but nothing counted toward the target
//   in_progress — today, not finished yet, so not judged
export function dayResult({ uid: uidVal, dk, todayDk, targets, runs, tasks, attendance }) {
  const { target } = resolveTarget(targets, uidVal);
  const counts = countsForDay({ uid: uidVal, dk, runs, tasks });
  const ev = evaluate(target, counts);
  const base = { dk, counts, target, parts: ev.parts, pct: ev.pct };
  if (!ev.parts.length) return { ...base, status: "none" };
  if (ev.hit) return { ...base, status: "hit" };
  const active = wasActive({ uid: uidVal, dk, attendance, counts });
  if (dk === todayDk) return { ...base, status: "in_progress" };
  if (!active) return { ...base, status: "off" };
  return { ...base, status: ev.anyProgress ? "partial" : "missed" };
}

// The last `days` days ending today, newest first.
export function history({ uid: uidVal, days, todayDk, targets, runs, tasks, attendance }) {
  const out = [];
  for (let i = 0; i < days; i++) {
    const dk = shiftDay(todayDk, -i);
    out.push(dayResult({ uid: uidVal, dk, todayDk, targets, runs, tasks, attendance }));
  }
  return out;
}

// Consecutive hit days, newest back. Days off are skipped (they neither
// extend nor break it). Today only extends the streak if it's already a
// hit — an unfinished today never breaks it. A partial or missed day ends it.
export function streakOf(hist) {
  let n = 0;
  for (const d of hist) {
    if (d.status === "hit") n += 1;
    else if (d.status === "off" || d.status === "in_progress" || d.status === "none") continue;
    else break;
  }
  return n;
}

// Roll-up over a history window: hit days out of days that were actually
// judged (hit + partial + missed), so days off don't dilute the rate.
export function hitRate(hist) {
  const judged = hist.filter((d) => d.status === "hit" || d.status === "partial" || d.status === "missed");
  const hits = judged.filter((d) => d.status === "hit").length;
  return { hits, judged: judged.length, rate: judged.length ? hits / judged.length : null };
}

// Where one person's time on the clock went, for one day.
//
// Sources, all of which already exist or are logged on the attendance record:
//   - the punch record (in, out, breaks)                      -> time on the clock
//   - finished runs + the run in progress                     -> "in workflows"
//   - rec.log entries the app writes as things happen:
//       k:"cs"  time with Clip Studio open and in use
//       k:"dl"  a download started from a task
//       k:"ot"  a timer the editor started for other work ("exporting")
//       k:"gap" the editor's answer to "what were you doing from A to B?"
//
// Every second on the clock lands in exactly one bucket. When two things
// overlap (editing one video while the next downloads) the higher one wins:
// workflow > Clip Studio > download > explained. Whatever is left is a gap:
// short gaps are normal and are not questioned; a gap of GAP_ASK_MIN minutes
// or more is "unexplained" until the editor says what it was.
//
// Pure functions only — no React, no Firebase — so each rule can be checked.

import { dayKey } from "./core";

export const GAP_ASK_MIN = 20;      // a gap this long gets a "what were you doing?" question
export const NUDGE_MIN = 15;        // nothing timed for this long -> the corner widget speaks up
export const DOWNLOAD_CAP_MIN = 180; // a download nobody closed stops counting after this
// The moment the app started recording downloads, Clip Studio time and reasons.
export const TRACKING_SINCE_MS = Date.parse("2026-11-14T11:00:00Z");
export const DEFAULT_EXPECT = { accountedPct: 70, unexplainedMax: 30 };

export const REASONS = [
  ["export", "Exporting or rendering"],
  ["upload", "Uploading"],
  ["thumb", "Thumbnail"],
  ["waiting", "Waiting on source or instructions"],
  ["tech", "Technical problem"],
  ["call", "Call or meeting"],
];
export const BREAK_REASON = "missed_break";
const REASON_LABEL = Object.fromEntries(REASONS);
export function reasonLabel(entry) {
  if (!entry) return "";
  if (entry.reason === BREAK_REASON) return "Was on a break (not punched)";
  if (entry.reason === "other") return (entry.note || "").trim() || "Something else";
  return REASON_LABEL[entry.reason] || entry.reason || "Something else";
}

export function normalizeExpect(v) {
  const num = (x) => (x === null || x === undefined || x === "" ? NaN : Math.round(Number(x)));
  const pct = num(v ? v.accountedPct : null);
  const max = num(v ? v.unexplainedMax : null);
  return {
    accountedPct: Number.isFinite(pct) && pct >= 0 && pct <= 100 ? pct : DEFAULT_EXPECT.accountedPct,
    unexplainedMax: Number.isFinite(max) && max >= 0 && max <= 600 ? max : DEFAULT_EXPECT.unexplainedMax,
  };
}

const ms = (iso) => (iso ? new Date(iso).getTime() : NaN);
const PRIORITY = ["wf", "cs", "dl", "ex"];

// [[s,e],...] -> sorted, merged, clipped to [lo,hi]
function tidy(list, lo, hi) {
  const out = [];
  list.map(([s, e]) => [Math.max(s, lo), Math.min(e, hi)]).filter(([s, e]) => Number.isFinite(s) && Number.isFinite(e) && e > s)
    .sort((a, b) => a[0] - b[0])
    .forEach((iv) => { const last = out[out.length - 1]; if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1]); else out.push([iv[0], iv[1]]); });
  return out;
}
function subtract(base, holes) {
  let out = base.map((x) => [x[0], x[1]]);
  holes.forEach(([hs, he]) => {
    const next = [];
    out.forEach(([s, e]) => {
      if (he <= s || hs >= e) { next.push([s, e]); return; }
      if (hs > s) next.push([s, hs]);
      if (he < e) next.push([he, e]);
    });
    out = next;
  });
  return out;
}
const total = (list) => list.reduce((s, [a, b]) => s + (b - a), 0) / 1000;

// When each workflow run was (roughly) happening. A finished run is placed
// ending at its finish time and lasting its tracked time; pauses inside a run
// are not recorded anywhere, so a run with a long pause reads as starting
// later than it really did.
export function workflowIntervals({ uid, runs, live, lo, hi, now }) {
  const out = [];
  (runs || []).forEach((r) => {
    if (r.completedByUid !== uid || !r.completedAt) return;
    const end = ms(r.completedAt);
    if (end < lo || end - (r.totalSeconds || 0) * 1000 > hi) return;
    out.push({ s: end - (r.totalSeconds || 0) * 1000, e: end, run: r });
  });
  (live || []).forEach((a) => {
    if (a.uid !== uid || !a.lastActiveAt) return;
    const tracked = Object.values(a.stepTimes || {}).reduce((s, t) => s + (t || 0), 0);
    const last = ms(a.lastActiveAt);
    const end = a.paused ? last : now;
    const start = (a.paused ? last : last) - tracked * 1000;
    // Running: everything logged so far plus the stretch since the last save.
    out.push({ s: a.paused ? start : Math.min(start, last), e: end, live: a });
  });
  return out;
}

export function computeDay({ uid, rec, runs, live, now }) {
  const empty = {
    punched: false, done: false, onBreak: false, start: null, end: null,
    totals: { clock: 0, wf: 0, cs: 0, dl: 0, ex: 0, sg: 0, un: 0, br: 0 }, segments: [], gaps: [], openGap: 0,
    reasons: [], accountedPct: 100, finished: 0, openEntries: [], breakCount: 0,
  };
  if (!rec || !rec.punchIn) return empty;
  const t0 = ms(rec.punchIn);
  const t1 = rec.punchOut ? ms(rec.punchOut) : Math.max(now, t0);
  const breaks = tidy((rec.breaks || []).map((b) => [ms(b.start), b.end ? ms(b.end) : t1]), t0, t1);
  const clock = subtract([[t0, t1]], breaks);
  const log = Object.entries(rec.log || {}).map(([id, e]) => ({ id, ...e })).filter((e) => e && e.s);
  const endOf = (e) => {
    if (e.e) return ms(e.e);
    if (e.k === "dl") return Math.min(t1, ms(e.s) + DOWNLOAD_CAP_MIN * 60000);
    if (e.k === "cs") return ms(e.s); // a Clip Studio session only counts up to its last heartbeat
    return t1;
  };
  const wfList = workflowIntervals({ uid, runs, live, lo: t0, hi: t1, now });
  const raw = {
    wf: wfList.map((w) => [w.s, w.e]),
    cs: log.filter((e) => e.k === "cs").map((e) => [ms(e.s), endOf(e)]),
    dl: log.filter((e) => e.k === "dl").map((e) => [ms(e.s), endOf(e)]),
    ex: log.filter((e) => e.k === "ot" || e.k === "gap").map((e) => [ms(e.s), endOf(e)]),
  };
  // Hand out the clock, highest priority first.
  let left = clock;
  const got = {};
  PRIORITY.forEach((k) => {
    const mine = [];
    tidy(raw[k], t0, t1).forEach((iv) => { subtract([iv], subtract([iv], left)).forEach((x) => mine.push(x)); });
    got[k] = tidy(mine, t0, t1);
    left = subtract(left, got[k]);
  });
  const longMs = GAP_ASK_MIN * 60000;
  // Nothing but workflows was recorded before this went live, so time before
  // that moment is never called unexplained — it is left as an ordinary gap.
  const pre = [], post = [];
  left.forEach(([s, e]) => {
    if (e <= TRACKING_SINCE_MS) pre.push([s, e]);
    else if (s >= TRACKING_SINCE_MS) post.push([s, e]);
    else { pre.push([s, TRACKING_SINCE_MS]); post.push([TRACKING_SINCE_MS, e]); }
  });
  // A gap interrupted only by a break is still one gap for the purpose of the 20-minute rule? No — a break
  // is accounted time off the clock, so the stretches either side are judged separately.
  const un = post.filter(([s, e]) => e - s >= longMs);
  const sg = [...pre, ...post.filter(([s, e]) => e - s < longMs)].sort((a, b) => a[0] - b[0]);
  const segments = [
    ...got.wf.map(([s, e]) => ({ k: "wf", s, e })), ...got.cs.map(([s, e]) => ({ k: "cs", s, e })),
    ...got.dl.map(([s, e]) => ({ k: "dl", s, e })), ...got.ex.map(([s, e]) => ({ k: "ex", s, e })),
    ...sg.map(([s, e]) => ({ k: "sg", s, e })), ...un.map(([s, e]) => ({ k: "un", s, e })),
    ...breaks.map(([s, e]) => ({ k: "br", s, e })),
  ].sort((a, b) => a.s - b.s);
  const live1 = !rec.punchOut;
  const onBreak = !!(live1 && rec.onBreak);
  // "Open" = still going right now. A gap is only asked about once something has ended it.
  const gaps = un.map(([s, e]) => ({ s, e, open: live1 && !onBreak && e >= t1 - 1000, seconds: (e - s) / 1000 }));
  const lastLeft = post[post.length - 1];
  const openGap = live1 && !onBreak && lastLeft && lastLeft[1] >= t1 - 1000 ? (lastLeft[1] - lastLeft[0]) / 1000 : 0;
  // Which reasons the explained time is made of (only the part that actually counted as explained).
  const byReason = {};
  log.filter((e) => e.k === "ot" || e.k === "gap").forEach((e) => {
    const secs = total(subtract([[ms(e.s), endOf(e)]], subtract([[ms(e.s), endOf(e)]], got.ex)));
    if (secs <= 0) return;
    const label = reasonLabel(e);
    byReason[label] = (byReason[label] || 0) + secs;
  });
  const totals = { clock: total(clock), wf: total(got.wf), cs: total(got.cs), dl: total(got.dl), ex: total(got.ex), sg: total(sg), un: total(un), br: total(breaks) };
  const dk = dayKey(rec.punchIn);
  return {
    punched: true, done: !!rec.punchOut, onBreak, start: t0, end: t1, totals, segments, gaps, openGap,
    reasons: Object.entries(byReason).map(([label, seconds]) => ({ label, seconds })).sort((a, b) => b.seconds - a.seconds),
    accountedPct: totals.clock > 0 ? Math.round(((totals.clock - totals.un) / totals.clock) * 100) : 100,
    finished: (runs || []).filter((r) => r.completedByUid === uid && r.completedAt && dayKey(r.completedAt) === dk).length,
    openEntries: log.filter((e) => !e.e && (e.k === "dl" || e.k === "ot")),
    breakCount: (rec.breaks || []).length,
    running: wfList.some((w) => w.live && !w.live.paused),
  };
}

// Does a day meet what the admin expects? Only judged once there is at least an hour on the clock.
export function judgeDay(day, expect) {
  const ex = normalizeExpect(expect);
  if (!day.punched || day.totals.clock < 3600) return { ok: true, judged: false };
  const ok = day.accountedPct >= ex.accountedPct && day.totals.un <= ex.unexplainedMax * 60;
  return { ok, judged: true };
}

// Steps that ran slower or faster than this person's own usual, per video.
// "Usual" is their average for that step over the 30 days before the day in
// question; a step needs at least 3 earlier runs before it is compared.
export function stepsVsUsual({ uid, runs, dk, minSamples = 3 }) {
  const mine = (runs || []).filter((r) => r.completedByUid === uid && r.completedAt && r.stepTimes);
  const dayStart = new Date(dk + "T00:00:00").getTime();
  const today = mine.filter((r) => dayKey(r.completedAt) === dk);
  const before = mine.filter((r) => { const t = ms(r.completedAt); return t < dayStart && t >= dayStart - 30 * 86400000; });
  const collect = (list) => {
    const m = {};
    list.forEach((r) => Object.entries(r.stepTimes || {}).forEach(([stepId, secs]) => {
      if (!(secs > 0)) return;
      const key = `${r.workflowId}::${stepId}`;
      const x = m[key] || (m[key] = { sum: 0, n: 0, label: "", workflowTitle: r.workflowTitle || "", stepId, workflowId: r.workflowId });
      x.sum += secs; x.n += 1;
      if (r.stepLabels && r.stepLabels[stepId]) x.label = r.stepLabels[stepId];
      const idx = (r.stepOrder || []).indexOf(stepId);
      if (idx >= 0) x.index = idx + 1;
    }));
    return m;
  };
  const a = collect(today), b = collect(before);
  const rows = [];
  Object.keys(a).forEach((key) => {
    if (!b[key] || b[key].n < minSamples) return;
    const todayAvg = a[key].sum / a[key].n, usual = b[key].sum / b[key].n;
    const diff = todayAvg - usual;
    if (Math.abs(diff) < 120 || Math.abs(diff) / usual < 0.25) return;
    rows.push({ key, label: a[key].label || b[key].label || `Step ${a[key].index || ""}`.trim(), workflowTitle: a[key].workflowTitle, index: a[key].index || null, today: todayAvg, usual, diff, runs: a[key].n });
  });
  const slower = rows.filter((r) => r.diff > 0).sort((x, y) => y.diff - x.diff).slice(0, 3);
  const faster = rows.filter((r) => r.diff < 0).sort((x, y) => x.diff - y.diff).slice(0, 2);
  return [...slower, ...faster];
}

// "1h 12m", "12m", "0m" — whole minutes.
export function hm(sec) {
  const m = Math.floor(Math.max(0, sec || 0) / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : `${m}m`;
}

export const newLogId = () => `l${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

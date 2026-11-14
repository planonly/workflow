import React, { useState, useMemo, useEffect } from "react";
import { COLORS, displayNameFor } from "../lib/core";
import { HomeIcon } from "./Icon";
import {
  DEFAULT_TARGET_KEY, MEASURES, normalizeTarget, resolveTarget, hasAnyTarget,
  dayResult, history, streakOf, hitRate,
} from "../lib/targets";
import { useTodayKey, ProgressRows, HistoryStrip, StreakBadge } from "./TargetsWidget";

// Supervisor view of daily targets: how the team is doing today at a glance,
// each editor's progress and last two weeks, and the place to set the
// numbers. Editors never see this screen — they get the pill in the corner
// and their own card on the dashboard.

const label = { color: COLORS.textMuted };
const eyebrow = "font-mono text-[11px] tracking-[0.14em] uppercase";

// A punch-in time, whichever shape the record holds it in.
function clockOf(value) {
  if (!value) return "";
  const d = value && typeof value.toDate === "function" ? value.toDate() : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}

function longDate(dk) {
  const [y, m, d] = dk.split("-").map(Number);
  const dt = new Date(y, m - 1, d, 12);
  // Built by hand so it reads day-first, like dates everywhere else in the app.
  return `${dt.toLocaleDateString("en-US", { weekday: "long" })} ${d} ${dt.toLocaleDateString("en-US", { month: "long" })}`;
}

function goalSummary(t) {
  const n = normalizeTarget(t);
  const bits = MEASURES.filter((m) => n[m.key] > 0).map((m) => `${n[m.key]} ${m.key === "tasks" ? (n[m.key] === 1 ? "task" : "tasks") : m.short}`);
  return bits.length ? bits.join(" · ") : "No target";
}

// One number with − and + either side. Typing still works; anything that
// isn't a digit is dropped, and 0 means "not tracked".
function Stepper({ m, value, onChange }) {
  const n = Number(value) || 0;
  const btn = { backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, color: COLORS.textPrimary, width: 40, height: 44 };
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={`t-${m.key}`} style={label} className="text-xs font-semibold">{m.label} <span className="font-normal">per day</span></label>
      <div className="flex items-stretch">
        <button type="button" onClick={() => onChange(String(Math.max(0, n - 1)))} aria-label={`One fewer ${m.label}`} disabled={n <= 0}
          style={{ ...btn, opacity: n <= 0 ? 0.4 : 1 }} className="rounded-l-lg border text-lg font-bold">−</button>
        <input id={`t-${m.key}`} value={value} onChange={(e) => onChange(e.target.value)} inputMode="numeric" data-testid={`target-input-${m.key}`}
          style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, color: COLORS.textPrimary, height: 44, minWidth: 0 }}
          className="flex-1 w-full border-y px-2 text-center text-base font-mono font-semibold outline-none focus:ring-2" />
        <button type="button" onClick={() => onChange(String(Math.min(999, n + 1)))} aria-label={`One more ${m.label}`}
          style={btn} className="rounded-r-lg border text-lg font-bold">+</button>
      </div>
      <span style={label} className="text-[11px]">{n > 0 ? `Goal: ${n} a day` : "0 = not tracked"}</span>
    </div>
  );
}

function TargetEditor({ initial, canUseDefault, hasOwn, onSave, onUseDefault, onCancel }) {
  const start = normalizeTarget(initial);
  const [vals, setVals] = useState({ long: String(start.long), shorts: String(start.shorts), tasks: String(start.tasks) });
  const set = (k, v) => setVals((s) => ({ ...s, [k]: v.replace(/[^\d]/g, "").slice(0, 3) }));
  return (
    <div className="mt-4 pt-4" style={{ borderTop: `1px solid ${COLORS.border}` }}>
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
        {MEASURES.map((m) => <Stepper key={m.key} m={m} value={vals[m.key]} onChange={(v) => set(m.key, v)} />)}
      </div>
      <p style={label} className="text-xs leading-relaxed mt-3">
        Progress is counted automatically from finished videos and tasks marked done. Nobody enters it by hand.
      </p>
      <div className="flex items-center gap-2 mt-3 flex-wrap">
        <button onClick={() => onSave(normalizeTarget(vals))} data-testid="target-save"
          style={{ backgroundColor: COLORS.teal, color: "#04211D", minHeight: 40 }}
          className="rounded-lg px-5 text-sm font-bold hover:brightness-110 transition-all">Save</button>
        {canUseDefault && hasOwn && (
          <button onClick={onUseDefault} style={{ color: COLORS.textPrimary, borderColor: COLORS.border, minHeight: 40 }}
            className="rounded-lg border px-4 text-sm hover:opacity-80">Use team default</button>
        )}
        <button onClick={onCancel} style={{ color: COLORS.textMuted, minHeight: 40 }} className="px-3 text-sm hover:opacity-80">Cancel</button>
      </div>
    </div>
  );
}

// "Saved" for a moment after a change, so pressing Save visibly did something.
function useSavedFlash() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!on) return undefined;
    const id = setTimeout(() => setOn(false), 2500);
    return () => clearTimeout(id);
  }, [on]);
  return [on, () => setOn(true)];
}

const CHIP = {
  hit: { text: "On target", bg: COLORS.tealSoft, fg: COLORS.teal },
  in_progress: { text: "In progress", bg: COLORS.orangeSoft, fg: COLORS.orange },
  idle: { text: "Not started", bg: COLORS.bgElevated, fg: COLORS.textMuted },
  none: { text: "No target", bg: COLORS.bgElevated, fg: COLORS.textMuted },
};

function EditorRow({ e, todayDk, targets, hasDefault, attendance, onSave, onClear, onOpenDay }) {
  const [open, setOpen] = useState(false);
  const [saved, flashSaved] = useSavedFlash();
  const { target, source } = e;
  const hit = e.today.status === "hit";
  const rate = hitRate(e.hist);
  const rec = attendance && attendance[`${e.uid}_${todayDk}`];
  const inAt = rec && rec.punchIn ? clockOf(rec.punchIn) : "";
  const chip = e.today.status === "none" ? CHIP.none : hit ? CHIP.hit : e.done > 0 ? CHIP.in_progress : CHIP.idle;
  const left = e.goal - e.done;
  return (
    <div style={{ backgroundColor: COLORS.bgCard, borderColor: hit ? COLORS.teal : COLORS.border }}
      className="rounded-2xl border p-5" data-testid="editor-row" data-uid={e.uid}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-3 min-w-0">
          <span style={{ backgroundColor: COLORS.bgElevated, color: COLORS.teal }} aria-hidden="true"
            className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0">{(e.name || "?").slice(0, 1).toUpperCase()}</span>
          <div className="min-w-0">
            <p style={{ color: COLORS.textPrimary }} className="text-base font-semibold truncate">{e.name}</p>
            <p style={label} className="text-xs mt-0.5">
              {rec && rec.punchIn ? `Punched in${inAt ? ` ${inAt}` : ""}` : "Not punched in today"}
            </p>
            <p style={label} className="font-mono text-xs mt-1">
              {goalSummary(target)}
              {source === "default" && <span> · team default</span>}
              {source === "own" && hasDefault && <span> · own target</span>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          {saved && <span style={{ color: COLORS.teal }} className="text-xs font-semibold" data-testid="target-saved">Saved ✓</span>}
          <StreakBadge streak={e.streak} />
          <span style={{ backgroundColor: chip.bg, color: chip.fg }} className="text-xs font-semibold rounded-full px-2.5 py-1" data-testid="editor-status">
            {chip.text}{chip === CHIP.in_progress || chip === CHIP.idle ? ` · ${left} to go` : ""}
          </span>
          {!open && (
            <button onClick={() => setOpen(true)} data-testid="target-edit"
              style={{ color: COLORS.teal, borderColor: COLORS.border, minHeight: 36 }}
              className="rounded-lg border px-3 text-xs font-semibold hover:opacity-80">{source === "none" ? "Set" : "Edit"}<span className="sr-only"> target for {e.name}</span></button>
          )}
        </div>
      </div>

      {e.today.parts.length > 0 ? (
        <div className="mt-4"><ProgressRows parts={e.today.parts} /></div>
      ) : (
        <p style={label} className="text-sm mt-4">No target set{hasDefault ? "" : " — set one here, or add a team default above."}</p>
      )}

      {e.today.parts.length > 0 && (
        <div className="mt-5">
          <p style={label} className={`${eyebrow} mb-2`}>Last 14 days</p>
          <HistoryStrip hist={e.hist} detailed onPick={onOpenDay} />
          <p style={label} className="text-xs mt-2" data-testid="hit-rate">
            {rate.judged ? `${rate.hits} of ${rate.judged} working days hit (14d)` : "No judged days yet"}
          </p>
        </div>
      )}

      {open && (
        <TargetEditor
          initial={target} canUseDefault={hasDefault} hasOwn={source === "own"}
          onSave={(t) => { onSave(e.uid, t); setOpen(false); flashSaved(); }}
          onUseDefault={() => { onClear(e.uid); setOpen(false); flashSaved(); }}
          onCancel={() => setOpen(false)}
        />
      )}
    </div>
  );
}

function Tile({ name, value, sub, tone, testid, children }) {
  return (
    <div style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border }} className="rounded-2xl border px-4 py-4" data-testid={testid}>
      <p style={label} className={eyebrow}>{name}</p>
      <p style={{ color: tone || COLORS.textPrimary }} className="text-2xl font-bold font-mono mt-1.5">{value}</p>
      {children}
      {sub && <p style={label} className="text-xs mt-1.5">{sub}</p>}
    </div>
  );
}

const LEGEND = [
  ["✓", COLORS.teal, "#0A0B0E", "solid", "Hit"],
  ["–", COLORS.orange, "#0A0B0E", "solid", "Fell short"],
  ["✕", COLORS.danger, "#0A0B0E", "solid", "Missed"],
  ["•", COLORS.tealSoft, COLORS.teal, "solid", "Today"],
  ["", "transparent", COLORS.textMuted, "dashed", "Day off"],
];

export default function TargetsScreen({ profiles, targets, runs, tasks, attendance, onSave, onClear, saveError, onBack, onOpenDay }) {
  const todayDk = useTodayKey();
  const [editingDefault, setEditingDefault] = useState(false);
  const [defaultSaved, flashDefaultSaved] = useSavedFlash();

  const defaultTarget = targets && targets[DEFAULT_TARGET_KEY];
  const hasDefault = hasAnyTarget(defaultTarget);

  // Everything each row and the overview need, worked out once.
  const editors = useMemo(() => Object.keys(profiles || {})
    .filter((u) => profiles[u] && profiles[u].role === "editor")
    .map((u) => {
      const args = { uid: u, todayDk, targets, runs, tasks, attendance };
      const today = dayResult({ ...args, dk: todayDk });
      const hist = history({ ...args, days: 14 });
      const goal = today.parts.reduce((n, p) => n + p.goal, 0);
      const done = today.parts.reduce((n, p) => n + Math.min(p.done, p.goal), 0);
      return { uid: u, name: displayNameFor(u, profiles), today, hist, goal, done, streak: streakOf(hist), ...resolveTarget(targets, u) };
    })
    // Whoever is furthest behind comes first; people already on target next;
    // anyone with no target last. Names break ties so the order is stable.
    .sort((a, b) => {
      const rank = (x) => (x.today.status === "none" ? 2 : x.today.status === "hit" ? 1 : 0);
      if (rank(a) !== rank(b)) return rank(a) - rank(b);
      if (rank(a) === 0 && a.today.pct !== b.today.pct) return a.today.pct - b.today.pct;
      return a.name.localeCompare(b.name);
    }), [profiles, todayDk, targets, runs, tasks, attendance]);

  const withTarget = editors.filter((e) => e.today.status !== "none");
  const hitCount = withTarget.filter((e) => e.today.status === "hit").length;
  const teamGoal = withTarget.reduce((n, e) => n + e.goal, 0);
  const teamDone = withTarget.reduce((n, e) => n + e.done, 0);
  const workingToday = editors.filter((e) => { const r = attendance && attendance[`${e.uid}_${todayDk}`]; return r && r.punchIn; }).length;

  return (
    <div className="flex-1 flex flex-col max-w-4xl w-full mx-auto px-6 py-8 sm:py-10 overflow-y-auto fade-in">
      <div className="flex items-start justify-between gap-3 mb-1">
        <div>
          <h2 style={{ color: COLORS.textPrimary }} className="text-2xl sm:text-3xl font-bold">Targets</h2>
          <p style={label} className="text-sm mt-1" data-testid="targets-date">Today · {longDate(todayDk)}</p>
        </div>
        <button onClick={onBack} aria-label="Home" style={{ borderColor: COLORS.border, color: COLORS.textMuted }} className="rounded-full border p-2.5 hover:opacity-80 transition-opacity"><HomeIcon size={18} /></button>
      </div>
      <p style={label} className="text-sm mb-5" data-testid="targets-summary">
        {withTarget.length ? `${hitCount} of ${withTarget.length} editors have hit today's target` : "Daily goals for each editor, counted automatically"}
      </p>

      {saveError && (
        <div style={{ backgroundColor: COLORS.orangeSoft, borderColor: COLORS.danger }} className="rounded-xl border px-4 py-3 mb-4" data-testid="targets-error">
          <p style={{ color: COLORS.danger }} className="text-sm font-semibold">That change didn't save.</p>
          <p style={{ color: COLORS.textPrimary }} className="text-xs mt-1 leading-relaxed">
            The shared database refused the write. If this keeps happening, your Firestore rules may need to allow the <span className="font-mono">meta/targets</span> document.
          </p>
        </div>
      )}

      {withTarget.length > 0 && (
        <div className="grid gap-3 mb-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))" }} data-testid="targets-overview">
          <Tile name="On target" value={`${hitCount} / ${withTarget.length}`} tone={hitCount === withTarget.length ? COLORS.teal : COLORS.textPrimary}
            sub={hitCount === withTarget.length ? "Everyone has hit today's target" : `${withTarget.length - hitCount} still working toward it`} testid="tile-hit" />
          <Tile name="Done today" value={`${teamDone} / ${teamGoal}`} sub="Videos and tasks, across the team" testid="tile-done">
            <div style={{ backgroundColor: COLORS.bgElevated }} className="h-1.5 rounded-full overflow-hidden mt-2.5" aria-hidden="true">
              <div style={{ width: `${teamGoal ? Math.round((teamDone / teamGoal) * 100) : 0}%`, backgroundColor: teamDone >= teamGoal ? COLORS.teal : COLORS.orange }} className="h-full rounded-full" />
            </div>
          </Tile>
          <Tile name="Working today" value={`${workingToday} / ${editors.length}`} sub="Editors who have punched in" testid="tile-working" />
        </div>
      )}

      <div style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border }} className="rounded-2xl border p-5 mb-6" data-testid="default-card">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p style={label} className={eyebrow}>Team default</p>
            <p style={{ color: COLORS.textPrimary }} className="text-lg font-semibold mt-1">{goalSummary(defaultTarget)}</p>
            <p style={label} className="text-xs mt-1 leading-relaxed">Applies to any editor without their own target — including editors you add later.</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {defaultSaved && <span style={{ color: COLORS.teal }} className="text-xs font-semibold">Saved ✓</span>}
            {!editingDefault && (
              <button onClick={() => setEditingDefault(true)} data-testid="default-edit"
                style={{ color: COLORS.teal, borderColor: COLORS.border, minHeight: 36 }}
                className="rounded-lg border px-3 text-xs font-semibold hover:opacity-80">{hasDefault ? "Edit" : "Set"}<span className="sr-only"> the team default</span></button>
            )}
          </div>
        </div>
        {editingDefault && (
          <TargetEditor
            initial={defaultTarget} canUseDefault={false} hasOwn={false}
            onSave={(t) => { onSave(DEFAULT_TARGET_KEY, t); setEditingDefault(false); flashDefaultSaved(); }}
            onCancel={() => setEditingDefault(false)}
          />
        )}
      </div>

      <div className="flex items-end justify-between gap-3 flex-wrap mb-3">
        <p style={label} className={eyebrow}>Editors · furthest behind first</p>
        <div className="flex items-center gap-x-3 gap-y-1 flex-wrap" data-testid="targets-legend">
          {LEGEND.map(([mark, bg, fg, line, text]) => (
            <span key={text} className="flex items-center gap-1.5">
              <span aria-hidden="true" style={{ backgroundColor: bg, color: fg, borderColor: line === "dashed" ? COLORS.border : bg, borderStyle: line }}
                className="w-4 h-4 rounded border flex items-center justify-center text-[9px] font-bold">{mark}</span>
              <span style={label} className="text-xs">{text}</span>
            </span>
          ))}
        </div>
      </div>

      {editors.length === 0 ? (
        <p style={label} className="text-sm mt-2">No editors yet. Targets apply to accounts with the editor role.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {editors.map((e) => (
            <EditorRow key={e.uid} e={e} todayDk={todayDk} targets={targets} hasDefault={hasDefault} attendance={attendance}
              onSave={onSave} onClear={onClear} onOpenDay={onOpenDay} />
          ))}
        </div>
      )}

      <div style={{ borderColor: COLORS.border }} className="rounded-2xl border px-5 py-4 mt-6" data-testid="targets-rules">
        <p style={label} className={`${eyebrow} mb-2`}>How this is counted</p>
        <ul style={{ color: COLORS.textPrimary }} className="text-sm leading-relaxed list-disc pl-5 flex flex-col gap-1">
          <li>A day off is never a miss. If an editor didn't punch in and finished nothing, that day is left out.</li>
          <li>Past days are judged against the target as it is set now, not as it was then.</li>
          <li>Extra work on one measure doesn't make up for another: every measure with a goal has to be met.</li>
          <li>A task counts on the day it was marked done. Tasks finished before targets were added have no date and don't count.</li>
        </ul>
      </div>
    </div>
  );
}

// ---- An editor's own page -------------------------------------------------
// The same numbers the supervisor sees for this one person, and nothing about
// anyone else: today, the streak, the last 30 days, and a plain day-by-day
// list so "why did Tuesday count as short?" has an answer on the page.

const RESULT = {
  hit: { text: "Hit", fg: COLORS.teal },
  partial: { text: "Fell short", fg: COLORS.orange },
  missed: { text: "Missed", fg: COLORS.danger },
  off: { text: "Day off", fg: COLORS.textMuted },
  in_progress: { text: "Today", fg: COLORS.teal },
  none: { text: "No target", fg: COLORS.textMuted },
};

function shortDate(dk) {
  const [y, m, d] = dk.split("-").map(Number);
  const dt = new Date(y, m - 1, d, 12);
  return `${dt.toLocaleDateString("en-US", { weekday: "short" })} ${d} ${dt.toLocaleDateString("en-US", { month: "short" })}`;
}

export function MyTargetsScreen({ uid: uidVal, name, targets, runs, tasks, attendance, onBack, onOpenDay }) {
  const todayDk = useTodayKey();
  const args = { uid: uidVal, todayDk, targets, runs, tasks, attendance };
  const today = dayResult({ ...args, dk: todayDk });
  const hist = useMemo(() => history({ ...args, days: 30 }), [uidVal, todayDk, targets, runs, tasks, attendance]); // eslint-disable-line
  const { target, source } = resolveTarget(targets, uidVal);
  const streak = streakOf(hist);
  const rate = hitRate(hist);
  const week = hist.slice(0, 7);
  const weekRate = hitRate(week);
  const goal = today.parts.reduce((n, p) => n + p.goal, 0);
  const done = today.parts.reduce((n, p) => n + Math.min(p.done, p.goal), 0);
  const hit = today.status === "hit";
  const rec = attendance && attendance[`${uidVal}_${todayDk}`];
  const none = today.status === "none";

  return (
    <div className="flex-1 flex flex-col max-w-3xl w-full mx-auto px-6 py-8 sm:py-10 overflow-y-auto fade-in" data-testid="my-targets-screen">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <h2 style={{ color: COLORS.textPrimary }} className="text-2xl sm:text-3xl font-bold">My targets</h2>
          <p style={label} className="text-sm mt-1">Today · {longDate(todayDk)}{name ? ` · ${name}` : ""}</p>
        </div>
        <button onClick={onBack} aria-label="Home" style={{ borderColor: COLORS.border, color: COLORS.textMuted }} className="rounded-full border p-2.5 hover:opacity-80 transition-opacity"><HomeIcon size={18} /></button>
      </div>

      {none ? (
        <div style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border }} className="rounded-2xl border p-6" data-testid="my-none">
          <p style={{ color: COLORS.textPrimary }} className="text-lg font-semibold">No target has been set for you yet</p>
          <p style={label} className="text-sm leading-relaxed mt-2">When your supervisor sets one, today's progress and your history will show here, and a small counter will sit in the corner of every screen.</p>
        </div>
      ) : (
        <>
          <div style={{ backgroundColor: COLORS.bgCard, borderColor: hit ? COLORS.teal : COLORS.border }} className="rounded-2xl border p-5 mb-4" data-testid="my-today">
            <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
              <div>
                <p style={label} className={eyebrow}>Today</p>
                <p style={{ color: hit ? COLORS.teal : COLORS.textPrimary }} className="text-3xl font-bold font-mono mt-1" data-testid="my-count">{done} / {goal}</p>
                <p style={label} className="text-sm mt-1" data-testid="my-left">
                  {hit ? "Everything for today is done." : `${goal - done} to go today.`}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <StreakBadge streak={streak} />
                <span style={{ backgroundColor: hit ? COLORS.tealSoft : done > 0 ? COLORS.orangeSoft : COLORS.bgElevated, color: hit ? COLORS.teal : done > 0 ? COLORS.orange : COLORS.textMuted }}
                  className="text-xs font-semibold rounded-full px-2.5 py-1">{hit ? "On target" : done > 0 ? "In progress" : "Not started"}</span>
              </div>
            </div>
            <ProgressRows parts={today.parts} />
            <p style={label} className="text-xs mt-4">
              Your target: <span style={{ color: COLORS.textPrimary }} className="font-mono">{goalSummary(target)}</span> a day{source === "default" ? " (the team default)" : ""}.
              {" "}{rec && rec.punchIn ? `You punched in${clockOf(rec.punchIn) ? ` at ${clockOf(rec.punchIn)}` : ""}.` : "You haven't punched in today."}
            </p>
          </div>

          <div className="grid gap-3 mb-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}>
            <Tile name="Streak" value={streak ? `${streak} day${streak === 1 ? "" : "s"}` : "—"} tone={streak ? COLORS.orange : COLORS.textPrimary}
              sub={streak ? "Working days hit in a row" : "Hit today's target to start one"} testid="my-streak" />
            <Tile name="Last 7 days" value={weekRate.judged ? `${weekRate.hits} / ${weekRate.judged}` : "—"} sub="Working days hit" testid="my-week" />
            <Tile name="Last 30 days" value={rate.judged ? `${rate.hits} / ${rate.judged}` : "—"}
              sub={rate.judged ? `${Math.round(rate.rate * 100)}% of working days hit` : "No judged days yet"} testid="my-month" />
          </div>

          <div style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border }} className="rounded-2xl border p-5 mb-4">
            <div className="flex items-end justify-between gap-3 flex-wrap mb-3">
              <p style={label} className={eyebrow}>Last 30 days</p>
              <div className="flex items-center gap-x-3 gap-y-1 flex-wrap">
                {LEGEND.map(([mark, bg, fg, line, text]) => (
                  <span key={text} className="flex items-center gap-1.5">
                    <span aria-hidden="true" style={{ backgroundColor: bg, color: fg, borderColor: line === "dashed" ? COLORS.border : bg, borderStyle: line }}
                      className="w-4 h-4 rounded border flex items-center justify-center text-[9px] font-bold">{mark}</span>
                    <span style={label} className="text-xs">{text}</span>
                  </span>
                ))}
              </div>
            </div>
            <HistoryStrip hist={hist} detailed onPick={onOpenDay} />
          </div>

          <div style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border }} className="rounded-2xl border p-5 mb-4" data-testid="my-days">
            <p style={label} className={`${eyebrow} mb-2`}>Day by day · last 7</p>
            {week.map((d, i) => (
              <div key={d.dk} className="flex items-center justify-between gap-3 py-2.5" style={i ? { borderTop: `1px solid ${COLORS.border}` } : undefined} data-testid="my-day">
                <span style={{ color: COLORS.textPrimary, width: 104 }} className="text-sm shrink-0">{shortDate(d.dk)}</span>
                <span style={label} className="text-sm font-mono flex-1 min-w-0">
                  {d.status === "off" ? "—" : d.parts.map((p) => `${p.label} ${p.done}/${p.goal}`).join(" · ")}
                </span>
                <span style={{ color: RESULT[d.status].fg }} className="text-sm font-semibold shrink-0">{RESULT[d.status].text}</span>
              </div>
            ))}
          </div>
        </>
      )}

      <div style={{ borderColor: COLORS.border }} className="rounded-2xl border px-5 py-4 mt-2">
        <p style={label} className={`${eyebrow} mb-2`}>How this is counted</p>
        <ul style={{ color: COLORS.textPrimary }} className="text-sm leading-relaxed list-disc pl-5 flex flex-col gap-1">
          <li>Nothing is entered by hand. A video counts when you finish its workflow, and a task counts when it is marked done.</li>
          <li>Every measure with a goal has to be met. Extra shorts don't make up for missing long-form videos.</li>
          <li>A day off is never a miss. If you didn't punch in and finished nothing, that day is left out and your streak carries on.</li>
          <li>Past days are judged against your target as it is set now.</li>
        </ul>
      </div>
    </div>
  );
}

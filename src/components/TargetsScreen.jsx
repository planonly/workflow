import React, { useState, useMemo } from "react";
import { COLORS, displayNameFor } from "../lib/core";
import { HomeIcon } from "./Icon";
import {
  DEFAULT_TARGET_KEY, MEASURES, normalizeTarget, resolveTarget, hasAnyTarget,
  dayResult, history, streakOf, hitRate,
} from "../lib/targets";
import { useTodayKey, ProgressRows, HistoryStrip, StreakBadge } from "./TargetsWidget";

// Supervisor view of daily targets: set each editor's numbers, see how
// everyone is doing today, and look back over the last two weeks. Editors
// never see this screen — they get their own card on the dashboard.

function TargetEditor({ initial, canUseDefault, hasOwn, onSave, onUseDefault, onCancel }) {
  const start = normalizeTarget(initial);
  const [vals, setVals] = useState({ long: String(start.long), shorts: String(start.shorts), tasks: String(start.tasks) });
  const set = (k, v) => setVals((s) => ({ ...s, [k]: v.replace(/[^\d]/g, "").slice(0, 3) }));
  return (
    <div className="mt-3 pt-3" style={{ borderTop: `1px solid ${COLORS.border}` }}>
      <div className="grid grid-cols-3 gap-2">
        {MEASURES.map((m) => (
          <label key={m.key} className="flex flex-col gap-1">
            <span style={{ color: COLORS.textFaint }} className="font-mono text-[10px] tracking-[0.15em] uppercase">{m.label}</span>
            <input value={vals[m.key]} onChange={(e) => set(m.key, e.target.value)} inputMode="numeric" aria-label={`${m.label} per day`}
              data-testid={`target-input-${m.key}`}
              style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, color: COLORS.textPrimary }}
              className="rounded-lg border px-3 py-2 text-sm font-mono outline-none focus:ring-2 w-full" />
          </label>
        ))}
      </div>
      <p style={{ color: COLORS.textFaint }} className="text-[10px] leading-relaxed mt-2">
        Per day. Leave a measure at 0 to not track it. Progress is counted automatically from finished runs and tasks marked done.
      </p>
      <div className="flex items-center gap-2 mt-3 flex-wrap">
        <button onClick={() => onSave(normalizeTarget(vals))} data-testid="target-save"
          style={{ backgroundColor: COLORS.tealSoft, color: COLORS.teal }}
          className="rounded-lg px-4 py-2 text-xs font-semibold hover:brightness-110 transition-all">Save</button>
        {canUseDefault && hasOwn && (
          <button onClick={onUseDefault} style={{ color: COLORS.textMuted, borderColor: COLORS.border }}
            className="rounded-lg border px-3 py-2 text-xs hover:opacity-80">Use team default</button>
        )}
        <button onClick={onCancel} style={{ color: COLORS.textFaint }} className="px-2 py-2 text-xs hover:opacity-80">Cancel</button>
      </div>
    </div>
  );
}

function goalSummary(t) {
  const n = normalizeTarget(t);
  const bits = MEASURES.filter((m) => n[m.key] > 0).map((m) => `${n[m.key]} ${m.key === "tasks" ? (n[m.key] === 1 ? "task" : "tasks") : m.short}`);
  return bits.length ? bits.join(" · ") : "No target";
}

function EditorRow({ uidVal, name, todayDk, ctx, targets, hasDefault, onSave, onClear }) {
  const [open, setOpen] = useState(false);
  const { target, source } = resolveTarget(targets, uidVal);
  const args = { uid: uidVal, todayDk, ...ctx, targets };
  const today = dayResult({ ...args, dk: todayDk });
  const hist = useMemo(() => history({ ...args, days: 14 }), [uidVal, todayDk, ctx.runs, ctx.tasks, ctx.attendance, targets]); // eslint-disable-line
  const streak = streakOf(hist);
  const rate = hitRate(hist);
  const hit = today.status === "hit";
  return (
    <div style={{ backgroundColor: COLORS.bgCard, borderColor: hit ? COLORS.teal : COLORS.border }}
      className="rounded-2xl border p-4" data-testid="editor-row" data-uid={uidVal}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p style={{ color: COLORS.textPrimary }} className="text-sm font-semibold truncate">{name}</p>
          <p style={{ color: COLORS.textFaint }} className="font-mono text-[11px] mt-0.5">
            {goalSummary(target)}
            {source === "default" && <span style={{ color: COLORS.textFaint }}> · team default</span>}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <StreakBadge streak={streak} />
          {hit && <span style={{ backgroundColor: COLORS.tealSoft, color: COLORS.teal }} className="font-mono text-[10px] rounded-full px-2 py-0.5">Hit today</span>}
          {!open && (
            <button onClick={() => setOpen(true)} data-testid="target-edit" style={{ color: COLORS.teal }}
              className="font-mono text-[11px] font-semibold hover:opacity-80">{source === "none" ? "Set" : "Edit"}</button>
          )}
        </div>
      </div>

      {today.parts.length > 0 ? (
        <div className="mt-3"><ProgressRows parts={today.parts} /></div>
      ) : (
        <p style={{ color: COLORS.textFaint }} className="text-xs mt-3">No target set{hasDefault ? "" : " — set one, or add a team default above."}</p>
      )}

      {today.parts.length > 0 && (
        <div className="mt-4 flex items-end justify-between gap-3 flex-wrap">
          <HistoryStrip hist={hist} />
          <p style={{ color: COLORS.textFaint }} className="font-mono text-[10px]" data-testid="hit-rate">
            {rate.judged ? `${rate.hits} of ${rate.judged} working days hit (14d)` : "No judged days yet"}
          </p>
        </div>
      )}

      {open && (
        <TargetEditor
          initial={target} canUseDefault={hasDefault} hasOwn={source === "own"}
          onSave={(t) => { onSave(uidVal, t); setOpen(false); }}
          onUseDefault={() => { onClear(uidVal); setOpen(false); }}
          onCancel={() => setOpen(false)}
        />
      )}
    </div>
  );
}

export default function TargetsScreen({ profiles, targets, runs, tasks, attendance, onSave, onClear, saveError, onBack }) {
  const todayDk = useTodayKey();
  const [editingDefault, setEditingDefault] = useState(false);
  const ctx = { runs, tasks, attendance };

  const editors = useMemo(() => Object.keys(profiles || {})
    .filter((u) => profiles[u] && profiles[u].role === "editor")
    .map((u) => ({ uid: u, name: displayNameFor(u, profiles) }))
    .sort((a, b) => a.name.localeCompare(b.name)), [profiles]);

  const defaultTarget = targets && targets[DEFAULT_TARGET_KEY];
  const hasDefault = hasAnyTarget(defaultTarget);

  const summary = useMemo(() => {
    let withTarget = 0, hit = 0;
    editors.forEach((e) => {
      const r = dayResult({ uid: e.uid, dk: todayDk, todayDk, targets, ...ctx });
      if (r.status === "none") return;
      withTarget += 1;
      if (r.status === "hit") hit += 1;
    });
    return { withTarget, hit };
  }, [editors, todayDk, targets, runs, tasks, attendance]); // eslint-disable-line

  return (
    <div className="flex-1 flex flex-col max-w-3xl w-full mx-auto px-6 py-8 sm:py-10 overflow-y-auto fade-in">
      <div className="flex items-center justify-between mb-2">
        <h2 style={{ color: COLORS.textPrimary }} className="text-2xl sm:text-3xl font-bold">Targets</h2>
        <button onClick={onBack} aria-label="Home" style={{ borderColor: COLORS.border, color: COLORS.textMuted }} className="rounded-full border p-2 hover:opacity-80 transition-opacity"><HomeIcon size={18} /></button>
      </div>
      <p style={{ color: COLORS.textFaint }} className="font-mono text-xs mb-5" data-testid="targets-summary">
        {summary.withTarget ? `${summary.hit} of ${summary.withTarget} editors have hit today's target` : "Daily goals for each editor, counted automatically"}
      </p>

      {saveError && (
        <div style={{ backgroundColor: COLORS.orangeSoft, borderColor: COLORS.danger }} className="rounded-xl border px-4 py-3 mb-4" data-testid="targets-error">
          <p style={{ color: COLORS.danger }} className="text-xs font-semibold">That change didn't save.</p>
          <p style={{ color: COLORS.textMuted }} className="text-[11px] mt-0.5 leading-relaxed">
            The shared database refused the write. If this keeps happening, your Firestore rules may need to allow the <span className="font-mono">meta/targets</span> document.
          </p>
        </div>
      )}

      <div style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border }} className="rounded-2xl border p-4 mb-4" data-testid="default-card">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p style={{ color: COLORS.textFaint }} className="font-mono text-[10px] tracking-[0.15em] uppercase">Team default</p>
            <p style={{ color: COLORS.textPrimary }} className="text-sm mt-1">{goalSummary(defaultTarget)}</p>
            <p style={{ color: COLORS.textFaint }} className="text-[10px] mt-1 leading-relaxed">Applies to any editor without their own target — including editors you add later.</p>
          </div>
          {!editingDefault && (
            <button onClick={() => setEditingDefault(true)} data-testid="default-edit" style={{ color: COLORS.teal }}
              className="font-mono text-[11px] font-semibold hover:opacity-80 shrink-0">{hasDefault ? "Edit" : "Set"}</button>
          )}
        </div>
        {editingDefault && (
          <TargetEditor
            initial={defaultTarget} canUseDefault={false} hasOwn={false}
            onSave={(t) => { onSave(DEFAULT_TARGET_KEY, t); setEditingDefault(false); }}
            onCancel={() => setEditingDefault(false)}
          />
        )}
      </div>

      {editors.length === 0 ? (
        <p style={{ color: COLORS.textFaint }} className="text-sm mt-4">No editors yet. Targets apply to accounts with the editor role.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {editors.map((e) => (
            <EditorRow key={e.uid} uidVal={e.uid} name={e.name} todayDk={todayDk} ctx={ctx}
              targets={targets} hasDefault={hasDefault} onSave={onSave} onClear={onClear} />
          ))}
        </div>
      )}

      <p style={{ color: COLORS.textFaint }} className="text-[10px] leading-relaxed mt-6">
        Days an editor didn't punch in and finished nothing count as days off, not misses. Past days are judged against the current target. Tasks only count once they've been marked done from now on.
      </p>
    </div>
  );
}

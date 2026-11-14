import React, { useState, useEffect, useMemo } from "react";
import { COLORS, dayKey, displayNameFor, formatClock, formatDateShort } from "../lib/core";
import { computeDay, judgeDay, stepsVsUsual, hm, REASONS, BREAK_REASON, GAP_ASK_MIN, NUDGE_MIN, normalizeExpect } from "../lib/dayLog";
import { resolveTarget, countsForDay, evaluate, history, streakOf, shiftDay } from "../lib/targets";
import { activeQueueFor } from "../lib/taskOrder";
import { dueInfo } from "../lib/taskInfo";

// One colour per place the time can go. Used by every bar, strip and legend.
export const KIND = {
  wf: { color: "#2DD4C4", text: "#2DD4C4", label: "In workflows" },
  dl: { color: "#A78BFA", text: "#C9B8FB", label: "Downloading" },
  cs: { color: "#60A5FA", text: "#93C5FD", label: "Clip Studio" },
  ex: { color: "#5B6474", text: "#C9CED8", label: "Explained" },
  sg: { color: "#2F3541", text: "#9BA2B0", label: "Short gaps" },
  un: { color: "#F2784B", text: "#F7A27F", label: "Unexplained" },
};
const BAR_ORDER = ["wf", "dl", "cs", "ex", "sg", "un"];
const clockRange = (s, e) => `${formatClock(new Date(s).toISOString())} to ${formatClock(new Date(e).toISOString())}`;

export function TimeLegend({ withBreaks, className = "" }) {
  return (
    <div className={`flex flex-wrap gap-x-3.5 gap-y-1.5 text-xs ${className}`} style={{ color: COLORS.textMuted }}>
      {BAR_ORDER.map((k) => (
        <span key={k} className="inline-flex items-center gap-1.5"><span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: KIND[k].color }} />{KIND[k].label}</span>
      ))}
      {withBreaks && <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: "#14171D", border: "1px solid #3A4250" }} />Breaks</span>}
    </div>
  );
}

// The whole bar is time on the clock; the parts say where it went.
export function DayBar({ day, height = 10, testid }) {
  const t = day.totals;
  const label = `Of ${hm(t.clock)} on the clock: ` + BAR_ORDER.filter((k) => t[k] >= 60).map((k) => `${hm(t[k])} ${KIND[k].label.toLowerCase()}`).join(", ");
  return (
    <div role="img" aria-label={label} data-testid={testid} style={{ height, backgroundColor: COLORS.border }} className="flex gap-[2px] rounded-full overflow-hidden">
      {BAR_ORDER.filter((k) => t[k] > 0).map((k) => <span key={k} data-kind={k} style={{ flex: `${t[k]} 1 0`, backgroundColor: KIND[k].color }} />)}
    </div>
  );
}

// The day left to right, breaks included.
function DayStrip({ day }) {
  const span = Math.max(1, day.end - day.start);
  const mid = day.start + span / 2;
  return (
    <div className="flex flex-col gap-1.5">
      <div role="img" aria-label="Timeline of the day" style={{ height: 26 }} className="flex gap-[2px] rounded-lg overflow-hidden" data-testid="day-strip">
        {day.segments.map((sg, i) => (
          <span key={i} title={`${sg.k === "br" ? "Break" : KIND[sg.k].label} · ${clockRange(sg.s, sg.e)}`}
            style={{ flex: `${sg.e - sg.s} 1 0`, backgroundColor: sg.k === "br" ? "#14171D" : KIND[sg.k].color, border: sg.k === "br" ? "1px solid #3A4250" : "none" }} />
        ))}
      </div>
      <div className="flex justify-between text-[11px]" style={{ color: COLORS.textMuted }}>
        <span>{formatClock(new Date(day.start).toISOString())}</span><span>{formatClock(new Date(mid).toISOString())}</span><span>{formatClock(new Date(day.end).toISOString())}</span>
      </div>
    </div>
  );
}

// One-tap answers to "what were you doing?". Used by the question itself, the nudge and the punch-out summary.
export function ReasonPicker({ onPick, picked, allowBreak, compact }) {
  const [other, setOther] = useState("");
  const btn = (key, label) => (
    <button key={key} type="button" onClick={() => onPick(key, "")} aria-pressed={picked === key} data-testid={`reason-${key}`}
      style={{ backgroundColor: picked === key ? COLORS.tealSoft : COLORS.bgCard, color: picked === key ? COLORS.teal : COLORS.textPrimary, borderColor: picked === key ? COLORS.teal : "#3A4250" }}
      className={`${compact ? "min-h-[44px] px-3.5 text-[13px]" : "min-h-[48px] px-3.5 text-sm"} rounded-xl border font-semibold text-left hover:brightness-125 transition-all`}>{label}</button>
  );
  return (
    <div className="flex flex-col gap-2.5">
      <div className={compact ? "flex flex-wrap gap-2" : "grid gap-2"} style={compact ? undefined : { gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))" }}>
        {REASONS.map(([key, label]) => btn(key, label))}
        {allowBreak && btn(BREAK_REASON, "I was on a break")}
      </div>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (other.trim()) { onPick("other", other.trim()); setOther(""); } }}>
        <input value={other} onChange={(e) => setOther(e.target.value)} placeholder="Something else — say what it was" aria-label="Something else" data-testid="reason-other"
          style={{ backgroundColor: COLORS.bg, borderColor: COLORS.border, color: COLORS.textPrimary }} className="flex-1 min-w-0 min-h-[44px] rounded-xl border px-3.5 text-sm outline-none focus:ring-2" />
        <button type="submit" disabled={!other.trim()} style={{ borderColor: COLORS.border, color: COLORS.textPrimary, opacity: other.trim() ? 1 : 0.4 }} className="min-h-[44px] px-4 rounded-xl border text-[13px] font-semibold">Save</button>
      </form>
    </div>
  );
}

function Modal({ label, onClose, children, wide, testid }) {
  useEffect(() => {
    if (!onClose) return;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto" style={{ backgroundColor: "rgba(0,0,0,0.72)" }} data-testid={testid}>
      <div className="min-h-full flex items-start justify-center p-3 sm:p-6">
        <div role="dialog" aria-label={label} style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, maxWidth: wide ? 720 : 560 }} className="w-full rounded-[20px] border flex flex-col my-auto">
          {children}
        </div>
      </div>
    </div>
  );
}

// Asked once a gap of GAP_ASK_MIN minutes or more has ended.
export function GapPrompt({ gap, onAnswer, onLater }) {
  return (
    <Modal label="What were you doing" testid="gap-prompt">
      <div className="p-5 sm:p-6 flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <span style={{ color: COLORS.orange }} className="text-xs font-semibold">Nothing was timed for {hm(gap.seconds)}</span>
          <h2 style={{ color: COLORS.textPrimary }} className="text-xl sm:text-[22px] font-bold leading-snug">What were you doing from {clockRange(gap.s, gap.e)}?</h2>
        </div>
        <ReasonPicker onPick={onAnswer} allowBreak />
        <div className="flex items-center gap-2.5 pt-1">
          <span style={{ color: COLORS.textMuted }} className="flex-1 text-xs leading-relaxed">One tap answers it. "Answer later" brings it back when you punch out; left blank, it is saved as unexplained.</span>
          <button type="button" onClick={onLater} data-testid="gap-later" style={{ borderColor: COLORS.border, color: COLORS.textMuted }} className="min-h-[44px] px-3.5 rounded-xl border text-[13px] font-semibold shrink-0">Answer later</button>
        </div>
      </div>
    </Modal>
  );
}

// Sits just above the targets pill. Speaks up when someone is on the clock
// and nothing has been timed for NUDGE_MIN minutes; shows a running "other
// work" or download timer when there is one.
export function IdleNudge({ day, raised, onStartOther, onEndEntry, onTakeBreak, onGoHome }) {
  const [picking, setPicking] = useState(false);
  const [hiddenUntil, setHiddenUntil] = useState(0);
  const [, tick] = useState(0);
  useEffect(() => { const id = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(id); }, []);
  const open = day.openEntries || [];
  const timer = (iso) => { const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
  const idle = day.punched && !day.done && !day.onBreak && !day.running && open.length === 0 && day.openGap >= NUDGE_MIN * 60;
  const showNudge = idle && Date.now() > hiddenUntil;
  if (!showNudge && open.length === 0) return null;
  // Bottom-left, so it never sits on top of the targets pill in the bottom-right; on a phone it stacks above it.
  return (
    <div className={`idle-nudge-pos flex flex-col gap-2${raised ? " raised" : ""}`} data-testid="idle-nudge-wrap">
      <style>{`.idle-nudge-pos{position:fixed;z-index:39;left:16px;bottom:calc(16px + env(safe-area-inset-bottom,0px));width:min(320px,calc(100vw - 32px))}
        .idle-nudge-pos.raised{bottom:calc(88px + env(safe-area-inset-bottom,0px))}
        @media (max-width:760px){.idle-nudge-pos,.idle-nudge-pos.raised{bottom:calc(200px + env(safe-area-inset-bottom,0px))}}`}</style>
      {open.map((e) => (
        <div key={e.id} style={{ backgroundColor: COLORS.bgCard, borderColor: e.k === "dl" ? KIND.dl.color : KIND.ex.color, boxShadow: "0 14px 34px rgba(0,0,0,0.5)" }}
          className="rounded-2xl border px-4 py-3 flex items-center gap-2.5" data-testid={`running-${e.k}`}>
          <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 9999, backgroundColor: e.k === "dl" ? KIND.dl.color : COLORS.textMuted }} />
          <span style={{ color: COLORS.textPrimary }} className="flex-1 min-w-0 text-sm font-semibold truncate">{e.k === "dl" ? `Downloading${e.label ? " · " + e.label : ""}` : (REASONS.find((r) => r[0] === e.reason) || [0, e.note || "Other work"])[1]}</span>
          <span style={{ color: COLORS.textPrimary, fontVariantNumeric: "tabular-nums" }} className="text-sm font-bold">{timer(e.s)}</span>
          <button type="button" onClick={() => onEndEntry(e.id)} style={{ borderColor: "#3A4250", color: COLORS.textPrimary }} className="min-h-[40px] px-3 rounded-lg border text-[13px] font-semibold">{e.k === "dl" ? "Finished" : "Done"}</button>
        </div>
      ))}
      {showNudge && (
        <div style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.orange, boxShadow: "0 18px 40px rgba(0,0,0,0.5)" }} className="rounded-2xl border p-4 flex flex-col gap-3" data-testid="idle-nudge">
          <div className="flex items-center gap-2.5">
            <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 9999, backgroundColor: COLORS.orange }} />
            <span style={{ color: COLORS.textPrimary }} className="flex-1 text-sm font-bold">Nothing is being timed</span>
            <span style={{ color: COLORS.orange, fontVariantNumeric: "tabular-nums" }} className="text-sm font-bold">{hm(day.openGap)}</span>
          </div>
          {picking ? (
            <ReasonPicker compact onPick={(reason, note) => { onStartOther(reason, note); setPicking(false); }} />
          ) : (
            <React.Fragment>
              <span style={{ color: "#C9CED8" }} className="text-[13px] leading-relaxed">You are on the clock. Pick one so this time is accounted for.</span>
              <button type="button" onClick={onGoHome} style={{ backgroundColor: COLORS.teal, color: "#04211D" }} className="min-h-[46px] rounded-xl text-sm font-bold">Start a workflow</button>
              <button type="button" onClick={() => setPicking(true)} data-testid="nudge-other" style={{ borderColor: "#3A4250", color: COLORS.textPrimary }} className="min-h-[46px] rounded-xl border text-sm font-semibold">I'm doing something else…</button>
              <button type="button" onClick={onTakeBreak} style={{ backgroundColor: COLORS.orangeSoft, color: COLORS.orange }} className="min-h-[46px] rounded-xl text-sm font-bold">Take a break</button>
            </React.Fragment>
          )}
          <button type="button" onClick={() => { setPicking(false); setHiddenUntil(Date.now() + 10 * 60000); }} style={{ color: COLORS.textMuted }} className="text-xs font-semibold self-end">{picking ? "Back" : "Hide for 10 minutes"}</button>
        </div>
      )}
    </div>
  );
}

// The five figures under a bar.
export function DayFigures({ day, big }) {
  const t = day.totals;
  const item = (k, value, label) => (
    <div key={k} className="flex flex-col gap-0.5" data-testid={`fig-${k}`}>
      <span style={{ color: KIND[k].text, fontVariantNumeric: "tabular-nums" }} className={`${big ? "text-2xl" : "text-[22px]"} font-bold leading-tight`}>{value}</span>
      <span style={{ color: COLORS.textMuted }} className="text-xs">{label}</span>
    </div>
  );
  return (
    <div className="grid gap-x-3 gap-y-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))" }}>
      {item("wf", hm(t.wf), `in workflows${day.finished ? ` · ${day.finished} finished` : ""}`)}
      {item("dl", hm(t.dl), "downloading")}
      {item("cs", hm(t.cs), "in Clip Studio")}
      {item("ex", hm(t.ex + t.sg), `explained${t.sg >= 60 ? ` (${hm(t.sg)} short gaps)` : ""}`)}
      {item("un", hm(t.un), "unexplained")}
    </div>
  );
}

// "Your day": shown before punch-out is confirmed, and openable any time (and
// by an admin for any editor's day).
export function DaySummary({ uid, name, rec, dk, runs, tasks, targets, attendance, live, isSelf, mode, viewerIsAdmin, adminName, snoozed,
  onAnswerGap, onClose, onPunchOut }) {
  const [note, setNote] = useState((rec && rec.dayNote) || "");
  const [, tick] = useState(0);
  useEffect(() => { if (rec && rec.punchOut) return undefined; const id = setInterval(() => tick((n) => n + 1), 30000); return () => clearInterval(id); }, [rec && rec.punchOut]);
  const now = Date.now();
  const day = computeDay({ uid, rec, runs, live, now });
  const t = day.totals;
  const todayRuns = (runs || []).filter((r) => r.completedByUid === uid && r.completedAt && dayKey(r.completedAt) === dk).sort((a, b) => new Date(a.completedAt) - new Date(b.completedAt));
  const longest = todayRuns.reduce((a, b) => (!a || (b.totalSeconds || 0) > (a.totalSeconds || 0) ? b : a), null);
  const target = evaluate(resolveTarget(targets || {}, uid).target, countsForDay({ uid, dk, runs, tasks }));
  const streak = useMemo(() => streakOf(history({ uid, days: 30, todayDk: dk, targets, runs, tasks, attendance })), [uid, dk, targets, runs, tasks, attendance]);
  const steps = useMemo(() => stepsVsUsual({ uid, runs, dk }), [uid, runs, dk]);
  const paused = (live || []).filter((a) => a.uid === uid);
  const queue = activeQueueFor(tasks || [], uid);
  const overdue = queue.filter((x) => { const d = dueInfo(x, shiftDay(dk, 1)); return d && d.overdue; }).length;
  const gaps = day.gaps.filter((g) => !g.open || mode === "punchout");
  const punching = mode === "punchout";
  const box = { backgroundColor: COLORS.bgCard, borderColor: COLORS.border };
  const H = ({ children, color }) => <h3 style={{ color: color || COLORS.textMuted }} className="font-mono text-[11px] tracking-[0.14em] uppercase">{children}</h3>;
  const tile = (k, value, label, warn) => (
    <div key={label} style={warn ? { backgroundColor: "rgba(242,120,75,0.10)", borderColor: "#7A3A22" } : box} className="rounded-xl border p-3.5 flex flex-col gap-1" data-testid={`sum-${k}`}>
      <span style={{ color: k === "clock" ? COLORS.textPrimary : KIND[k].text, fontVariantNumeric: "tabular-nums" }} className="text-2xl font-bold leading-tight">{value}</span>
      <span style={{ color: COLORS.textMuted }} className="text-xs">{label}</span>
    </div>
  );
  const headline = !day.punched ? "No punch record for this day."
    : target.parts.length === 0 ? `${todayRuns.length} video${todayRuns.length === 1 ? "" : "s"} finished.`
    : `${target.parts.map((p) => `${p.done} of ${p.goal} ${p.label.toLowerCase()}`).join(", ")}. ${target.hit ? `Target hit${streak > 1 ? `, and that makes ${streak} days in a row` : ""}.` : "Target not reached."}`;
  const dateText = (() => { try { return new Date(dk + "T12:00:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }); } catch (e) { return dk; } })();

  return (
    <Modal label="Day summary" onClose={onClose} wide testid="day-summary">
      <div style={{ borderColor: COLORS.border }} className="px-5 sm:px-6 pt-5 sm:pt-6 pb-5 border-b flex flex-col gap-1.5">
        <span style={{ color: COLORS.textMuted }} className="text-xs">{dateText}{day.punched ? ` · ${formatClock(rec.punchIn)} to ${rec.punchOut ? formatClock(rec.punchOut) : "now"}` : ""}</span>
        <h2 style={{ color: COLORS.textPrimary }} className="text-2xl font-bold">{isSelf ? `Your day, ${name}` : `${name}'s day`}</h2>
        <p style={{ color: "#C9CED8" }} className="text-[15px] leading-relaxed" data-testid="sum-headline">{headline}</p>
      </div>

      {day.punched && (
        <div className="px-5 sm:px-6 py-5 flex flex-col gap-6">
          <section className="flex flex-col gap-3">
            <H>Where the time went</H>
            <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))" }}>
              {tile("clock", hm(t.clock), "on the clock")}
              {tile("wf", hm(t.wf), "in workflows")}
              {tile("dl", hm(t.dl), "downloading")}
              {tile("cs", hm(t.cs), "in Clip Studio")}
              {tile("ex", hm(t.ex + t.sg), `explained${t.sg >= 60 ? ` (${hm(t.sg)} short gaps)` : ""}`)}
              {tile("un", hm(t.un), "unexplained", t.un >= 60)}
            </div>
            <DayStrip day={day} />
            <TimeLegend withBreaks />
            <span style={{ color: COLORS.textMuted }} className="text-xs leading-relaxed">
              {day.breakCount} break{day.breakCount === 1 ? "" : "s"} · {hm(t.br)}, not counted above. Gaps under {GAP_ASK_MIN} minutes are not questioned. Workflow blocks are placed from when each run finished, so the timeline is approximate.
            </span>
          </section>

          {gaps.length > 0 && (!isSelf || onAnswerGap) && (
            <section className="flex flex-col gap-3" data-testid="sum-gaps">
              <H color={COLORS.orange}>{isSelf ? (gaps.length === 1 ? "1 gap still needs a reason" : `${gaps.length} gaps still need a reason`) : (gaps.length === 1 ? "1 gap with no reason given" : `${gaps.length} gaps with no reason given`)}</H>
              {gaps.map((g) => (
                <div key={g.s} style={{ backgroundColor: COLORS.bgCard, borderColor: "#7A3A22" }} className="rounded-xl border px-4 py-3.5 flex flex-col gap-2.5" data-testid="sum-gap">
                  <span style={{ color: COLORS.textPrimary }} className="text-[15px] font-semibold">{clockRange(g.s, g.e)} · {hm(g.seconds)}</span>
                  {isSelf && onAnswerGap && <ReasonPicker compact allowBreak onPick={(reason, n) => onAnswerGap(g, reason, n)} />}
                </div>
              ))}
              {isSelf && <span style={{ color: COLORS.textMuted }} className="text-xs">A gap you leave blank is saved as unexplained{adminName ? ` and ${adminName} sees it that way` : ""}.</span>}
            </section>
          )}
          {day.reasons.length > 0 && (
            <p style={{ color: "#C9CED8" }} className="text-[13px] leading-relaxed" data-testid="sum-reasons">Explained: {day.reasons.map((r) => `${r.label.toLowerCase()} ${hm(r.seconds)}`).join(" · ")}</p>
          )}

          {target.parts.length > 0 && (
            <section className="flex flex-col gap-3">
              <H>{isSelf ? "Today's target" : "Target"}</H>
              <div style={box} className="rounded-xl border px-4 py-3.5 flex flex-col gap-3">
                {target.parts.map((p) => (
                  <div key={p.key} className="flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-3">
                      <span style={{ color: COLORS.textPrimary }} className="text-[15px] font-semibold">{p.label}</span>
                      <span style={{ color: p.done >= p.goal ? COLORS.teal : COLORS.orange }} className="text-[15px] font-bold">{p.done} of {p.goal}{p.done >= p.goal ? " · hit" : ""}</span>
                    </div>
                    <div role="progressbar" aria-label={`${p.label} target`} aria-valuemin={0} aria-valuemax={p.goal} aria-valuenow={Math.min(p.done, p.goal)} style={{ backgroundColor: COLORS.border, height: 8 }} className="rounded-full overflow-hidden">
                      <div style={{ width: `${Math.min(100, (p.done / Math.max(1, p.goal)) * 100)}%`, height: "100%", backgroundColor: p.done >= p.goal ? COLORS.teal : COLORS.orange }} />
                    </div>
                  </div>
                ))}
                {streak > 0 && <span style={{ color: COLORS.textMuted }} className="text-[13px]">{streak} day{streak === 1 ? "" : "s"} in a row</span>}
              </div>
            </section>
          )}

          {steps.length > 0 && (
            <section className="flex flex-col gap-3" data-testid="sum-steps">
              <H>Steps, compared with {isSelf ? "your" : "their"} usual</H>
              <div style={box} className="rounded-xl border flex flex-col">
                {steps.map((s, i) => (
                  <div key={s.key} style={{ borderTop: i ? `1px solid ${COLORS.border}` : "none" }} className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 px-4 py-3">
                    <div className="min-w-0 flex flex-col gap-0.5" style={{ flex: "1 1 180px" }}>
                      <span style={{ color: COLORS.textPrimary }} className="text-sm font-semibold">{s.label}</span>
                      <span style={{ color: COLORS.textMuted }} className="text-xs">{s.workflowTitle}{s.index ? ` · step ${s.index}` : ""}</span>
                    </div>
                    <span className="text-sm" style={{ fontVariantNumeric: "tabular-nums", color: COLORS.textPrimary }}><b>{hm(s.today)}</b> <span style={{ color: COLORS.textMuted }}>today · {hm(s.usual)} usual</span></span>
                    <span style={s.diff > 0 ? { backgroundColor: COLORS.orangeSoft, color: COLORS.orange } : { backgroundColor: COLORS.tealSoft, color: COLORS.teal }} className="text-[11px] font-semibold rounded-full px-2.5 py-1 whitespace-nowrap">{hm(Math.abs(s.diff))} {s.diff > 0 ? "slower" : "faster"}</span>
                  </div>
                ))}
              </div>
              <span style={{ color: COLORS.textMuted }} className="text-xs">Average per video. "Usual" is {isSelf ? "your" : "their"} own average over the 30 days before.</span>
            </section>
          )}

          {todayRuns.length > 0 && (
            <section className="flex flex-col gap-3" data-testid="sum-videos">
              <H>Videos</H>
              <div style={box} className="rounded-xl border flex flex-col">
                {todayRuns.map((r, i) => (
                  <div key={r.id} style={{ borderTop: i ? `1px solid ${COLORS.border}` : "none" }} className="flex flex-wrap items-center gap-x-3.5 gap-y-1 px-4 py-3">
                    <span style={{ color: COLORS.textMuted, fontVariantNumeric: "tabular-nums" }} className="text-xs w-16 shrink-0">{formatClock(r.completedAt)}</span>
                    <span style={{ color: COLORS.textPrimary, flex: "1 1 180px" }} className="min-w-0 text-sm">{r.taskTitle || r.workflowTitle || "Workflow run"}{r.taskTitle && r.workflowTitle ? <span style={{ color: COLORS.textMuted }}> · {r.workflowTitle}</span> : null}</span>
                    {todayRuns.length > 1 && longest && longest.id === r.id && <span style={{ backgroundColor: COLORS.orangeSoft, color: COLORS.orange }} className="text-[11px] font-semibold rounded-full px-2.5 py-1">Longest</span>}
                    <span style={{ color: COLORS.textPrimary, fontVariantNumeric: "tabular-nums" }} className="text-sm font-bold">{hm(r.totalSeconds)}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {isSelf && (
            <section className="flex flex-col gap-2.5">
              <H>{punching ? "Before you go" : "Coming up"}</H>
              {paused.map((a) => (
                <div key={a.workflowTitle + a.lastActiveAt} style={{ backgroundColor: "rgba(242,120,75,0.10)", borderColor: "#7A3A22" }} className="rounded-xl border px-4 py-3 flex flex-col gap-0.5" data-testid="sum-paused">
                  <span style={{ color: COLORS.orange }} className="text-sm font-semibold">{a.paused ? "One workflow is paused" : "A workflow is still running"} at step {a.stepIndex} of {a.stepCount}</span>
                  <span style={{ color: "#C9CED8" }} className="text-[13px]">{a.taskTitle || a.workflowTitle} · {a.paused ? "it will be waiting where you left it." : "pause or finish it before you punch out, or its timer keeps going."}</span>
                </div>
              ))}
              <div style={box} className="rounded-xl border px-4 py-3 flex flex-col gap-0.5">
                <span style={{ color: COLORS.textPrimary }} className="text-sm font-semibold">{queue.length ? `Next in your queue: ${queue[0].title}` : "Your queue is empty"}</span>
                {queue.length > 0 && <span style={{ color: COLORS.textMuted }} className="text-[13px]">{queue.length} task{queue.length === 1 ? "" : "s"} in your queue{overdue ? ` · ${overdue} will be overdue tomorrow` : ""}</span>}
              </div>
              {punching && (
                <label className="flex flex-col gap-1.5 text-xs font-semibold" style={{ color: COLORS.textMuted }}>Anything {adminName || "your admin"} should know? (optional)
                  <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} data-testid="sum-note" placeholder="For example: the Senate feed kept dropping this afternoon"
                    style={{ backgroundColor: COLORS.bg, borderColor: COLORS.border, color: COLORS.textPrimary }} className="min-h-[46px] rounded-xl border px-3.5 text-sm font-normal outline-none focus:ring-2" />
                </label>
              )}
            </section>
          )}
          {!punching && rec && rec.dayNote && (
            <section className="flex flex-col gap-2" data-testid="sum-saved-note">
              <H>Note {isSelf ? "you left" : `from ${name}`}</H>
              <p style={{ ...box, color: COLORS.textPrimary }} className="rounded-xl border px-4 py-3 text-sm leading-relaxed">{rec.dayNote}</p>
            </section>
          )}
        </div>
      )}

      <div style={{ borderColor: COLORS.border }} className="flex flex-wrap items-center gap-2.5 px-5 sm:px-6 py-4 border-t">
        <span style={{ color: COLORS.textMuted, flex: "1 1 160px" }} className="text-xs">{punching ? "You are still on the clock until you punch out." : ""}</span>
        <button type="button" onClick={onClose} data-testid="sum-close" style={{ borderColor: "#3A4250", color: COLORS.textPrimary }} className="min-h-[46px] px-4 rounded-xl border text-sm font-semibold">{punching ? "Keep working" : "Close"}</button>
        {punching && <button type="button" onClick={() => onPunchOut(note.trim())} data-testid="sum-punch-out" style={{ backgroundColor: COLORS.danger, color: "#1A0505" }} className="min-h-[46px] px-5 rounded-xl text-sm font-bold">Punch out</button>}
      </div>
    </Modal>
  );
}

// Admin: the week per editor.
export function WeekTimeScreen({ profiles, teamEditors, attendance, runs, tasks, targets, liveActivity, expect, onSaveExpect, onBack, onOpenDay }) {
  const today = dayKey(new Date().toISOString());
  const [endDk, setEndDk] = useState(today);
  const [editing, setEditing] = useState(false);
  const ex = normalizeExpect(expect);
  const [draft, setDraft] = useState(ex);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => shiftDay(endDk, i - 6)), [endDk]);
  const now = Date.now();
  const label = (dk, opts) => { try { return new Date(dk + "T12:00:00").toLocaleDateString("en-GB", opts); } catch (e) { return dk; } };
  const people = (teamEditors || []).map((e) => {
    const perDay = days.map((dk) => {
      const rec = (attendance || {})[`${e.uid}_${dk}`] || null;
      const day = computeDay({ uid: e.uid, rec, runs, live: dk === today ? liveActivity : [], now });
      return { dk, rec, day, verdict: judgeDay(day, ex) };
    });
    const worked = perDay.filter((d) => d.day.punched);
    const sum = (k) => worked.reduce((s, d) => s + d.day.totals[k], 0);
    const clock = sum("clock"), un = sum("un");
    const below = worked.filter((d) => d.verdict.judged && !d.verdict.ok).length;
    const reasons = {};
    worked.forEach((d) => d.day.reasons.forEach((r) => { reasons[r.label] = (reasons[r.label] || 0) + r.seconds; }));
    const reasonList = Object.entries(reasons).sort((a, b) => b[1] - a[1]);
    const videos = (runs || []).filter((r) => r.completedByUid === e.uid && r.completedAt && days.includes(dayKey(r.completedAt))).length;
    // One reason swallowing a big share of the clock is worth a look even when everything is "explained".
    const top = reasonList[0];
    const dominated = top && clock > 0 && top[1] / clock >= 0.25 && top[1] >= 2 * 3600;
    return { ...e, perDay, worked: worked.length, clock, un, below, videos, reasonList, dominated: dominated ? top : null,
      accounted: clock > 0 ? Math.round(((clock - un) / clock) * 100) : null, maxClock: Math.max(1, ...perDay.map((d) => d.day.totals.clock)) };
  }).sort((a, b) => (b.below - a.below) || (b.un - a.un) || a.name.localeCompare(b.name));
  const scale = Math.max(3600, ...people.map((p) => p.maxClock));

  return (
    <div className="flex-1 flex flex-col w-full overflow-y-auto fade-in" data-testid="week-time">
      <div className="w-full max-w-5xl mx-auto px-4 sm:px-6 py-7 flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={onBack} aria-label="Back" style={{ borderColor: COLORS.border, color: COLORS.textPrimary }} className="w-11 h-11 rounded-xl border flex items-center justify-center text-lg">←</button>
          <h2 style={{ color: COLORS.textPrimary, flex: "1 1 240px" }} className="text-xl sm:text-2xl font-bold">Where the time went · {label(days[0], { day: "numeric", month: "short" })} to {label(days[6], { day: "numeric", month: "short" })}</h2>
          <button onClick={() => setEndDk(shiftDay(endDk, -7))} style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border, color: COLORS.textPrimary }} className="min-h-[44px] px-3.5 rounded-xl border text-[13px] font-semibold">← Earlier</button>
          <button onClick={() => setEndDk(shiftDay(endDk, 7) > today ? today : shiftDay(endDk, 7))} disabled={endDk >= today} style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border, color: COLORS.textPrimary, opacity: endDk >= today ? 0.4 : 1 }} className="min-h-[44px] px-3.5 rounded-xl border text-[13px] font-semibold">Later →</button>
        </div>

        <div style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border }} className="rounded-2xl border px-4 py-3.5 flex flex-wrap items-center gap-x-4 gap-y-2.5" data-testid="expect-box">
          {editing ? (
            <React.Fragment>
              <label className="text-sm inline-flex items-center gap-2" style={{ color: COLORS.textPrimary }}>At least
                <input type="number" min={0} max={100} value={draft.accountedPct} onChange={(e) => setDraft({ ...draft, accountedPct: e.target.value })} data-testid="expect-pct"
                  style={{ backgroundColor: COLORS.bg, borderColor: COLORS.border, color: COLORS.textPrimary }} className="w-20 min-h-[40px] rounded-lg border px-2 text-sm text-center" />% accounted for</label>
              <label className="text-sm inline-flex items-center gap-2" style={{ color: COLORS.textPrimary }}>and at most
                <input type="number" min={0} max={600} value={draft.unexplainedMax} onChange={(e) => setDraft({ ...draft, unexplainedMax: e.target.value })} data-testid="expect-max"
                  style={{ backgroundColor: COLORS.bg, borderColor: COLORS.border, color: COLORS.textPrimary }} className="w-20 min-h-[40px] rounded-lg border px-2 text-sm text-center" />minutes unexplained a day</label>
              <span className="flex-1" />
              <button onClick={() => { onSaveExpect(normalizeExpect(draft)); setEditing(false); }} data-testid="expect-save" style={{ backgroundColor: COLORS.teal, color: "#04211D" }} className="min-h-[40px] px-4 rounded-lg text-[13px] font-bold">Save</button>
              <button onClick={() => { setDraft(ex); setEditing(false); }} style={{ borderColor: COLORS.border, color: COLORS.textMuted }} className="min-h-[40px] px-3.5 rounded-lg border text-[13px] font-semibold">Cancel</button>
            </React.Fragment>
          ) : (
            <React.Fragment>
              <span style={{ color: COLORS.textPrimary, flex: "1 1 300px" }} className="text-sm">Expected: at least <b>{ex.accountedPct}%</b> of clock time accounted for, and no more than <b>{hm(ex.unexplainedMax * 60)}</b> unexplained in a day.</span>
              <button onClick={() => { setDraft(ex); setEditing(true); }} data-testid="expect-edit" style={{ borderColor: COLORS.border, color: COLORS.teal }} className="min-h-[40px] px-3.5 rounded-lg border text-[13px] font-semibold">Change</button>
            </React.Fragment>
          )}
        </div>

        <TimeLegend />
        {people.length === 0 && <p style={{ color: COLORS.textMuted }} className="text-sm py-10 text-center">No editors on the team yet.</p>}
        {people.map((p) => {
          const low = p.below > 0 || p.dominated;
          const verdict = p.worked === 0 ? "Not punched in this week" : p.below > 0 ? `Below the expected level on ${p.below} of ${p.worked} day${p.worked === 1 ? "" : "s"}` : p.dominated ? "Accounted for, but one reason dominates" : "Within the expected level";
          return (
            <section key={p.uid} style={{ backgroundColor: COLORS.bgCard, borderColor: low ? "#7A3A22" : COLORS.border }} className="rounded-2xl border p-5 flex flex-wrap items-center gap-x-7 gap-y-5" data-testid={`week-${p.uid}`}>
              <div className="min-w-0 flex flex-col gap-2" style={{ flex: "1 1 210px" }}>
                <div className="flex items-center gap-2.5">
                  <span style={{ backgroundColor: "#1C2028", color: "#C9CED8" }} className="w-[34px] h-[34px] rounded-full flex items-center justify-center text-sm font-bold">{p.name.slice(0, 1).toUpperCase()}</span>
                  <h3 style={{ color: COLORS.textPrimary }} className="text-[17px] font-bold">{p.name}</h3>
                </div>
                <span style={low ? { backgroundColor: COLORS.orangeSoft, color: COLORS.orange } : p.worked ? { backgroundColor: COLORS.tealSoft, color: COLORS.teal } : { backgroundColor: "#1C2028", color: "#C9CED8" }} className="self-start text-xs font-semibold rounded-full px-2.5 py-1" data-testid={`week-verdict-${p.uid}`}>{verdict}</span>
                {p.dominated && <span style={{ color: COLORS.textMuted }} className="text-[13px] leading-relaxed">"{p.dominated[0]}" is {Math.round((p.dominated[1] / p.clock) * 100)}% of clock time ({hm(p.dominated[1])}). Compare it with the step times in Insights.</span>}
              </div>

              <div className="min-w-0 flex items-end gap-2" style={{ flex: "1 1 280px", height: 132 }}>
                {p.perDay.map((d) => {
                  const tt = d.day.totals;
                  const bad = d.verdict.judged && !d.verdict.ok;
                  return (
                    <button key={d.dk} type="button" disabled={!d.day.punched} onClick={() => onOpenDay(p.uid, d.dk)} data-testid={`week-day-${p.uid}-${d.dk}`}
                      title={d.day.punched ? `${label(d.dk, { weekday: "short", day: "numeric", month: "short" })}: ${hm(tt.clock)} on the clock, ${hm(tt.un)} unexplained — open the day` : "Not punched in"}
                      className="flex-1 min-w-0 h-full flex flex-col justify-end items-center gap-1.5" style={{ cursor: d.day.punched ? "pointer" : "default" }}>
                      <span style={{ height: `${Math.round((tt.clock / scale) * 100)}%`, minHeight: d.day.punched ? 6 : 0, maxWidth: 44, backgroundColor: COLORS.border, outline: bad ? `2px solid ${COLORS.orange}` : "none", outlineOffset: 2 }} className="w-full flex flex-col-reverse gap-[2px] rounded-md overflow-hidden">
                        {BAR_ORDER.filter((k) => tt[k] > 0).map((k) => <span key={k} style={{ flex: `${tt[k]} 1 0`, backgroundColor: KIND[k].color }} />)}
                      </span>
                      <span style={{ color: d.dk === today ? COLORS.textPrimary : COLORS.textMuted }} className="text-[11px]">{label(d.dk, { weekday: "short" })}</span>
                    </button>
                  );
                })}
              </div>

              <div className="min-w-0 grid gap-x-4 gap-y-3" style={{ flex: "1 1 260px", gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
                {[[hm(p.clock), "on the clock", COLORS.textPrimary], [String(p.videos), "runs finished", COLORS.textPrimary],
                  [p.accounted == null ? "—" : `${p.accounted}%`, "accounted for", p.accounted != null && p.accounted < ex.accountedPct ? COLORS.orange : COLORS.teal],
                  [hm(p.un), "unexplained", p.below > 0 ? COLORS.orange : COLORS.textPrimary]].map(([v, l, c]) => (
                  <div key={l} className="flex flex-col gap-0.5">
                    <span style={{ color: c, fontVariantNumeric: "tabular-nums" }} className="text-xl font-bold">{v}</span>
                    <span style={{ color: COLORS.textMuted }} className="text-xs">{l}</span>
                  </div>
                ))}
                <span style={{ color: COLORS.textMuted, gridColumn: "1 / -1" }} className="text-xs leading-relaxed">
                  {p.reasonList.length ? `Reasons given: ${p.reasonList.slice(0, 4).map(([l, s]) => `${l.toLowerCase()} ${hm(s)}`).join(" · ")}` : "No reasons given this week."}
                </span>
              </div>
            </section>
          );
        })}
        <p style={{ color: COLORS.textMuted }} className="text-xs leading-relaxed">Bar height is hours on the clock that day; an orange outline marks a day below the expected level. Click a day to open its summary. Time before this tracking started (14 Nov) is never marked unexplained, because only workflows were being recorded then.</p>
      </div>
    </div>
  );
}

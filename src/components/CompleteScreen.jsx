import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { COLORS, formatTime, runCode } from "../lib/core";
import { BarChart2, HomeIcon, RotateCcw } from "./Icon";

const CONFETTI_COLORS = [COLORS.teal, COLORS.orange, COLORS.violet];

// A one-time burst, not a decoration that lingers — 46 pieces fall and fade
// over about 1.6s, then the component removes itself. Built from the app's
// own three accent colors so it reads as "this app celebrating," not a
// generic library effect dropped in.
function Confetti() {
  const [show, setShow] = useState(true);
  const pieces = useMemo(() => {
    const reduced = typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return [];
    return Array.from({ length: 46 }, (_, i) => ({
      id: i,
      left: 50 + (Math.random() - 0.5) * 70,        // spread around center, in vw-ish percent
      delay: Math.random() * 0.15,
      duration: 1.1 + Math.random() * 0.6,
      drift: (Math.random() - 0.5) * 160,
      rotate: Math.random() * 520,
      size: 6 + Math.random() * 6,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      round: Math.random() > 0.5,
    }));
  }, []);

  useEffect(() => {
    if (!pieces.length) return;
    const t = setTimeout(() => setShow(false), 2000);
    return () => clearTimeout(t);
  }, [pieces.length]);

  if (!show || !pieces.length) return null;

  return (
    <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 60, overflow: "hidden" }} aria-hidden="true">
      <style>{`
        @keyframes confetti-fall {
          0% { transform: translate(0, -40px) rotate(0deg); opacity: 1; }
          100% { transform: translate(var(--drift), 70vh) rotate(var(--rot)); opacity: 0; }
        }
      `}</style>
      {pieces.map((p) => (
        <span key={p.id} style={{
          position: "absolute", top: 0, left: `${p.left}%`,
          width: p.size, height: p.size * (p.round ? 1 : 1.6),
          backgroundColor: p.color, borderRadius: p.round ? "50%" : 2,
          animation: `confetti-fall ${p.duration}s cubic-bezier(.25,.46,.45,.94) ${p.delay}s both`,
          "--drift": `${p.drift}px`, "--rot": `${p.rotate}deg`,
        }} />
      ))}
    </div>
  );
}

export default function CompleteScreen({ workflow, stepTimes, totalSeconds, runId, onRestart, onEdit, onInsights, onGoHome }) {
  const maxTime = Math.max(1, ...workflow.steps.map((s) => stepTimes[s.id] || 0));
  const avg = totalSeconds / workflow.steps.length;
  const code = runCode(runId);

  return (
    <main className="flex-1 flex flex-col items-center px-6 py-10 overflow-y-auto">
      <Confetti />
      <div className="flex flex-col items-center text-center mb-8">
        <div className="pop-in rounded-full flex items-center justify-center mb-6" style={{ width: 80, height: 80, backgroundColor: COLORS.tealSoft }}>
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
            <path d="M4 12.5L9.5 18L20 6" stroke={COLORS.teal} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
              style={{ strokeDasharray: 48, strokeDashoffset: 0, animation: "checkDraw 0.6s ease-out" }} />
          </svg>
        </div>
        <p style={{ color: COLORS.textFaint }} className="font-mono text-xs tracking-[0.2em] uppercase mb-2">{workflow.title}</p>
        <h2 style={{ color: COLORS.textPrimary }} className="text-3xl sm:text-4xl font-bold mb-1">Workflow Complete</h2>
        <p style={{ color: COLORS.textMuted }} className="font-mono text-sm mt-2">Total time {formatTime(totalSeconds)} · avg {formatTime(avg)} / step</p>
      </div>

      {code && (
        <div style={{ backgroundColor: COLORS.violetSoft, borderColor: COLORS.violet }} className="w-full max-w-xl rounded-2xl border p-5 mb-8 text-center">
          <p style={{ color: COLORS.violet }} className="font-mono text-[11px] tracking-[0.2em] uppercase mb-2">Rename your exported file to this</p>
          <p style={{ color: COLORS.textPrimary }} className="font-mono text-3xl font-bold tracking-widest mb-2">{code}</p>
          <p style={{ color: COLORS.textMuted }} className="text-xs leading-relaxed">
            This code identifies this specific run everywhere it shows up in the system — day view, performance stats, everywhere. Use it as the file name so it's always obvious which file this is.
          </p>
        </div>
      )}

      <div style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border }} className="w-full max-w-xl rounded-2xl border p-5 mb-8">
        <p style={{ color: COLORS.textFaint }} className="font-mono text-[11px] tracking-[0.2em] uppercase mb-4">Time per step</p>
        <div className="flex flex-col gap-3">
          {workflow.steps.map((s, i) => {
            const t = stepTimes[s.id] || 0;
            const pct = Math.max(4, (t / maxTime) * 100);
            return (
              <div key={s.id} className="flex items-center gap-3">
                <span style={{ color: COLORS.textFaint }} className="font-mono text-xs w-6 shrink-0">{String(i + 1).padStart(2, "0")}</span>
                <span style={{ color: COLORS.textMuted }} className="text-sm flex-1 truncate" title={s.text}>{s.text}</span>
                <div className="w-24 h-1.5 rounded-full shrink-0" style={{ backgroundColor: COLORS.border }}>
                  <div className="h-1.5 rounded-full" style={{ width: `${pct}%`, backgroundColor: COLORS.orange }} />
                </div>
                <span style={{ color: COLORS.orange }} className="font-mono text-xs w-14 text-right shrink-0">{formatTime(t)}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex gap-3 flex-wrap justify-center">
        <button onClick={onRestart} style={{ backgroundColor: COLORS.teal, color: "#04211D" }}
          className="flex items-center gap-2 rounded-2xl px-6 py-4 text-base font-bold transition-all duration-200 active:scale-[0.98] hover:brightness-105">
          <RotateCcw size={18} /> Start Over
        </button>
        <button onClick={onInsights} style={{ borderColor: COLORS.border, color: COLORS.textMuted }}
          className="flex items-center gap-2 rounded-2xl border px-6 py-4 text-base font-semibold transition-opacity hover:opacity-80">
          <BarChart2 size={18} /> Insights
        </button>
        <button onClick={onGoHome} style={{ borderColor: COLORS.border, color: COLORS.textMuted }}
          className="flex items-center gap-2 rounded-2xl border px-6 py-4 text-base font-semibold transition-opacity hover:opacity-80">
          <HomeIcon size={18} /> Home
        </button>
      </div>
    </main>
  );
}

/* -------------------------- INSIGHTS SCREEN -------------------------- */


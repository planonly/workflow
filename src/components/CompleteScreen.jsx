import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { COLORS, formatTime } from "../lib/core";
import { BarChart2, HomeIcon, RotateCcw } from "./Icon";


export default function CompleteScreen({ workflow, stepTimes, totalSeconds, onRestart, onEdit, onInsights, onGoHome }) {
  const maxTime = Math.max(1, ...workflow.steps.map((s) => stepTimes[s.id] || 0));
  const avg = totalSeconds / workflow.steps.length;

  return (
    <main className="flex-1 flex flex-col items-center px-6 py-10 overflow-y-auto">
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


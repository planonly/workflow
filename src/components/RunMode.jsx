import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { COLORS, formatTime } from "../lib/core";
import { ArrowLeft, ArrowRight, BarChart2, Check, HomeIcon, Pause, Play, RotateCcw, Settings, Timer } from "./Icon";


export default function RunMode({ workflow, stepIndex, total, direction, animKey, paused, currentSeconds, totalSeconds, checkedSubsteps, onToggleSubstep, onNext, onBack, onTogglePause, onEdit, onGoHome, onOpenInsights, onRestart, myTasks, activeTaskId, onSetTask, workflowChannelId, idlePrompt, onConfirmActive, onPauseFromIdle, isClockedIn, onPunchIn }) {
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === total - 1;
  const playheadPct = ((stepIndex + 0.5) / total) * 100;
  const currentStep = workflow.steps[stepIndex];
  const substeps = currentStep.substeps || [];

  return (
    <>
      <header className="w-full px-6 pt-6 pb-3 sm:px-10 sm:pt-8">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <p style={{ color: COLORS.textFaint }} className="font-mono text-[11px] tracking-[0.2em] uppercase mb-1">Workflow</p>
            <h1 style={{ color: COLORS.textPrimary }} className="text-lg sm:text-xl font-semibold truncate">{workflow.title}</h1>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={onGoHome} aria-label="Home" style={{ borderColor: COLORS.border, color: COLORS.textMuted }} className="rounded-full border p-2 hover:opacity-80 transition-opacity"><HomeIcon size={18} /></button>
            <button onClick={onOpenInsights} aria-label="Insights" style={{ borderColor: COLORS.border, color: COLORS.textMuted }} className="rounded-full border p-2 hover:opacity-80 transition-opacity"><BarChart2 size={18} /></button>
            <button onClick={onTogglePause} aria-label={paused ? "Resume timer" : "Pause timer"} style={{ borderColor: COLORS.border, color: paused ? COLORS.orange : COLORS.textMuted }} className="rounded-full border p-2 hover:opacity-80 transition-opacity">
              {paused ? <Play size={18} /> : <Pause size={18} />}
            </button>
            <button onClick={onEdit} aria-label="Edit workflow" style={{ borderColor: COLORS.border, color: COLORS.textMuted }} className="rounded-full border p-2 hover:opacity-80 transition-opacity"><Settings size={18} /></button>
            <button onClick={() => { if (window.confirm("Restart this workflow from step 1? Your progress on this run will be cleared.")) onRestart(); }} aria-label="Restart workflow" style={{ borderColor: COLORS.border, color: COLORS.textMuted }} className="rounded-full border p-2 hover:opacity-80 transition-opacity"><RotateCcw size={18} /></button>
          </div>
        </div>

        {!isClockedIn && (
          <div style={{ backgroundColor: COLORS.orangeSoft, borderColor: COLORS.orange }}
            className="flex items-center gap-3 rounded-xl border px-3 py-2 mt-3 flex-wrap">
            <span style={{ color: COLORS.orange }} className="text-xs flex-1">
              You're not clocked in — this work won't show on your timesheet.
            </span>
            <button onClick={onPunchIn} style={{ backgroundColor: COLORS.orange, color: "#2A1200" }}
              className="rounded-lg px-3 py-1.5 text-xs font-bold hover:brightness-105 transition-all">
              Punch in
            </button>
          </div>
        )}

        {myTasks && myTasks.length > 0 && (
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            <span style={{ color: COLORS.textFaint }} className="font-mono text-[10px] tracking-[0.15em] uppercase">Working on</span>
            <select value={activeTaskId || ""} onChange={(e) => onSetTask(e.target.value)}
              style={{ backgroundColor: COLORS.bgElevated, borderColor: activeTaskId ? COLORS.teal : COLORS.border, color: activeTaskId ? COLORS.textPrimary : COLORS.textMuted }}
              className="rounded-lg border px-2.5 py-1.5 text-xs outline-none focus:ring-2 max-w-[240px]">
              <option value="">Not linked to a task</option>
              {myTasks.filter((t) => !t.channelId || t.channelId === workflowChannelId)
                .map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
              {myTasks.some((t) => t.channelId && t.channelId !== workflowChannelId) && (
                <optgroup label="Other channels">
                  {myTasks.filter((t) => t.channelId && t.channelId !== workflowChannelId)
                    .map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
                </optgroup>
              )}
            </select>
          </div>
        )}

        <div className="flex items-center gap-2 mt-4 flex-wrap">
          <span style={{ backgroundColor: COLORS.orangeSoft, color: COLORS.orange }} className="flex items-center gap-1.5 font-mono text-xs sm:text-sm rounded-full px-3 py-1">
            <span className={!paused ? "rec-dot" : ""} style={{ width: 6, height: 6, borderRadius: 9999, backgroundColor: COLORS.orange, display: "inline-block" }} />
            {paused ? "Paused" : "This step"} · {formatTime(currentSeconds)}
          </span>
          <span style={{ color: COLORS.textMuted, borderColor: COLORS.border }} className="font-mono text-xs sm:text-sm border rounded-full px-3 py-1">
            <Timer size={12} style={{ display: "inline", marginRight: 4, marginTop: -2 }} />
            Total {formatTime(totalSeconds)}
          </span>
          <span style={{ color: COLORS.textMuted, borderColor: COLORS.border }} className="font-mono text-xs sm:text-sm border rounded-full px-3 py-1 ml-auto">
            {String(stepIndex + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}
          </span>
        </div>

        <div className="relative mt-4">
          <div className="absolute -top-2.5 transition-all duration-300 ease-out"
            style={{ left: `${playheadPct}%`, transform: "translateX(-50%)", width: 0, height: 0, borderLeft: "5px solid transparent", borderRight: "5px solid transparent", borderTop: `6px solid ${COLORS.teal}` }} />
          <div className="flex gap-1.5" role="progressbar" aria-valuenow={stepIndex + 1} aria-valuemin={1} aria-valuemax={total}>
            {workflow.steps.map((s, i) => {
              const filled = i <= stepIndex;
              const isCurrent = i === stepIndex;
              return <div key={s.id} className={`h-1.5 flex-1 rounded-full transition-colors duration-300 ${isCurrent ? "segment-current" : ""}`} style={{ backgroundColor: filled ? COLORS.teal : COLORS.border }} />;
            })}
          </div>
        </div>
      </header>

      {idlePrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-6" style={{ backgroundColor: "rgba(0,0,0,0.7)" }}>
          <div style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.orange }} className="rounded-2xl border p-6 max-w-sm w-full text-center">
            <p style={{ color: COLORS.textPrimary }} className="font-semibold text-lg mb-2">Still working on this?</p>
            <p style={{ color: COLORS.textMuted }} className="text-sm leading-relaxed mb-5">
              No activity for 15 minutes. The clock is still running — confirm you're here, or pause it.
            </p>
            <div className="flex gap-3">
              <button onClick={onPauseFromIdle} style={{ borderColor: COLORS.border, color: COLORS.textMuted }}
                className="flex-1 rounded-xl border py-3 text-sm font-semibold hover:opacity-80 transition-opacity">
                Pause
              </button>
              <button onClick={onConfirmActive} style={{ backgroundColor: COLORS.teal, color: "#04211D" }}
                className="flex-1 rounded-xl py-3 text-sm font-bold hover:brightness-105 transition-all active:scale-[0.98]">
                Still here
              </button>
            </div>
            <p style={{ color: COLORS.textFaint }} className="text-[11px] mt-4 leading-relaxed">
              No answer within the hour and this pauses automatically — only time up to now is counted.
            </p>
          </div>
        </div>
      )}

      <main className="flex-1 flex items-center justify-center px-6 sm:px-10 overflow-y-auto py-4">
        <div key={animKey} className={`max-w-3xl w-full text-center ${direction === "forward" ? "step-forward" : "step-backward"}`}>
          <p style={{ color: COLORS.textFaint }} className="font-mono text-xs sm:text-sm tracking-[0.2em] uppercase mb-4">Step {stepIndex + 1}</p>
          <p style={{ color: COLORS.textPrimary }} className="text-3xl sm:text-5xl leading-snug sm:leading-snug font-semibold mb-2">{currentStep.text}</p>

          {substeps.length > 0 && (
            <div className="mt-8 max-w-md mx-auto text-left flex flex-col gap-2">
              {substeps.map((sub) => {
                const isChecked = checkedSubsteps.includes(sub.id);
                return (
                  <button key={sub.id} onClick={() => onToggleSubstep(sub.id)}
                    className="flex items-center gap-3 rounded-xl px-4 py-3 transition-all"
                    style={{ backgroundColor: isChecked ? COLORS.tealSoft : COLORS.bgCard, border: `1px solid ${isChecked ? COLORS.teal : COLORS.border}` }}>
                    <span className="w-5 h-5 rounded-md flex items-center justify-center shrink-0 transition-all"
                      style={{ backgroundColor: isChecked ? COLORS.teal : "transparent", border: `2px solid ${isChecked ? COLORS.teal : COLORS.textFaint}` }}>
                      {isChecked && <Check size={13} style={{ color: "#04211D" }} />}
                    </span>
                    <span className="text-sm sm:text-base" style={{ color: isChecked ? COLORS.textMuted : COLORS.textPrimary, textDecoration: isChecked ? "line-through" : "none" }}>
                      {sub.text}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </main>

      <footer className="w-full px-4 pb-4 pt-2 sm:px-8 sm:pb-8">
        <div className="max-w-3xl mx-auto flex gap-3 sm:gap-4">
          <button onClick={onBack} disabled={isFirst}
            style={{ borderColor: COLORS.border, color: isFirst ? COLORS.textFaint : COLORS.textPrimary, backgroundColor: COLORS.bgElevated, opacity: isFirst ? 0.45 : 1 }}
            className="flex-1 flex items-center justify-center gap-2 border rounded-2xl py-5 sm:py-6 text-lg sm:text-xl font-semibold transition-all duration-200 active:scale-[0.98] disabled:cursor-not-allowed">
            <ArrowLeft size={22} /> Back
          </button>
          <button onClick={onNext} style={{ backgroundColor: COLORS.teal, color: "#04211D" }}
            className="flex-[1.4] flex items-center justify-center gap-2 rounded-2xl py-5 sm:py-6 text-lg sm:text-xl font-bold transition-all duration-200 active:scale-[0.98] hover:brightness-105">
            {isLast ? "Finish" : "Next"} <ArrowRight size={22} />
          </button>
        </div>
        <p style={{ color: COLORS.textFaint }} className="text-center font-mono text-[11px] tracking-wide mt-3">
          ← Back &nbsp;·&nbsp; Space to {paused ? "resume" : "pause"} &nbsp;·&nbsp; Next →
        </p>
      </footer>
    </>
  );
}

/* ---------------------- COMPLETE SCREEN ---------------------- */


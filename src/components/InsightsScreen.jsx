import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { COLORS, formatTime, displayNameFor } from "../lib/core";
import { Timer } from "./Icon";
import { LineSpark, RunRow, ScreenHeader, StatCard, WorkflowSelect } from "./shared";


export default function InsightsScreen({ workflows, activeId, runs, profiles, onSelectWorkflow, onClose, onDeleteRun, onUpdateRun }) {
  const [showAll, setShowAll] = useState(false);
  const [editingRunId, setEditingRunId] = useState(null);
  // May legitimately be undefined: someone whose channels contain no workflows
  // has nothing to analyse. Every derived value below has to tolerate that.
  const wf = workflows.find((w) => w.id === activeId) || workflows[0] || null;
  const wfRuns = useMemo(
    () => (wf ? runs.filter((r) => r.workflowId === wf.id).sort((a, b) => new Date(a.completedAt) - new Date(b.completedAt)) : []),
    [runs, wf]
  );

  if (!wf) {
    return (
      <div className="flex-1 flex flex-col max-w-3xl w-full mx-auto px-6 py-8 sm:py-10 fade-in">
        <ScreenHeader title="Insights" onClose={onClose} />
        <div className="flex-1 flex flex-col items-center justify-center text-center py-16">
          <Timer size={32} style={{ color: COLORS.textFaint }} className="mb-4" />
          <p style={{ color: COLORS.textMuted }} className="text-lg font-semibold mb-1">Nothing to analyse yet</p>
          <p style={{ color: COLORS.textFaint }} className="text-sm max-w-sm">
            No workflows are visible to you. Once one is assigned to a channel you belong to, its run history shows up here.
          </p>
        </div>
      </div>
    );
  }

  const exportCsv = () => {
    const header = "Date,Completed By,Total Seconds,Total Time\n";
    const rows = wfRuns.map((r) => {
      const name = displayNameFor(r.completedByUid, profiles, r.completedBy);
      return `"${r.completedAt}","${name}",${Math.round(r.totalSeconds)},"${formatTime(r.totalSeconds)}"`;
    }).join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(wf.title || "workflow").replace(/[^a-z0-9]+/gi, "_")}_runs.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (wfRuns.length === 0) {
    return (
      <div className="flex-1 flex flex-col max-w-3xl w-full mx-auto px-6 py-8 sm:py-10 fade-in">
        <ScreenHeader title="Insights" onClose={onClose} />
        <WorkflowSelect workflows={workflows} activeId={wf.id} onSelect={onSelectWorkflow} />
        <div className="flex-1 flex flex-col items-center justify-center text-center py-16">
          <Timer size={32} style={{ color: COLORS.textFaint }} className="mb-4" />
          <p style={{ color: COLORS.textMuted }} className="text-lg font-semibold mb-1">No runs yet</p>
          <p style={{ color: COLORS.textFaint }} className="text-sm max-w-sm">Complete this workflow once to start seeing trends, averages, and per-step breakdowns here.</p>
        </div>
      </div>
    );
  }

  const totals = wfRuns.map((r) => r.totalSeconds);
  const avgTotal = totals.reduce((a, b) => a + b, 0) / totals.length;
  const fastest = Math.min(...totals);
  const slowest = Math.max(...totals);

  const stepAgg = {};
  wfRuns.forEach((r) => {
    (r.stepOrder || Object.keys(r.stepTimes)).forEach((sid) => {
      const t = r.stepTimes[sid];
      if (t == null) return;
      if (!stepAgg[sid]) stepAgg[sid] = { label: r.stepLabels[sid] || "Step", total: 0, count: 0 };
      stepAgg[sid].total += t;
      stepAgg[sid].count += 1;
    });
  });
  const stepAvgs = Object.values(stepAgg)
    .map((s) => ({ label: s.label, avg: s.total / s.count }))
    .sort((a, b) => b.avg - a.avg);
  const maxStepAvg = Math.max(...stepAvgs.map((s) => s.avg), 1);

  const recent = [...wfRuns].reverse().slice(0, 8);

  return (
    <div className="flex-1 flex flex-col max-w-3xl w-full mx-auto px-6 py-8 sm:py-10 overflow-y-auto fade-in">
      <ScreenHeader title="Insights" onClose={onClose} />
      <div className="flex items-center justify-between gap-3 flex-wrap mb-6">
        <WorkflowSelect workflows={workflows} activeId={wf.id} onSelect={onSelectWorkflow} noMargin />
        <button onClick={exportCsv} style={{ borderColor: COLORS.border, color: COLORS.textMuted }} className="rounded-xl border px-3 py-2.5 text-xs font-semibold hover:opacity-80 transition-opacity">
          Export CSV
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <StatCard label="Runs" value={wfRuns.length} color={COLORS.textPrimary} />
        <StatCard label="Avg time" value={formatTime(avgTotal)} color={COLORS.teal} />
        <StatCard label="Fastest" value={formatTime(fastest)} color={COLORS.teal} />
        <StatCard label="Slowest" value={formatTime(slowest)} color={COLORS.orange} />
      </div>

      <div style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border }} className="rounded-2xl border p-5 mb-6">
        <p style={{ color: COLORS.textFaint }} className="font-mono text-[11px] tracking-[0.2em] uppercase mb-4">Total time per run</p>
        <LineSpark points={totals} color={COLORS.teal} />
        <div className="flex justify-between mt-2">
          <span style={{ color: COLORS.textFaint }} className="font-mono text-[11px]">Run 1</span>
          <span style={{ color: COLORS.textFaint }} className="font-mono text-[11px]">Run {wfRuns.length}</span>
        </div>
      </div>

      <div style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border }} className="rounded-2xl border p-5 mb-6">
        <p style={{ color: COLORS.textFaint }} className="font-mono text-[11px] tracking-[0.2em] uppercase mb-4">Average time per step (slowest first)</p>
        <div className="flex flex-col gap-3">
          {stepAvgs.map((s, i) => (
            <div key={i} className="flex items-center gap-3">
              <span style={{ color: COLORS.textMuted }} className="text-sm flex-1 truncate" title={s.label}>{s.label}</span>
              <div className="w-28 h-1.5 rounded-full shrink-0" style={{ backgroundColor: COLORS.border }}>
                <div className="h-1.5 rounded-full" style={{ width: `${Math.max(4, (s.avg / maxStepAvg) * 100)}%`, backgroundColor: COLORS.orange }} />
              </div>
              <span style={{ color: COLORS.orange }} className="font-mono text-xs w-14 text-right shrink-0">{formatTime(s.avg)}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border }} className="rounded-2xl border p-5 mb-4">
        <div className="flex items-center justify-between mb-4">
          <p style={{ color: COLORS.textFaint }} className="font-mono text-[11px] tracking-[0.2em] uppercase">All runs ({wfRuns.length})</p>
          {wfRuns.length > 8 && (
            <button onClick={() => setShowAll((s) => !s)} style={{ color: COLORS.teal }} className="font-mono text-[11px] tracking-wide hover:opacity-80">
              {showAll ? "Show fewer" : `Show all ${wfRuns.length}`}
            </button>
          )}
        </div>
        <div className="flex flex-col gap-1">
          {(showAll ? [...wfRuns].reverse() : recent).map((r) => (
            <RunRow key={r.id} run={r} profiles={profiles} isOpen={editingRunId === r.id}
              onToggle={() => setEditingRunId((id) => (id === r.id ? null : r.id))}
              onDelete={() => { if (window.confirm("Delete this run? This can't be undone.")) onDeleteRun(r.id); }}
              onSave={(updated) => { onUpdateRun(updated); setEditingRunId(null); }} />
          ))}
        </div>
      </div>
    </div>
  );
}


import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { COLORS, formatTime, displayNameFor, dayKey, formatDateShort } from "../lib/core";
import { Timer } from "./Icon";
import { LineSpark, RunRow, ScreenHeader, StatCard, WorkflowSelect } from "./shared";


export default function InsightsScreen({ workflows, activeId, runs, profiles, channels, onSelectWorkflow, onClose, onDeleteRun, onUpdateRun }) {
  const [showAll, setShowAll] = useState(false);
  const [editingRunId, setEditingRunId] = useState(null);
  const [channelFilter, setChannelFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [editorFilter, setEditorFilter] = useState("all");
  const [rangePreset, setRangePreset] = useState("all");
  const [customStart, setCustomStart] = useState(new Date().toISOString().slice(0, 10));
  const [customEnd, setCustomEnd] = useState(new Date().toISOString().slice(0, 10));

  const shiftKey = (days) => {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString().slice(0, 10);
  };
  const RANGE_PRESETS = [
    ["today", "Today"], ["7d", "7 days"], ["30d", "30 days"], ["all", "All time"], ["custom", "Custom"],
  ];
  const range = useMemo(() => {
    if (rangePreset === "today") return { start: shiftKey(0), end: shiftKey(0) };
    if (rangePreset === "7d") return { start: shiftKey(6), end: shiftKey(0) };
    if (rangePreset === "30d") return { start: shiftKey(29), end: shiftKey(0) };
    if (rangePreset === "custom") return { start: customStart, end: customEnd };
    return null; // "all"
  }, [rangePreset, customStart, customEnd]);

  // Channel and content type both narrow which workflows even show up in the
  // picker — no point scrolling through every channel's workflows, or mixing
  // long-form and shorts templates together, to find the one you want.
  const availableWorkflows = workflows
    .filter((w) => channelFilter === "all" || w.channelId === channelFilter)
    .filter((w) => typeFilter === "all" || (w.contentType || "long") === typeFilter);
  // May legitimately be undefined: someone whose channels contain no workflows
  // has nothing to analyse. Every derived value below has to tolerate that.
  const wf = availableWorkflows.find((w) => w.id === activeId) || availableWorkflows[0] || null;

  // Everyone who's actually completed a run of THIS workflow — the editor
  // filter only needs to offer people who could plausibly be in the results.
  const editorsForWorkflow = useMemo(() => {
    if (!wf) return [];
    const uids = new Set(runs.filter((r) => r.workflowId === wf.id).map((r) => r.completedByUid).filter(Boolean));
    return Array.from(uids).map((uid) => ({ uid, name: displayNameFor(uid, profiles) }));
  }, [runs, wf, profiles]);

  const wfRuns = useMemo(() => {
    if (!wf) return [];
    return runs
      .filter((r) => r.workflowId === wf.id)
      .filter((r) => editorFilter === "all" || r.completedByUid === editorFilter)
      .filter((r) => !range || (dayKey(r.completedAt) >= range.start && dayKey(r.completedAt) <= range.end))
      .sort((a, b) => new Date(a.completedAt) - new Date(b.completedAt));
  }, [runs, wf, editorFilter, range]);

  if (!wf) {
    const filteredToEmpty = (channelFilter !== "all" || typeFilter !== "all") && workflows.length > 0;
    return (
      <div className="flex-1 flex flex-col max-w-3xl w-full mx-auto px-6 py-8 sm:py-10 fade-in">
        <ScreenHeader title="Insights" onClose={onClose} />
        <div className="flex items-center gap-2 flex-wrap mb-4">
          {channels && channels.length > 1 && (
            <select value={channelFilter} onChange={(e) => setChannelFilter(e.target.value)}
              style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, color: COLORS.textPrimary }}
              className="rounded-lg border px-2.5 py-1.5 text-xs outline-none focus:ring-2">
              <option value="all">All channels</option>
              {channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
          <div className="flex gap-1.5">
            {[["all", "All"], ["long", "Long-form"], ["short", "Shorts"], ["checking", "Checking"]].map(([val, label]) => (
              <button key={val} onClick={() => setTypeFilter(val)}
                style={{
                  backgroundColor: typeFilter === val ? COLORS.tealSoft : "transparent",
                  color: typeFilter === val ? COLORS.teal : COLORS.textMuted,
                  borderColor: typeFilter === val ? COLORS.teal : COLORS.border,
                }}
                className="rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-all">
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center text-center py-16">
          <Timer size={32} style={{ color: COLORS.textFaint }} className="mb-4" />
          <p style={{ color: COLORS.textMuted }} className="text-lg font-semibold mb-1">{filteredToEmpty ? "No workflows match these filters" : "Nothing to analyse yet"}</p>
          <p style={{ color: COLORS.textFaint }} className="text-sm max-w-sm">
            {filteredToEmpty
              ? "Try a different channel or content type above."
              : "No workflows are visible to you. Once one is assigned to a channel you belong to, its run history shows up here."}
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

  const hasAnyRunsAtAll = wf ? runs.some((r) => r.workflowId === wf.id) : false;

  if (wfRuns.length === 0) {
    return (
      <div className="flex-1 flex flex-col max-w-3xl w-full mx-auto px-6 py-8 sm:py-10 fade-in">
        <ScreenHeader title="Insights" onClose={onClose} />
        <WorkflowSelect workflows={availableWorkflows} activeId={wf.id} onSelect={onSelectWorkflow} />
        <InsightsFilters {...{ channels, channelFilter, setChannelFilter, typeFilter, setTypeFilter, editorFilter, setEditorFilter, editorsForWorkflow, rangePreset, setRangePreset, RANGE_PRESETS, customStart, setCustomStart, customEnd, setCustomEnd }} />
        <div className="flex-1 flex flex-col items-center justify-center text-center py-16">
          <Timer size={32} style={{ color: COLORS.textFaint }} className="mb-4" />
          <p style={{ color: COLORS.textMuted }} className="text-lg font-semibold mb-1">{hasAnyRunsAtAll ? "Nothing matches these filters" : "No runs yet"}</p>
          <p style={{ color: COLORS.textFaint }} className="text-sm max-w-sm">
            {hasAnyRunsAtAll
              ? "This workflow has runs, just none from this editor or date range — try widening the filters above."
              : "Complete this workflow once to start seeing trends, averages, and per-step breakdowns here."}
          </p>
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
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <WorkflowSelect workflows={availableWorkflows} activeId={wf.id} onSelect={onSelectWorkflow} noMargin />
        <button onClick={exportCsv} style={{ borderColor: COLORS.border, color: COLORS.textMuted }} className="rounded-xl border px-3 py-2.5 text-xs font-semibold hover:opacity-80 transition-opacity">
          Export CSV
        </button>
      </div>
      <InsightsFilters {...{ channels, channelFilter, setChannelFilter, typeFilter, setTypeFilter, editorFilter, setEditorFilter, editorsForWorkflow, rangePreset, setRangePreset, RANGE_PRESETS, customStart, setCustomStart, customEnd, setCustomEnd }} />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <StatCard label="Runs" value={wfRuns.length} color={COLORS.textPrimary} />
        <StatCard label="Avg time" value={formatTime(avgTotal)} color={COLORS.teal} />
        <StatCard label="Fastest" value={formatTime(fastest)} color={COLORS.teal} />
        <StatCard label="Slowest" value={formatTime(slowest)} color={COLORS.orange} />
      </div>

      <div style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border }} className="rounded-2xl border p-5 mb-6">
        <p style={{ color: COLORS.textFaint }} className="font-mono text-[11px] tracking-[0.2em] uppercase mb-4">Total time per run</p>
        <LineSpark
          points={wfRuns.map((r) => ({
            value: r.totalSeconds,
            label: `${formatDateShort(r.completedAt)} · ${displayNameFor(r.completedByUid, profiles, r.completedBy)} · ${formatTime(r.totalSeconds)}`,
          }))}
          color={COLORS.teal} />
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

function InsightsFilters({ channels, channelFilter, setChannelFilter, typeFilter, setTypeFilter, editorFilter, setEditorFilter, editorsForWorkflow, rangePreset, setRangePreset, RANGE_PRESETS, customStart, setCustomStart, customEnd, setCustomEnd }) {
  const field = { backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, color: COLORS.textPrimary };
  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 flex-wrap mb-2">
        {channels && channels.length > 1 && (
          <select value={channelFilter} onChange={(e) => setChannelFilter(e.target.value)} style={field} className="rounded-lg border px-2.5 py-1.5 text-xs outline-none focus:ring-2">
            <option value="all">All channels</option>
            {channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        <div className="flex gap-1.5">
          {[["all", "All"], ["long", "Long-form"], ["short", "Shorts"], ["checking", "Checking"]].map(([val, label]) => (
            <button key={val} onClick={() => setTypeFilter(val)}
              style={{
                backgroundColor: typeFilter === val ? COLORS.tealSoft : "transparent",
                color: typeFilter === val ? COLORS.teal : COLORS.textMuted,
                borderColor: typeFilter === val ? COLORS.teal : COLORS.border,
              }}
              className="rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-all">
              {label}
            </button>
          ))}
        </div>
        {editorsForWorkflow.length > 1 && (
          <select value={editorFilter} onChange={(e) => setEditorFilter(e.target.value)} style={field} className="rounded-lg border px-2.5 py-1.5 text-xs outline-none focus:ring-2">
            <option value="all">All editors</option>
            {editorsForWorkflow.map((e) => <option key={e.uid} value={e.uid}>{e.name}</option>)}
          </select>
        )}
      </div>
      <div className="flex items-center gap-1.5 flex-wrap mb-2">
        {RANGE_PRESETS.map(([val, label]) => (
          <button key={val} onClick={() => setRangePreset(val)}
            style={{
              backgroundColor: rangePreset === val ? COLORS.tealSoft : "transparent",
              color: rangePreset === val ? COLORS.teal : COLORS.textMuted,
              borderColor: rangePreset === val ? COLORS.teal : COLORS.border,
            }}
            className="rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-all">
            {label}
          </button>
        ))}
      </div>
      {rangePreset === "custom" && (
        <div className="flex items-center gap-2 flex-wrap">
          <input type="date" value={customStart} max={customEnd} onChange={(e) => setCustomStart(e.target.value)}
            style={field} className="rounded-lg border px-2.5 py-1.5 text-xs outline-none focus:ring-2" />
          <span style={{ color: COLORS.textFaint }} className="text-xs">to</span>
          <input type="date" value={customEnd} min={customStart} onChange={(e) => setCustomEnd(e.target.value)}
            style={field} className="rounded-lg border px-2.5 py-1.5 text-xs outline-none focus:ring-2" />
        </div>
      )}
    </div>
  );
}

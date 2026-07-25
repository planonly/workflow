import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { COLORS, uid, formatTime } from "../lib/core";
import { Check, ChevronDown, ChevronUp, Copy, GripVertical, ListChecks, Plus, Trash2, X } from "./Icon";


export default function EditMode({ workflow, isNew, stepTimes, channels, onSave, onCancel }) {
  const [title, setTitle] = useState(workflow.title);
  const [channelId, setChannelId] = useState(workflow.channelId || "");
  const [contentType, setContentType] = useState(workflow.contentType || "long");
  const [steps, setSteps] = useState((workflow.steps || []).map((s) => ({ id: s.id, text: s.text, substeps: (s.substeps || []).map((sub) => ({ id: sub.id, text: sub.text })) })));
  const [newStep, setNewStep] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editingText, setEditingText] = useState("");
  const [expanded, setExpanded] = useState({});
  const [newSubstepText, setNewSubstepText] = useState({});
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");

  const addStep = () => {
    const text = newStep.trim();
    if (!text) return;
    setSteps((s) => [...s, { id: uid(), text, substeps: [] }]);
    setNewStep("");
  };

  const addBulk = () => {
    const lines = bulkText.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return;
    setSteps((s) => [...s, ...lines.map((text) => ({ id: uid(), text, substeps: [] }))]);
    setBulkText("");
    setBulkOpen(false);
  };

  const removeStep = (id) => setSteps((s) => s.filter((st) => st.id !== id));
  const duplicateStep = (id) => {
    setSteps((s) => {
      const idx = s.findIndex((st) => st.id === id);
      if (idx === -1) return s;
      const copy = { ...s[idx], id: uid(), text: s[idx].text + " (copy)", substeps: s[idx].substeps.map((sub) => ({ id: uid(), text: sub.text })) };
      const next = [...s];
      next.splice(idx + 1, 0, copy);
      return next;
    });
  };
  const move = (id, dir) => {
    setSteps((s) => {
      const idx = s.findIndex((st) => st.id === id);
      const swapWith = idx + dir;
      if (swapWith < 0 || swapWith >= s.length) return s;
      const copy = [...s];
      [copy[idx], copy[swapWith]] = [copy[swapWith], copy[idx]];
      return copy;
    });
  };
  const moveToEdge = (id, toStart) => {
    setSteps((s) => {
      const idx = s.findIndex((st) => st.id === id);
      if (idx === -1) return s;
      const copy = [...s];
      const [item] = copy.splice(idx, 1);
      copy.splice(toStart ? 0 : copy.length, 0, item);
      return copy;
    });
  };

  const [draggingId, setDraggingId] = useState(null);
  const dragIdRef = useRef(null);

  const startDrag = (e, stepId) => {
    if (dragIdRef.current) return; // a drag is already in progress — ignore duplicate start events
    e.preventDefault();
    dragIdRef.current = stepId;
    setDraggingId(stepId);

    const onMove = (ev) => {
      const point = ev.touches && ev.touches[0] ? ev.touches[0] : ev;
      const el = document.elementFromPoint(point.clientX, point.clientY);
      const row = el && el.closest("[data-step-row]");
      if (!row) return;
      const overId = row.getAttribute("data-step-row");
      const draggedId = dragIdRef.current;
      if (!draggedId || overId === draggedId) return;
      setSteps((s) => {
        const fromIdx = s.findIndex((x) => x.id === draggedId);
        const toIdx = s.findIndex((x) => x.id === overId);
        if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return s;
        const copy = [...s];
        const [moved] = copy.splice(fromIdx, 1);
        copy.splice(toIdx, 0, moved);
        return copy;
      });
    };

    const onUp = () => {
      dragIdRef.current = null;
      setDraggingId(null);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };
  const startEdit = (st) => { setEditingId(st.id); setEditingText(st.text); };
  const commitEdit = () => {
    setSteps((s) => s.map((st) => (st.id === editingId ? { ...st, text: editingText.trim() || st.text } : st)));
    setEditingId(null); setEditingText("");
  };
  const toggleExpand = (id) => setExpanded((e) => ({ ...e, [id]: !e[id] }));
  const addSubstep = (stepId) => {
    const text = (newSubstepText[stepId] || "").trim();
    if (!text) return;
    setSteps((s) => s.map((st) => (st.id === stepId ? { ...st, substeps: [...st.substeps, { id: uid(), text }] } : st)));
    setNewSubstepText((n) => ({ ...n, [stepId]: "" }));
  };
  const removeSubstep = (stepId, subId) => {
    setSteps((s) => s.map((st) => (st.id === stepId ? { ...st, substeps: st.substeps.filter((sub) => sub.id !== subId) } : st)));
  };
  const editSubstepText = (stepId, subId, text) => {
    setSteps((s) => s.map((st) => (st.id === stepId ? { ...st, substeps: st.substeps.map((sub) => (sub.id === subId ? { ...sub, text } : sub)) } : st)));
  };

  const canSave = title.trim().length > 0 && steps.length > 0;
  const handleSave = () => {
    if (!canSave) return;
    onSave({ id: workflow.id, title: title.trim(), steps, channelId: channelId || null, contentType });
  };

  return (
    <div className="flex-1 flex flex-col max-w-3xl w-full mx-auto px-6 py-8 sm:py-10 fade-in">
      <div className="flex items-center justify-between mb-8">
        <h2 style={{ color: COLORS.textPrimary }} className="text-2xl sm:text-3xl font-bold">{isNew ? "New Workflow" : "Edit Workflow"}</h2>
        <button onClick={onCancel} aria-label="Cancel" style={{ borderColor: COLORS.border, color: COLORS.textMuted }} className="rounded-full border p-2 hover:opacity-80 transition-opacity"><X size={18} /></button>
      </div>

      <label style={{ color: COLORS.textFaint }} className="font-mono text-[11px] tracking-[0.2em] uppercase mb-2">Title</label>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Workflow title"
        style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, color: COLORS.textPrimary }}
        className="w-full rounded-xl border px-4 py-3 mb-4 text-lg font-semibold outline-none focus:ring-2" />

      <label style={{ color: COLORS.textFaint }} className="font-mono text-[11px] tracking-[0.2em] uppercase mb-2">Channel</label>
      <select value={channelId} onChange={(e) => setChannelId(e.target.value)}
        style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, color: COLORS.textPrimary }}
        className="w-full rounded-xl border px-4 py-3 mb-8 text-sm outline-none focus:ring-2">
        <option value="">No channel</option>
        {(channels || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>

      <label style={{ color: COLORS.textFaint }} className="font-mono text-[11px] tracking-[0.2em] uppercase mb-2">Content type</label>
      <div className="flex gap-2 mb-8">
        <button type="button" onClick={() => setContentType("long")}
          style={{ backgroundColor: contentType === "long" ? COLORS.tealSoft : COLORS.bgElevated, color: contentType === "long" ? COLORS.teal : COLORS.textMuted, borderColor: contentType === "long" ? COLORS.teal : COLORS.border }}
          className="flex-1 rounded-xl border px-4 py-2.5 text-sm font-semibold transition-all">
          Long-form
        </button>
        <button type="button" onClick={() => setContentType("short")}
          style={{ backgroundColor: contentType === "short" ? COLORS.orangeSoft : COLORS.bgElevated, color: contentType === "short" ? COLORS.orange : COLORS.textMuted, borderColor: contentType === "short" ? COLORS.orange : COLORS.border }}
          className="flex-1 rounded-xl border px-4 py-2.5 text-sm font-semibold transition-all">
          Shorts
        </button>
      </div>

      <div className="flex items-center justify-between mb-3">
        <label style={{ color: COLORS.textFaint }} className="font-mono text-[11px] tracking-[0.2em] uppercase">Steps ({steps.length})</label>
        <button onClick={() => setBulkOpen((b) => !b)} style={{ backgroundColor: bulkOpen ? COLORS.tealSoft : "transparent", color: COLORS.teal, borderColor: COLORS.teal }} className="font-mono text-[11px] tracking-wide hover:brightness-110 flex items-center gap-1.5 rounded-lg border px-2.5 py-1 transition-all">
          <ListChecks size={13} />
          {bulkOpen ? "Close paste-in" : "Paste multiple steps"}
        </button>
      </div>

      {bulkOpen && (
        <div style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border }} className="rounded-xl border p-4 mb-4">
          <textarea value={bulkText} onChange={(e) => setBulkText(e.target.value)} rows={5} placeholder={"One step per line, e.g.\nCut Video\nTranscribe\nExport As Text File"}
            style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, color: COLORS.textPrimary }}
            className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 mb-3" />
          <button onClick={addBulk} style={{ backgroundColor: COLORS.tealSoft, color: COLORS.teal }} className="rounded-lg px-4 py-2 text-sm font-semibold hover:brightness-110 transition-all">
            Add {bulkText.split("\n").map((l) => l.trim()).filter(Boolean).length || ""} step{bulkText.trim() ? "s" : ""}
          </button>
        </div>
      )}

      <div className="flex flex-col gap-2 mb-4">
        {steps.length === 0 && <p style={{ color: COLORS.textFaint }} className="text-sm italic py-4 text-center">No steps yet. Add your first step below.</p>}
        {steps.map((st, i) => {
          const t = stepTimes[st.id];
          const isExpanded = !!expanded[st.id];
          const isDragging = draggingId === st.id;
          return (
            <div key={st.id} data-step-row={st.id}
              style={{ backgroundColor: COLORS.bgCard, borderColor: isDragging ? COLORS.teal : COLORS.border, opacity: isDragging ? 0.6 : 1 }}
              className="rounded-xl border overflow-hidden transition-opacity">
              <div className="flex items-center gap-2 px-3 py-2.5">
                <span onPointerDown={(e) => startDrag(e, st.id)}
                  style={{ color: COLORS.textFaint, touchAction: "none", cursor: "grab" }} className="shrink-0">
                  <GripVertical size={16} />
                </span>
                <span style={{ color: COLORS.textFaint }} className="font-mono text-xs w-6 shrink-0">{String(i + 1).padStart(2, "0")}</span>
                {editingId === st.id ? (
                  <input autoFocus value={editingText} onChange={(e) => setEditingText(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && commitEdit()} onBlur={commitEdit}
                    style={{ backgroundColor: COLORS.bgElevated, color: COLORS.textPrimary }}
                    className="flex-1 rounded-lg px-3 py-1.5 text-sm outline-none" />
                ) : (
                  <button onClick={() => startEdit(st)} style={{ color: COLORS.textPrimary }} className="flex-1 text-left text-sm py-1.5 truncate" title="Click to edit">{st.text}</button>
                )}
                {t != null && <span style={{ color: COLORS.orange }} className="font-mono text-[11px] shrink-0">{formatTime(t)}</span>}
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => toggleExpand(st.id)} aria-label="Substeps" style={{ color: st.substeps.length ? COLORS.violet : COLORS.textMuted }} className="p-1.5 hover:opacity-70 flex items-center gap-0.5">
                    <ListChecks size={15} />
                    {st.substeps.length > 0 && <span className="font-mono text-[10px]">{st.substeps.length}</span>}
                    {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                  </button>
                  <button onClick={() => moveToEdge(st.id, true)} disabled={i === 0} aria-label="Move to top" title="Move to top" style={{ color: COLORS.textMuted, opacity: i === 0 ? 0.3 : 1 }} className="p-1.5 hover:opacity-70 disabled:cursor-not-allowed font-mono text-[10px] font-bold">⤒</button>
                  <button onClick={() => move(st.id, -1)} disabled={i === 0} aria-label="Move up" style={{ color: COLORS.textMuted, opacity: i === 0 ? 0.3 : 1 }} className="p-1.5 hover:opacity-70 disabled:cursor-not-allowed"><ChevronUp size={16} /></button>
                  <button onClick={() => move(st.id, 1)} disabled={i === steps.length - 1} aria-label="Move down" style={{ color: COLORS.textMuted, opacity: i === steps.length - 1 ? 0.3 : 1 }} className="p-1.5 hover:opacity-70 disabled:cursor-not-allowed"><ChevronDown size={16} /></button>
                  <button onClick={() => moveToEdge(st.id, false)} disabled={i === steps.length - 1} aria-label="Move to bottom" title="Move to bottom" style={{ color: COLORS.textMuted, opacity: i === steps.length - 1 ? 0.3 : 1 }} className="p-1.5 hover:opacity-70 disabled:cursor-not-allowed font-mono text-[10px] font-bold">⤓</button>
                  <button onClick={() => duplicateStep(st.id)} aria-label="Duplicate step" style={{ color: COLORS.textMuted }} className="p-1.5 hover:opacity-70"><Copy size={16} /></button>
                  <button onClick={() => removeStep(st.id)} aria-label="Delete step" style={{ color: COLORS.danger }} className="p-1.5 hover:opacity-70"><Trash2 size={16} /></button>
                </div>
              </div>

              {isExpanded && (
                <div style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border }} className="border-t px-4 py-3 pl-11">
                  <p style={{ color: COLORS.textFaint }} className="font-mono text-[10px] tracking-[0.15em] uppercase mb-2">Sub-steps for this step</p>
                  <div className="flex flex-col gap-1.5 mb-2">
                    {st.substeps.map((sub) => (
                      <div key={sub.id} className="flex items-center gap-2">
                        <span style={{ color: COLORS.violet }} className="text-xs">•</span>
                        <input value={sub.text} onChange={(e) => editSubstepText(st.id, sub.id, e.target.value)}
                          style={{ backgroundColor: COLORS.bgCard, color: COLORS.textPrimary, borderColor: COLORS.border }}
                          className="flex-1 rounded-lg border px-2.5 py-1.5 text-xs outline-none focus:ring-2" />
                        <button onClick={() => removeSubstep(st.id, sub.id)} aria-label="Remove sub-step" style={{ color: COLORS.danger }} className="p-1 hover:opacity-70"><X size={14} /></button>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <input value={newSubstepText[st.id] || ""} onChange={(e) => setNewSubstepText((n) => ({ ...n, [st.id]: e.target.value }))}
                      onKeyDown={(e) => e.key === "Enter" && addSubstep(st.id)}
                      placeholder="Add a sub-step…"
                      style={{ backgroundColor: COLORS.bgCard, color: COLORS.textPrimary, borderColor: COLORS.border }}
                      className="flex-1 rounded-lg border px-2.5 py-1.5 text-xs outline-none focus:ring-2" />
                    <button onClick={() => addSubstep(st.id)} style={{ backgroundColor: COLORS.violetSoft, color: COLORS.violet }} className="rounded-lg px-3 py-1.5 text-xs font-semibold hover:brightness-110 transition-all">Add</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex gap-2 mb-10">
        <input value={newStep} onChange={(e) => setNewStep(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addStep()}
          placeholder="Add a new step…" style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, color: COLORS.textPrimary }}
          className="flex-1 rounded-xl border px-4 py-3 text-sm outline-none focus:ring-2" />
        <button onClick={addStep} style={{ backgroundColor: COLORS.tealSoft, color: COLORS.teal }} className="flex items-center gap-1.5 rounded-xl px-4 py-3 text-sm font-semibold hover:brightness-110 transition-all">
          <Plus size={16} /> Add
        </button>
      </div>

      <div className="mt-auto flex gap-3 sticky bottom-0 pt-4">
        <button onClick={onCancel} style={{ borderColor: COLORS.border, color: COLORS.textMuted, backgroundColor: COLORS.bg }} className="flex-1 rounded-2xl border py-4 text-base font-semibold hover:opacity-80 transition-opacity">Cancel</button>
        <button onClick={handleSave} disabled={!canSave} style={{ backgroundColor: COLORS.teal, color: "#04211D", opacity: canSave ? 1 : 0.4 }}
          className="flex-[1.4] flex items-center justify-center gap-2 rounded-2xl py-4 text-base font-bold transition-all duration-200 active:scale-[0.98] disabled:cursor-not-allowed">
          <Check size={18} /> Save Workflow
        </button>
      </div>
    </div>
  );
}

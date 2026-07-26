import React, { useState, useMemo } from "react";
import { COLORS } from "../lib/core";
import { HomeIcon } from "./Icon";
import { getKeys, generatePackage, buildPrompt, cleanTranscript } from "../lib/ai";

function Label({ children }) {
  return (
    <p style={{ color: COLORS.textFaint }} className="font-mono text-[10px] tracking-[0.15em] uppercase mb-1.5">
      {children}
    </p>
  );
}

function CopyBlock({ label, value, multiline }) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch (e) { /* clipboard unavailable */ }
  };
  return (
    <div className="mb-3">
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        <button onClick={copy} style={{ color: COLORS.teal }} className="font-mono text-[10px] hover:opacity-80 mb-1.5">
          {copied ? "Copied ✓" : "Copy"}
        </button>
      </div>
      <div style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, color: COLORS.textPrimary }}
        className={`rounded-lg border px-3 py-2.5 text-sm ${multiline ? "whitespace-pre-wrap leading-relaxed" : ""}`}>
        {value}
      </div>
    </div>
  );
}

export default function StudioScreen({ tasks, channels, workflows, onBack }) {
  const [taskId, setTaskId] = useState("");
  const [transcript, setTranscript] = useState("");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [refine, setRefine] = useState("");
  const [history, setHistory] = useState([]);

  const keys = getKeys();
  const missingKey = !keys.anthropic;

  // Everything the model needs about the assignment comes from the task itself.
  const taskContext = useMemo(() => {
    const t = (tasks || []).find((x) => x.id === taskId);
    if (!t) return null;
    const ch = (channels || []).find((c) => c.id === t.channelId);
    const wf = (workflows || []).find((w) => w.channelId === t.channelId);
    return {
      title: t.title,
      description: t.description,
      channelName: ch ? ch.name : null,
      contentFormat: wf ? wf.contentType : null,
      event: t.event || null,
    };
  }, [taskId, tasks, channels, workflows]);

  const loadFile = async (file) => {
    if (!file) return;
    const text = await file.text();
    setTranscript(cleanTranscript(text));
  };

  const run = async (message, prior) => {
    setBusy(true); setError("");
    try {
      const next = [...prior, { role: "user", content: message }];
      const out = await generatePackage({ history: next, apiKey: keys.anthropic, model: keys.model });
      setResult(out);
      setHistory([...next, { role: "assistant", content: out.raw || "" }]);
    } catch (e) {
      setError(e.message || "Something went wrong.");
    }
    setBusy(false);
  };

  const generate = () => {
    if (!transcript.trim()) return;
    setHistory([]);
    run(buildPrompt(transcript, taskContext), []);
  };

  const sendRefinement = () => {
    if (!refine.trim() || !history.length) return;
    const msg = refine.trim();
    setRefine("");
    run(msg, history);
  };

  const field = { backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, color: COLORS.textPrimary };
  const fieldCls = "w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2";

  const nameplateText = result && result.nameplates && result.nameplates.length
    ? result.nameplates.map((n) => `${n.name}${n.title ? ` — ${n.title}` : ""}`).join("\n")
    : "";

  return (
    <div className="flex-1 flex flex-col max-w-6xl w-full mx-auto px-6 py-8 sm:py-10 overflow-y-auto fade-in">
      <div className="flex items-center justify-between mb-2">
        <h2 style={{ color: COLORS.textPrimary }} className="text-2xl sm:text-3xl font-bold">Clip studio</h2>
        <button onClick={onBack} aria-label="Home" style={{ borderColor: COLORS.border, color: COLORS.textMuted }}
          className="rounded-full border p-2 hover:opacity-80 transition-opacity"><HomeIcon size={18} /></button>
      </div>
      <p style={{ color: COLORS.textFaint }} className="text-sm mb-6">
        Link the task, drop in the transcript. Speakers and clip type are read from the transcript itself.
      </p>

      {missingKey && (
        <div style={{ backgroundColor: COLORS.orangeSoft, borderColor: COLORS.orange }} className="rounded-xl border px-4 py-3 mb-5">
          <p style={{ color: COLORS.orange }} className="text-sm">Add your Anthropic API key in Profile before using this.</p>
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-6">
        {/* ---------- input ---------- */}
        <div style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border }} className="rounded-2xl border p-5 h-fit">
          <Label>Task</Label>
          <select value={taskId} onChange={(e) => setTaskId(e.target.value)} style={field} className={`${fieldCls} mb-1.5`}>
            <option value="">Not linked to a task</option>
            {(tasks || []).map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
          </select>
          {taskContext && (
            <p style={{ color: COLORS.textFaint }} className="text-[11px] mb-4">
              {[
                taskContext.channelName,
                taskContext.contentFormat === "short" ? "Short" : taskContext.contentFormat ? "Long-form" : null,
                taskContext.event
                  ? (taskContext.event.sourceType === "floor"
                      ? `${taskContext.event.chamber || ""} floor`.trim()
                      : (taskContext.event.subcommittee || taskContext.event.committee))
                  : null,
                taskContext.event && taskContext.event.date ? taskContext.event.date : null,
              ].filter(Boolean).join(" · ")}
            </p>
          )}
          {!taskContext && <div className="mb-4" />}

          <div className="flex items-center justify-between">
            <Label>Transcript</Label>
            <label style={{ color: COLORS.teal }} className="font-mono text-[10px] hover:opacity-80 cursor-pointer mb-1.5">
              Upload file
              <input type="file" accept=".txt,.srt,.vtt,text/plain" className="hidden"
                onChange={(e) => loadFile(e.target.files && e.target.files[0])} />
            </label>
          </div>
          <textarea value={transcript} onChange={(e) => setTranscript(e.target.value)} rows={16}
            placeholder={"Paste the transcript, or upload a .txt / .srt / .vtt file.\n\nSEN. DOE: The question before this committee is…\nWITNESS: I'd answer that by saying…"}
            style={field} className={`${fieldCls} leading-relaxed`} />

          <button onClick={generate} disabled={busy || !transcript.trim() || missingKey}
            style={{ backgroundColor: COLORS.teal, color: "#04211D", opacity: (busy || !transcript.trim() || missingKey) ? 0.4 : 1 }}
            className="w-full rounded-xl py-3 text-sm font-bold hover:brightness-105 transition-all disabled:cursor-not-allowed mt-4">
            {busy ? "Researching and writing…" : "Generate package"}
          </button>
        </div>

        {/* ---------- output ---------- */}
        <div className="flex flex-col gap-4">
          {error && (
            <div style={{ backgroundColor: "rgba(225,90,90,0.12)", borderColor: COLORS.danger }} className="rounded-xl border px-4 py-3">
              <p style={{ color: COLORS.danger }} className="text-sm">{error}</p>
            </div>
          )}

          {!result && !busy && !error && (
            <div style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border }} className="rounded-2xl border p-8 text-center">
              <p style={{ color: COLORS.textMuted }} className="text-sm">The package appears here.</p>
              <p style={{ color: COLORS.textFaint }} className="text-xs mt-1.5 leading-relaxed">
                Title, description, tags, thumbnail direction, lower thirds and source.
              </p>
            </div>
          )}

          {busy && (
            <div style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border }} className="rounded-2xl border p-8 text-center">
              <p style={{ color: COLORS.textMuted }} className="text-sm">Reading the transcript and checking names…</p>
            </div>
          )}

          {result && !busy && (
            <div style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border }} className="rounded-2xl border p-5">
              <div style={{ backgroundColor: COLORS.orangeSoft }} className="rounded-lg px-3 py-2 mb-4">
                <p style={{ color: COLORS.orange }} className="text-[11px] leading-relaxed">
                  Check every name, title and figure against the footage before publishing.
                </p>
              </div>

              {result.caution ? (
                <div style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.orange }} className="rounded-lg border px-3 py-2 mb-4">
                  <p style={{ color: COLORS.textMuted }} className="text-xs leading-relaxed">{result.caution}</p>
                </div>
              ) : null}

              {result.clipType && (
                <div className="flex items-center gap-2 mb-4 flex-wrap">
                  <span style={{ backgroundColor: COLORS.tealSoft, color: COLORS.teal }} className="font-mono text-[10px] rounded-full px-2.5 py-1">
                    {result.clipType}
                  </span>
                  {result.searchCount > 0 && (
                    <span style={{ color: COLORS.textFaint }} className="font-mono text-[10px]">
                      {result.searchCount} search{result.searchCount === 1 ? "" : "es"} run
                    </span>
                  )}
                </div>
              )}

              <CopyBlock label="Title" value={result.title} />
              {(result.titleAlternatives || []).map((t, i) => (
                <CopyBlock key={i} label={`Alternative ${i + 1}`} value={t} />
              ))}
              <CopyBlock label="Description" value={result.description} multiline />
              <CopyBlock label="Tags" value={(result.tags || []).join(", ")} multiline />

              <div style={{ borderColor: COLORS.border }} className="border-t my-4 pt-4">
                <p style={{ color: COLORS.textFaint }} className="font-mono text-[11px] tracking-[0.2em] uppercase mb-3">Thumbnail</p>
                <CopyBlock label="Text on thumbnail" value={result.thumbnailText} />
                <CopyBlock label="Who to feature" value={(result.thumbnailPeople || []).join(", ")} />
                <CopyBlock label="Visual direction" value={result.thumbnailVisual} multiline />
              </div>

              <div style={{ borderColor: COLORS.border }} className="border-t my-4 pt-4">
                <p style={{ color: COLORS.textFaint }} className="font-mono text-[11px] tracking-[0.2em] uppercase mb-3">Lower thirds</p>
                <CopyBlock label="Headline" value={result.lowerThirdHeadline} />
                <CopyBlock label="Name plates" value={nameplateText} multiline />
              </div>

              <div style={{ borderColor: COLORS.border }} className="border-t my-4 pt-4">
                <CopyBlock label="Date" value={result.eventDate} />
                <CopyBlock label="Source" value={result.source} multiline />
              </div>

              {result.parseFailed && (
                <p style={{ color: COLORS.textFaint }} className="text-[11px] leading-relaxed">
                  The response didn't come back in the expected shape — raw text shown above.
                </p>
              )}
            </div>
          )}

          {result && (
            <div className="flex gap-2">
              <input value={refine} onChange={(e) => setRefine(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendRefinement()}
                placeholder="Ask for changes — punchier title, different thumbnail angle…"
                style={field} className={`${fieldCls} flex-1`} />
              <button onClick={sendRefinement} disabled={busy || !refine.trim()}
                style={{ backgroundColor: COLORS.teal, color: "#04211D", opacity: (busy || !refine.trim()) ? 0.4 : 1 }}
                className="rounded-xl px-4 py-2 text-sm font-bold shrink-0">
                Send
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

import React, { useState, useMemo } from "react";
import { COLORS } from "../lib/core";
import { HomeIcon } from "./Icon";
import { getKeys, setKeys, generatePackage, buildPrompt, cleanTranscript, estimateSeconds, hasTimecodes } from "../lib/ai";

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
        <button onClick={copy}
          style={{ color: copied ? COLORS.teal : COLORS.textFaint }}
          className="cs-copy font-mono text-[10px] mb-1.5 hover:opacity-100 hover:text-inherit"
          onMouseEnter={(e) => { if (!copied) e.currentTarget.style.color = COLORS.teal; }}
          onMouseLeave={(e) => { if (!copied) e.currentTarget.style.color = COLORS.textFaint; }}>
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

export default function StudioScreen({ tasks, channels, workflows, aiConfig, onBack }) {
  const [taskId, setTaskId] = useState("");
  const [transcript, setTranscript] = useState("");
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [refine, setRefine] = useState("");
  const [history, setHistory] = useState([]);

  // Prefer the team-wide config; fall back to anything set locally on this machine.
  const local = getKeys();
  const keys = {
    anthropic: (aiConfig && aiConfig.anthropicKey) || local.anthropic,
    model: (aiConfig && aiConfig.model) || local.model,
    adOptions: (aiConfig && aiConfig.adOptions) || local.adOptions,
  };
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
      adOptions: keys.adOptions,
    };
  }, [taskId, tasks, channels, workflows]);

  const loadFile = async (file) => {
    if (!file) return;
    const text = await file.text();
    setTranscript(cleanTranscript(text));
    setFileName(file.name);
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
    run(buildPrompt(transcript, { ...(taskContext || {}), adOptions: keys.adOptions }), []);
  };

  const sendRefinement = () => {
    if (!refine.trim() || !history.length) return;
    const msg = refine.trim();
    setRefine("");
    run(msg, history);
  };

  const field = { backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, color: COLORS.textPrimary };
  const fieldCls = "cs-field w-full rounded-lg border px-3 py-2 text-sm";

  const nameplateText = result && result.nameplates && result.nameplates.length
    ? result.nameplates.map((n) => `${n.name}${n.title ? ` — ${n.title}` : ""}`).join("\n")
    : "";

  return (
    <div className="flex-1 flex flex-col max-w-6xl w-full mx-auto px-6 py-8 sm:py-10 overflow-y-auto fade-in">
      <style>{`
        @keyframes cs-rise { from { opacity: 0; transform: translateY(10px) } to { opacity: 1; transform: none } }
        @keyframes cs-pulse { 0%,100% { opacity: .35 } 50% { opacity: 1 } }
        @keyframes cs-sweep { 0% { transform: translateX(-100%) } 100% { transform: translateX(300%) } }
        .cs-rise { animation: cs-rise .45s cubic-bezier(.2,.8,.2,1) both; }
        .cs-pulse { animation: cs-pulse 1.4s ease-in-out infinite; }
        .cs-sweep { animation: cs-sweep 1.6s ease-in-out infinite; }
        .cs-field { transition: border-color .18s ease, box-shadow .18s ease; }
        .cs-field:focus { outline: none; border-color: ${COLORS.teal}; box-shadow: 0 0 0 2px ${COLORS.teal}33; }
        .cs-copy { transition: color .15s ease, opacity .15s ease; }
        @media (prefers-reduced-motion: reduce) {
          .cs-rise, .cs-pulse, .cs-sweep { animation: none !important; }
        }
      `}</style>
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
          <p style={{ color: COLORS.orange }} className="text-sm">No API key set — ask your admin to add one in Profile.</p>
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

          <Label>Transcript</Label>
          <label
            style={{
              backgroundColor: COLORS.bgElevated,
              borderColor: transcript ? COLORS.teal : COLORS.border,
            }}
            className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed py-10 px-4 cursor-pointer transition-all hover:brightness-110 text-center">
            <input type="file" accept=".txt,.srt,.vtt,text/plain" className="hidden"
              onChange={(e) => loadFile(e.target.files && e.target.files[0])} />
            {transcript ? (
              <>
                <p style={{ color: COLORS.teal }} className="text-sm font-semibold">{fileName || "Transcript loaded"}</p>
                <p style={{ color: COLORS.textFaint }} className="font-mono text-[11px] mt-1">
                  {transcript.trim().split(/\s+/).length.toLocaleString()} words
                  {hasTimecodes(transcript) ? " · timecodes found" : ""}
                </p>
                <p style={{ color: COLORS.textFaint }} className="text-[10px] mt-2">Click to replace</p>
              </>
            ) : (
              <>
                <p style={{ color: COLORS.textMuted }} className="text-sm font-semibold">Upload transcript</p>
                <p style={{ color: COLORS.textFaint }} className="text-[11px] mt-1">.txt, .srt or .vtt</p>
              </>
            )}
          </label>

          <button onClick={generate} disabled={busy || !transcript.trim() || missingKey}
            style={{ backgroundColor: COLORS.teal, color: "#04211D", opacity: (busy || !transcript.trim() || missingKey) ? 0.4 : 1 }}
            className="w-full rounded-xl py-3.5 text-sm font-bold transition-all hover:brightness-110 active:scale-[0.99] disabled:cursor-not-allowed mt-4">
            {busy ? "Researching and writing…" : "Generate package"}
          </button>
        </div>

        {/* ---------- output ---------- */}
        <div className="flex flex-col gap-4 lg:sticky lg:top-6 lg:self-start lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto">
          {error && (
            <div style={{ backgroundColor: "rgba(225,90,90,0.12)", borderColor: COLORS.danger }} className="rounded-xl border px-4 py-3">
              <p style={{ color: COLORS.danger }} className="text-sm">{error}</p>
            </div>
          )}

          {!result && !busy && !error && (
            <div style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border }}
              className="rounded-2xl border p-10 text-center cs-rise">
              <div className="flex justify-center gap-1.5 mb-5" aria-hidden="true">
                {[0, 1, 2].map((i) => (
                  <span key={i} style={{
                    width: i === 1 ? 34 : 20, height: 4, borderRadius: 9999,
                    backgroundColor: i === 1 ? COLORS.teal : COLORS.border,
                  }} />
                ))}
              </div>
              <p style={{ color: COLORS.textMuted }} className="text-sm font-semibold">The package appears here</p>
              <p style={{ color: COLORS.textFaint }} className="text-xs mt-2 leading-relaxed max-w-xs mx-auto">
                Title, description, tags, thumbnail direction, lower thirds, ad suitability and shorts.
              </p>
            </div>
          )}

          {busy && (
            <div style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border }} className="rounded-2xl border p-6 cs-rise">
              <div className="relative h-1 rounded-full overflow-hidden mb-5" style={{ backgroundColor: COLORS.border }}>
                <div className="cs-sweep absolute inset-y-0 w-1/3 rounded-full" style={{ backgroundColor: COLORS.teal }} />
              </div>
              <p style={{ color: COLORS.textPrimary }} className="text-sm font-semibold mb-3">Working through the clip</p>
              <div className="flex flex-col gap-2">
                {["Reading the transcript", "Checking names and titles", "Finding shorts", "Writing the package"].map((step, i) => (
                  <div key={step} className="flex items-center gap-2.5">
                    <span className="cs-pulse inline-block shrink-0"
                      style={{ width: 5, height: 5, borderRadius: 9999, backgroundColor: COLORS.teal, animationDelay: `${i * 0.18}s` }} />
                    <span style={{ color: COLORS.textFaint }} className="text-xs">{step}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {result && !busy && (
            <div style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border }} className="rounded-2xl border p-5 cs-rise">
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
                <CopyBlock label="Source"
                  value={(taskContext && taskContext.event && taskContext.event.source) || ""} multiline />
              </div>

              {result.adSuitability && (result.adSuitability.selections || []).length > 0 && (
                <div style={{ borderColor: COLORS.border }} className="border-t my-4 pt-4">
                  <p style={{ color: COLORS.textFaint }} className="font-mono text-[11px] tracking-[0.2em] uppercase mb-3">
                    Ad suitability — what to tick
                  </p>
                  {result.adSuitability.overall && (
                    <p style={{ color: COLORS.textMuted }} className="text-xs mb-3 leading-relaxed">
                      {result.adSuitability.overall}
                    </p>
                  )}
                  <div className="flex flex-col gap-1.5">
                    {result.adSuitability.selections.map((sel, i) => {
                      const clear = /^none$/i.test((sel.answer || "").trim());
                      return (
                        <div key={i}
                          style={{
                            backgroundColor: clear ? "transparent" : COLORS.bgElevated,
                            borderColor: clear ? COLORS.border : COLORS.orange,
                          }}
                          className="rounded-lg border px-3 py-2">
                          <div className="flex items-center gap-2">
                            <p style={{ color: clear ? COLORS.textFaint : COLORS.textPrimary }}
                              className="text-[11px] flex-1 leading-relaxed">{sel.question}</p>
                            <span
                              style={{
                                backgroundColor: clear ? "transparent" : COLORS.orangeSoft,
                                color: clear ? COLORS.textFaint : COLORS.orange,
                              }}
                              className="font-mono text-[10px] rounded-full px-2 py-0.5 shrink-0">
                              {sel.answer}
                            </span>
                          </div>
                          {!clear && sel.reason && (
                            <p style={{ color: COLORS.textFaint }} className="text-[10px] mt-1 leading-relaxed">{sel.reason}</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {(result.adSuitability.unjudgeable || []).length > 0 && (
                    <p style={{ color: COLORS.orange }} className="text-[11px] mt-3 leading-relaxed">
                      Judge these yourself from the footage: {result.adSuitability.unjudgeable.join("; ")}
                    </p>
                  )}
                </div>
              )}

              {result.shorts && result.shorts.length > 0 && (
                <div style={{ borderColor: COLORS.border }} className="border-t my-4 pt-4">
                  <p style={{ color: COLORS.textFaint }} className="font-mono text-[11px] tracking-[0.2em] uppercase mb-1">
                    Shorts found ({result.shorts.length})
                  </p>
                  <p style={{ color: COLORS.textFaint }} className="text-[10px] mb-3 leading-relaxed">
                    Search the opening words in your timeline to find the in-point, the closing words for the out-point.
                  </p>
                  <div className="flex flex-col gap-3">
                    {result.shorts.map((sh, i) => (
                      <ShortCard key={i} short={sh} index={i} />
                    ))}
                  </div>
                </div>
              )}

              {result.shorts && result.shorts.length === 0 && (
                <div style={{ borderColor: COLORS.border }} className="border-t my-4 pt-4">
                  <p style={{ color: COLORS.textFaint }} className="text-xs">
                    No segment in this clip stands alone as a short.
                  </p>
                </div>
              )}

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

function ShortCard({ short, index }) {
  const [open, setOpen] = useState(index === 0);
  const secs = estimateSeconds(short.transcript);
  const tooLong = secs > 60;

  return (
    <div style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border }} className="rounded-xl border p-3">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-2 text-left">
        <span style={{ backgroundColor: COLORS.violetSoft, color: COLORS.violet }}
          className="font-mono text-[10px] rounded-full px-2 py-0.5 shrink-0">
          {index + 1}
        </span>
        <span style={{ color: COLORS.textPrimary }} className="text-xs flex-1 truncate">{short.title}</span>
        <span style={{ color: tooLong ? COLORS.orange : COLORS.textFaint }} className="font-mono text-[10px] shrink-0">
          ~{secs}s
        </span>
        <span style={{ color: COLORS.teal }} className="font-mono text-[10px] shrink-0">{open ? "Hide" : "Open"}</span>
      </button>

      {open && (
        <div className="mt-3">
          {short.timecode ? (
            <p style={{ color: COLORS.teal }} className="font-mono text-[11px] mb-2">{short.timecode}</p>
          ) : null}
          {short.why && (
            <p style={{ color: COLORS.textFaint }} className="text-[11px] mb-3 leading-relaxed">{short.why}</p>
          )}
          {tooLong && (
            <p style={{ color: COLORS.orange }} className="text-[11px] mb-3 leading-relaxed">
              Runs long for a short — you may need to trim it.
            </p>
          )}
          <CopyBlock label="In-point — search this" value={short.startsWith} />
          <CopyBlock label="Out-point — search this" value={short.endsWith} />
          <CopyBlock label="Full segment" value={short.transcript} multiline />
          <CopyBlock label="Title" value={short.title} />
          <CopyBlock label="Description" value={short.description} multiline />
          <CopyBlock label="Tags" value={(short.tags || []).join(", ")} multiline />
        </div>
      )}
    </div>
  );
}

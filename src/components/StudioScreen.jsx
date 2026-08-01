import React, { useState, useMemo } from "react";
import { COLORS } from "../lib/core";
import { HomeIcon } from "./Icon";
import { getKeys, setKeys, generatePackage, buildPrompt, cleanTranscript, hasTimecodes } from "../lib/ai";

// "00:14:22 - 00:14:51" -> 29. Returns null if the range can't be parsed.
function parseTimecodeSeconds(range) {
  if (!range) return null;
  const parts = range.split(/-|–/).map((p) => p.trim());
  if (parts.length !== 2) return null;
  const toSecs = (t) => {
    const m = t.match(/^(\d{2}):(\d{2}):(\d{2})$/);
    if (!m) return null;
    return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]);
  };
  const a = toSecs(parts[0]), b = toSecs(parts[1]);
  if (a == null || b == null || b <= a) return null;
  return b - a;
}

function taskCode(id) {
  return id ? id.slice(-6).toUpperCase() : "";
}

function formatWhen(iso) {
  try {
    return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  } catch (e) { return ""; }
}

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
          className="cs-copy font-mono text-[10px] mb-1.5"
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

// Each output section gets its own card with a colored accent, so an editor
// can tell titles from thumbnail direction from ad suitability at a glance
// instead of scanning one long undifferentiated block.
function Section({ accent, title, children, delay = 0 }) {
  return (
    <div
      style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border, borderLeftColor: accent, borderLeftWidth: 3, animationDelay: `${delay}ms` }}
      className="rounded-2xl border p-5 cs-rise">
      <p style={{ color: accent }} className="font-mono text-[11px] tracking-[0.2em] uppercase mb-3 font-bold">{title}</p>
      {children}
    </div>
  );
}

function NameplateRow({ np }) {
  return (
    <div className="grid grid-cols-2 gap-2 mb-2">
      <CopyBlock label="Name" value={np.name} />
      <CopyBlock label="Designation" value={np.title} />
    </div>
  );
}

// Same ordering logic as the workflow tracker's task picker, adapted for
// Studio showing done tasks too — those sort last since they're rarely what
// you're looking for when generating a package right now.
function sortTasksForPicker(list) {
  const rank = { in_progress: 0, pending: 1, done: 2 };
  return [...list].sort((a, b) => {
    const aR = rank[a.status] ?? 1, bR = rank[b.status] ?? 1;
    if (aR !== bR) return aR - bR;
    if (a.dueDate && b.dueDate) return a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0;
    if (a.dueDate) return -1;
    if (b.dueDate) return 1;
    return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
  });
}

export default function StudioScreen({ tasks, channels, workflows, aiConfig, clipPackages, onSavePackage, onBack }) {
  const [taskId, setTaskId] = useState("");
  const [transcript, setTranscript] = useState("");
  const [fileName, setFileName] = useState("");
  // The live generation for this session — what "current" means.
  const [liveResult, setLiveResult] = useState(null);
  const [liveHistory, setLiveHistory] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [refine, setRefine] = useState("");
  // A past package pulled up for reference. Separate from liveResult so
  // looking at history never loses or overwrites what you just generated.
  const [viewedPkg, setViewedPkg] = useState(null);

  const result = viewedPkg || liveResult;
  const viewingHistory = !!viewedPkg;

  const local = getKeys();
  const keys = {
    anthropic: (aiConfig && aiConfig.anthropicKey) || local.anthropic,
    model: (aiConfig && aiConfig.model) || local.model,
    adOptions: (aiConfig && aiConfig.adOptions) || local.adOptions,
  };
  const missingKey = !keys.anthropic;

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
      monetised: !!(ch && ch.monetised),
      country: (ch && ch.country) || null,
      event: t.event || null,
    };
  }, [taskId, tasks, channels, workflows]);

  const taskPackages = useMemo(
    () => (clipPackages || []).filter((p) => p.taskId === taskId),
    [clipPackages, taskId]
  );
  const yieldStats = useMemo(() => ({
    count: taskPackages.length,
    shorts: taskPackages.reduce((s, p) => s + ((p.shorts || []).length), 0),
  }), [taskPackages]);

  const loadFile = async (file) => {
    if (!file) return;
    const text = await file.text();
    setTranscript(cleanTranscript(text));
    setFileName(file.name);
  };

  const run = async (message, prior) => {
    setBusy(true); setError(""); setViewedPkg(null); // a new generation is always "current"
    try {
      const next = [...prior, { role: "user", content: message }];
      const out = await generatePackage({ history: next, apiKey: keys.anthropic, model: keys.model });
      setLiveResult(out);
      setLiveHistory([...next, { role: "assistant", content: out.raw || "" }]);
      if (onSavePackage && !out.parseFailed) onSavePackage(taskId || null, out);
    } catch (e) {
      setError(e.message || "Something went wrong.");
    }
    setBusy(false);
  };

  const generate = () => {
    if (!transcript.trim()) return;
    setLiveHistory([]);
    run(buildPrompt(transcript, { ...(taskContext || {}), adOptions: keys.adOptions }), []);
  };

  const sendRefinement = () => {
    if (!refine.trim() || !liveHistory.length) return;
    const msg = refine.trim();
    setRefine("");
    run(msg, liveHistory);
  };

  // Preview a past package without touching the live one — "Back to current" undoes this.
  const loadHistoryItem = (pkg) => { setViewedPkg(pkg); setError(""); };
  const backToCurrent = () => setViewedPkg(null);

  const field = { backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, color: COLORS.textPrimary };
  const fieldCls = "cs-field w-full rounded-lg border px-3 py-2 text-sm";

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
        @media (prefers-reduced-motion: reduce) { .cs-rise, .cs-pulse, .cs-sweep { animation: none !important; } }
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
        <div className="flex flex-col gap-4">
          <div style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border }} className="rounded-2xl border p-5">
            <Label>Task</Label>
            <select value={taskId} onChange={(e) => setTaskId(e.target.value)} style={field} className={`${fieldCls} mb-1.5`}>
              <option value="">Not linked to a task</option>
              {(tasks || []).length > 0
                ? sortTasksForPicker(tasks).map((t) => (
                    <option key={t.id} value={t.id}>{t.title}{t.status === "done" ? " (done)" : ""}</option>
                  ))
                : null}
            </select>
            {taskContext ? (
              <div className="flex items-center justify-between flex-wrap gap-1.5">
                <p style={{ color: COLORS.textFaint }} className="text-[11px]">
                  {[
                    taskContext.channelName,
                    taskContext.country,
                    taskContext.contentFormat === "short" ? "Short" : taskContext.contentFormat ? "Long-form" : null,
                    taskContext.event && taskContext.event.committee
                      ? (taskContext.event.subcommittee || taskContext.event.committee)
                      : (taskContext.event && taskContext.event.chamber ? `${taskContext.event.chamber} floor` : null),
                    taskContext.event && taskContext.event.date ? taskContext.event.date : null,
                    taskContext.monetised ? "Monetised" : null,
                  ].filter(Boolean).join(" · ")}
                </p>
                <span style={{ color: COLORS.textFaint }} className="font-mono text-[10px]">#{taskCode(taskId)}</span>
              </div>
            ) : <div className="mb-1.5" />}
            {taskId && (yieldStats.count > 0) && (
              <p style={{ color: COLORS.teal }} className="font-mono text-[11px] mt-2">
                {yieldStats.count} package{yieldStats.count === 1 ? "" : "s"} generated so far · {yieldStats.shorts} short{yieldStats.shorts === 1 ? "" : "s"} found total
              </p>
            )}
          </div>

          <div style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border }} className="rounded-2xl border p-5">
            <Label>Transcript</Label>
            <label
              style={{ backgroundColor: COLORS.bgElevated, borderColor: transcript ? COLORS.teal : COLORS.border }}
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
              {busy ? "Working…" : "Generate package"}
            </button>
          </div>

          {taskId && taskPackages.length > 0 && (
            <div style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border }} className="rounded-2xl border p-5">
              <p style={{ color: COLORS.textFaint }} className="font-mono text-[11px] tracking-[0.2em] uppercase mb-3">
                History for this task
              </p>
              <div className="flex flex-col gap-1.5 max-h-64 overflow-y-auto">
                {taskPackages.map((pkg) => (
                  <button key={pkg.id} onClick={() => loadHistoryItem(pkg)}
                    style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border }}
                    className="rounded-lg border px-3 py-2 text-left hover:brightness-110 transition-all">
                    <p style={{ color: COLORS.textPrimary }} className="text-xs truncate">
                      {pkg.titleDescriptive || pkg.titleQuote || "Untitled package"}
                    </p>
                    <p style={{ color: COLORS.textFaint }} className="font-mono text-[10px] mt-0.5">
                      {formatWhen(pkg.createdAt)} · {(pkg.shorts || []).length} short{(pkg.shorts || []).length === 1 ? "" : "s"}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          )}
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
            <>
              {viewingHistory && (
                <div style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border }}
                  className="rounded-xl border px-3 py-2 flex items-center justify-between gap-3 flex-wrap">
                  <p style={{ color: COLORS.textFaint }} className="text-[11px]">
                    Viewing a past package{liveResult ? " — this isn't your current one." : "."}
                  </p>
                  {liveResult ? (
                    <button onClick={backToCurrent} style={{ color: COLORS.teal }} className="font-mono text-[11px] font-semibold hover:opacity-80 shrink-0">
                      Back to current
                    </button>
                  ) : (
                    <span style={{ color: COLORS.textFaint }} className="text-[11px] shrink-0">Generate a new one to make changes.</span>
                  )}
                </div>
              )}

              <div style={{ backgroundColor: COLORS.orangeSoft }} className="rounded-lg px-3 py-2 cs-rise">
                <p style={{ color: COLORS.orange }} className="text-[11px] leading-relaxed">
                  Check every name, title and figure against the footage before publishing.
                </p>
              </div>

              {result.caution ? (
                <div style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.orange }} className="rounded-lg border px-3 py-2 cs-rise">
                  <p style={{ color: COLORS.textMuted }} className="text-xs leading-relaxed">{result.caution}</p>
                </div>
              ) : null}

              {result.clipType && (
                <div className="flex items-center gap-2 flex-wrap">
                  <span style={{ backgroundColor: COLORS.tealSoft, color: COLORS.teal }} className="font-mono text-[10px] rounded-full px-2.5 py-1">
                    {result.clipType}
                  </span>
                  {result.searchCount > 0 && (
                    <span style={{ color: COLORS.textFaint }} className="font-mono text-[10px]">
                      {result.searchCount} search{result.searchCount === 1 ? "" : "es"} run
                    </span>
                  )}
                  {result.cacheInfo && result.cacheInfo.cacheRead > 0 && (
                    <span style={{ color: COLORS.violet }} className="font-mono text-[10px]" title="This request reused the cached system prompt instead of paying full price for it again.">
                      ⚡ cache hit — {result.cacheInfo.cacheRead.toLocaleString()} tokens reused
                    </span>
                  )}
                  {result.cacheInfo && result.cacheInfo.cacheRead === 0 && result.cacheInfo.cacheWritten > 0 && (
                    <span style={{ color: COLORS.textFaint }} className="font-mono text-[10px]" title="First request in a while — cache created, next one within ~1h will reuse it.">
                      cache written — ready for next time
                    </span>
                  )}
                </div>
              )}

              <Section accent={COLORS.teal} title="Titles & description" delay={0}>
                <CopyBlock label="Title — quote-led" value={result.titleQuote} />
                <CopyBlock label="Title — descriptive" value={result.titleDescriptive} />
                <CopyBlock label="Description" value={result.description} multiline />
                <CopyBlock label="Tags" value={(result.tags || []).join(", ")} multiline />
              </Section>

              <Section accent={COLORS.orange} title="Thumbnail" delay={70}>
                <CopyBlock label="Text — quote (≤30 chars)" value={result.thumbnailTextShort} />
                <CopyBlock label="Text — descriptive (≤70 chars)" value={result.thumbnailTextLong} />
                <CopyBlock label="Who to feature" value={(result.thumbnailPeople || []).join(", ")} />
                <CopyBlock label="Visual direction" value={result.thumbnailVisual} multiline />
              </Section>

              <Section accent={COLORS.violet} title="Lower thirds" delay={140}>
                <CopyBlock label="Headline" value={result.lowerThirdHeadline} />
                {(result.nameplates || []).map((np, i) => <NameplateRow key={i} np={np} />)}
              </Section>

              <Section accent={COLORS.textFaint} title="Source" delay={210}>
                <CopyBlock label="Date" value={result.eventDate} />
                {taskContext && taskContext.event && taskContext.event.source ? (
                  <CopyBlock label="Source" value={taskContext.event.source} multiline />
                ) : (
                  <p style={{ color: COLORS.textFaint }} className="text-xs italic">
                    {taskId
                      ? "This task has no Source set — add one from Tasks → Edit → Hearing record."
                      : "Link a task with a Source filled in to show it here."}
                  </p>
                )}
              </Section>

              {result.adSuitability && (result.adSuitability.selections || []).length > 0 && (
                <Section accent={COLORS.orange} title="Ad suitability — what to tick" delay={280}>
                  {result.adSuitability.overall && (
                    <p style={{ color: COLORS.textMuted }} className="text-xs mb-3 leading-relaxed">{result.adSuitability.overall}</p>
                  )}
                  {(() => {
                    const flagged = result.adSuitability.selections.filter(
                      (sel) => !/^none$/i.test((sel.answer || "").trim())
                    );
                    if (flagged.length === 0) {
                      return (
                        <p style={{ color: COLORS.teal }} className="text-xs">
                          Nothing flagged — select "None" across every category.
                        </p>
                      );
                    }
                    return (
                      <div className="flex flex-col gap-1.5">
                        {flagged.map((sel, i) => (
                          <div key={i} style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.orange }} className="rounded-lg border px-3 py-2">
                            <div className="flex items-center gap-2">
                              <p style={{ color: COLORS.textPrimary }} className="text-[11px] flex-1 leading-relaxed">{sel.question}</p>
                              <span style={{ backgroundColor: COLORS.orangeSoft, color: COLORS.orange }}
                                className="font-mono text-[10px] rounded-full px-2 py-0.5 shrink-0">
                                {sel.answer}
                              </span>
                            </div>
                            {sel.reason && (
                              <p style={{ color: COLORS.textFaint }} className="text-[10px] mt-1 leading-relaxed">{sel.reason}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                  {(result.adSuitability.unjudgeable || []).length > 0 && (
                    <p style={{ color: COLORS.orange }} className="text-[11px] mt-3 leading-relaxed">
                      Judge these yourself from the footage: {result.adSuitability.unjudgeable.join("; ")}
                    </p>
                  )}
                </Section>
              )}

              {result.shorts && result.shorts.length > 0 && (
                <Section accent={COLORS.violet} title={`Shorts found (${result.shorts.length})`} delay={350}>
                  <p style={{ color: COLORS.textFaint }} className="text-[10px] mb-3 leading-relaxed">
                    Search the opening words in your timeline to find the in-point, the closing words for the out-point.
                  </p>
                  <div className="flex flex-col gap-3">
                    {result.shorts.map((sh, i) => <ShortCard key={i} short={sh} index={i} transcript={transcript} />)}
                  </div>
                </Section>
              )}

              {result.shorts && result.shorts.length === 0 && (
                <Section accent={COLORS.violet} title="Shorts" delay={350}>
                  <p style={{ color: COLORS.textFaint }} className="text-xs">No segment in this clip stands alone as a short.</p>
                </Section>
              )}

              {result.parseFailed && (
                <p style={{ color: COLORS.textFaint }} className="text-[11px] leading-relaxed">
                  The response didn't come back in the expected shape — raw text shown above.
                </p>
              )}

              {result.truncated && !result.parseFailed && (
                <p style={{ color: COLORS.orange }} className="text-[11px] leading-relaxed">
                  This response ran out of output budget before finishing — everything shown above is real, but something near the end (likely part of the ad suitability section or a later short) may be missing. Worth regenerating to get the complete package.
                </p>
              )}
            </>
          )}

          {result && !viewingHistory && liveHistory.length > 0 && (
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

// Searches the actual uploaded transcript for where the short's in-point and
// out-point really sit, and returns the true character span between them.
// This is the honest check the model can't reliably do for itself — asking it
// to keep a segment "under 700 characters" requires it to precisely count
// characters across its own generation, which language models are simply bad
// at. Measuring against the real source text instead of trusting its
// self-report is what actually catches an oversized short.
// Finds the most recent [HH:MM:SS] marker before a given position in the
// transcript — used to derive a short's real timecode range directly from
// the source text, rather than trusting the model to have copied it
// correctly. Same reliability issue as character counts: asking the model to
// carry an exact value through its own generation is asking for a mistake.
// Finds the [start-end] marker for whichever block contains a given
// position — returns both times, not just the nearest preceding one. This is
// what makes the in-point and out-point genuinely different when a short
// sits entirely inside a single transcript block: the in-point uses that
// block's start, the out-point uses that SAME block's real end, instead of
// both anchors collapsing onto the one marker nearest to each of them.
function findContainingBlock(transcript, index) {
  const before = transcript.slice(0, index);
  const matches = [...before.matchAll(/\[(\d{2}:\d{2}:\d{2})-(\d{2}:\d{2}:\d{2})\]/g)];
  if (!matches.length) return null;
  const last = matches[matches.length - 1];
  return { start: last[1], end: last[2] };
}

function measureSpan(transcript, startsWith, endsWith) {
  if (!transcript || !startsWith || !endsWith) return { chars: null, verbatim: false, timecode: null };
  const startIdx = transcript.indexOf(startsWith);
  if (startIdx === -1) return { chars: null, verbatim: false, timecode: null };
  const endIdx = transcript.indexOf(endsWith, startIdx + startsWith.length);
  if (endIdx === -1) return { chars: null, verbatim: false, timecode: null };
  const startBlock = findContainingBlock(transcript, startIdx);
  const endBlock = findContainingBlock(transcript, endIdx + endsWith.length);
  const timecode = startBlock && endBlock ? `${startBlock.start} - ${endBlock.end}` : null;
  return { chars: (endIdx + endsWith.length) - startIdx, verbatim: true, timecode };
}

function ShortCard({ short, index, transcript }) {
  const [open, setOpen] = useState(index === 0);
  const span = measureSpan(transcript, short.startsWith, short.endsWith);
  // Character span is the primary, verified signal; timecode duration (when
  // present) is shown alongside it but character count is what's measured
  // against real text, not estimated.
  const timecode = span.timecode || short.timecode;
  const secsFromTimecode = parseTimecodeSeconds(timecode);
  const tooLong = span.chars != null ? span.chars > 1400 : (secsFromTimecode != null && secsFromTimecode > 60);
  const overSoftTarget = span.chars != null && span.chars > 700 && span.chars <= 1400;

  return (
    <div style={{ backgroundColor: COLORS.bgElevated, borderColor: tooLong ? COLORS.orange : COLORS.border }} className="rounded-xl border p-3">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-2 text-left">
        <span style={{ backgroundColor: COLORS.violetSoft, color: COLORS.violet }}
          className="font-mono text-[10px] rounded-full px-2 py-0.5 shrink-0">
          {index + 1}
        </span>
        {span.verbatim && (
          <span className="short-verified-badge" style={{ color: COLORS.teal }} title="Checked against the real transcript — this text is genuinely there">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
              <path d="M4 12.5L9.5 18L20 6" stroke={COLORS.teal} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
                style={{ strokeDasharray: 32, animation: "checkDraw 0.4s ease-out .1s both" }} />
            </svg>
          </span>
        )}
        <span style={{ color: COLORS.textPrimary }} className="text-xs flex-1 truncate">{short.title}</span>
        {span.chars != null ? (
          <span style={{ color: tooLong ? COLORS.orange : overSoftTarget ? COLORS.textMuted : COLORS.textFaint }} className="font-mono text-[10px] shrink-0">
            {span.chars} chars
          </span>
        ) : secsFromTimecode != null ? (
          <span style={{ color: tooLong ? COLORS.orange : COLORS.textFaint }} className="font-mono text-[10px] shrink-0">
            ~{secsFromTimecode}s
          </span>
        ) : null}
        <span style={{ color: COLORS.teal }} className="font-mono text-[10px] shrink-0">{open ? "Hide" : "Open"}</span>
      </button>

      {open && (
        <div className="mt-3">
          {timecode ? (
            <p style={{ color: COLORS.teal }} className="font-mono text-[11px] mb-2">
              {timecode}{span.timecode ? "" : short.timecode ? " (unverified)" : ""}
            </p>
          ) : null}
          {short.why && (
            <p style={{ color: COLORS.textFaint }} className="text-[11px] mb-3 leading-relaxed">{short.why}</p>
          )}
          {transcript && !span.verbatim && (
            <p style={{ color: COLORS.orange }} className="text-[11px] mb-3 leading-relaxed">
              Couldn't find this exact wording in the transcript — the in/out points may not be verbatim. Search for them manually before cutting.
            </p>
          )}
          {tooLong && (
            <p style={{ color: COLORS.orange }} className="text-[11px] mb-3 leading-relaxed">
              {span.chars != null
                ? `Measured at ${span.chars} characters — over the 1400 limit. Trim it or split it into two shorts.`
                : "Runs long for a short — you may need to trim it."}
            </p>
          )}
          <CopyBlock label="In-point — search this" value={short.startsWith} />
          <CopyBlock label="Out-point — search this" value={short.endsWith} />
          <CopyBlock label="Title" value={short.title} />
          <CopyBlock label="Description" value={short.description} multiline />
          <CopyBlock label="Tags" value={(short.tags || []).join(", ")} multiline />
        </div>
      )}
    </div>
  );
}

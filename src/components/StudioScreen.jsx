import React, { useState, useMemo, useEffect, useRef } from "react";
import { COLORS, displayNameFor } from "../lib/core";
import { HomeIcon } from "./Icon";
import { getKeys, setKeys, generatePackage, buildPrompt, cleanTranscript, hasTimecodes, regenerateSection } from "../lib/ai";

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
    <p style={{ color: "rgba(255,255,255,0.4)" }} className="font-mono text-[10px] tracking-[0.15em] uppercase mb-1.5">
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
          style={{ color: copied ? COLORS.teal : "rgba(255,255,255,0.4)" }}
          className="cs-copy font-mono text-[10px] mb-1.5">
          {copied ? "Copied ✓" : "Copy"}
        </button>
      </div>
      <div style={{ background: "rgba(255,255,255,0.06)", border: "0.5px solid rgba(255,255,255,0.14)", color: "#fff" }}
        className={`cs-glass-row rounded-lg px-3 py-2.5 text-sm ${multiline ? "whitespace-pre-wrap leading-relaxed" : ""}`}>
        {value}
      </div>
    </div>
  );
}

// Each output section gets its own card with a colored accent, so an editor
// can tell titles from thumbnail direction from ad suitability at a glance
// instead of scanning one long undifferentiated block.
function formatAgo(timestamp) {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours} hr${hours === 1 ? "" : "s"} ago`;
}

// A quick, best-effort line identifying what a past version actually
// said — not exhaustive, just enough to tell versions apart at a glance
// before deciding whether to restore one.
function previewSnapshot(fields) {
  for (const key of ["titleQuote", "titleDescriptive", "lowerThirdHeadline", "thumbnailTextShort", "description"]) {
    if (typeof fields[key] === "string" && fields[key]) return fields[key];
  }
  if (Array.isArray(fields.shorts)) return `${fields.shorts.length} short${fields.shorts.length === 1 ? "" : "s"}`;
  if (fields.adSuitability && fields.adSuitability.overall) return fields.adSuitability.overall;
  if (Array.isArray(fields.nameplates) && fields.nameplates.length) return fields.nameplates.map((n) => n.name).join(", ");
  return "Previous version";
}

function Section({ accent, title, children, delay = 0, onRegenerate, regenerating, regenerateError, regenerateStatus, history, onRestore }) {
  const [historyOpen, setHistoryOpen] = useState(false);
  return (
    <div
      style={{ animationDelay: `${delay}ms` }}
      className="cs-glass cs-glass-hover cs-spring rounded-2xl p-5 cs-rise">
      <div className="flex items-center justify-between gap-2 mb-3">
        <p style={{ color: accent }} className="font-mono text-[11px] tracking-[0.2em] uppercase font-bold">{title}</p>
        <div className="flex items-center gap-3 shrink-0">
          {history && history.length > 0 && (
            <button onClick={() => setHistoryOpen((o) => !o)}
              style={{ color: "rgba(255,255,255,0.4)" }}
              className="cs-brighten font-mono text-[10px]">
              {historyOpen ? "Hide" : `${history.length} earlier`}
            </button>
          )}
          {onRegenerate && (
            <button onClick={onRegenerate} disabled={regenerating}
              className="cs-glass-btn cs-spring flex items-center gap-1 font-mono text-[10px] px-2.5 py-1 disabled:cursor-not-allowed disabled:opacity-50">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" className={regenerating ? "cs-spin" : ""}>
                <path d="M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                <path d="M18 4v4h-4M6 20v-4h4" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {regenerating ? "Regenerating…" : "Regenerate"}
            </button>
          )}
        </div>
      </div>
      {historyOpen && history && history.length > 0 && (
        <div className="flex flex-col gap-2 mb-3 pb-3" style={{ borderBottom: "0.5px solid rgba(255,255,255,0.16)" }}>
          {history.map((v, i) => (
            <div key={v.at} style={{ background: "rgba(255,255,255,0.06)" }} className="cs-spring cs-glass-row flex items-center justify-between gap-2 rounded-lg px-3 py-2">
              <div className="min-w-0 flex-1">
                <p style={{ color: "rgba(255,255,255,0.4)" }} className="font-mono text-[10px]">{formatAgo(v.at)}</p>
                <p style={{ color: "rgba(255,255,255,0.6)" }} className="text-xs truncate">{previewSnapshot(v.fields)}</p>
              </div>
              <button onClick={() => onRestore(i)} style={{ color: accent }} className="cs-brighten font-mono text-[10px] shrink-0">Restore</button>
            </div>
          ))}
        </div>
      )}
      {regenerating && (
        <div key={regenerateStatus ? regenerateStatus.text : "starting"} className="cs-status-text-in flex items-center gap-2 mb-3 pb-3" style={{ borderBottom: "0.5px solid rgba(255,255,255,0.16)" }}>
          <StatusIcon kind={regenerateStatus ? regenerateStatus.icon : "think"} />
          <span style={{ color: "rgba(255,255,255,0.6)" }} className="text-xs">{regenerateStatus ? regenerateStatus.text : "Starting…"}</span>
        </div>
      )}
      {children}
      {regenerateError && <p style={{ color: "#F09595" }} className="text-[11px] mt-3 leading-relaxed">{regenerateError}</p>}
    </div>
  );
}

// One calm, changing icon instead of a growing checklist — search,
// reasoning, and writing each get a distinct, simple mark so the phase
// reads at a glance even before the text is parsed.
function StatusIcon({ kind }) {
  const stroke = COLORS.teal;
  const common = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke, strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" };
  if (kind === "search") {
    return (
      <svg {...common}><circle cx="10.5" cy="10.5" r="6.5" /><path d="M20 20l-4.7-4.7" /></svg>
    );
  }
  if (kind === "think") {
    return (
      <svg {...common}><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.5.4.8 1 .8 1.6v.5h5.4v-.5c0-.6.3-1.2.8-1.6A6 6 0 0 0 12 3z" /></svg>
    );
  }
  if (kind === "write") {
    return (
      <svg {...common}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" /></svg>
    );
  }
  // "read" — the initial, brief state before anything else has happened yet.
  return (
    <svg {...common}><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H12v18H6.5A2.5 2.5 0 0 1 4 18.5v-13z" /><path d="M20 5.5A2.5 2.5 0 0 0 17.5 3H12v18h5.5a2.5 2.5 0 0 0 2.5-2.5v-13z" /></svg>
  );
}

// A small "i" that expands into the full note on click instead of
// permanently taking up space in the container — used for Claude's own
// commentary (caution, split reasoning) which is worth having available
// but doesn't need to always be visible to read the actual package.
function InfoNote({ children, accent = COLORS.orange }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-block" style={{ verticalAlign: "middle" }}>
      <button onClick={() => setOpen((o) => !o)} aria-label="More info" aria-expanded={open}
        className="cs-spring inline-flex items-center justify-center rounded-full"
        style={{ width: 16, height: 16, color: accent, border: `1px solid ${accent}`, fontSize: 10, fontWeight: 700, lineHeight: 1, background: open ? `${accent}22` : "transparent" }}>
        i
      </button>
      {open && (
        <div className="cs-glass rounded-lg p-3 text-xs leading-relaxed cs-status-text-in absolute z-20" style={{ top: 22, left: 0, width: 260, color: "rgba(255,255,255,0.85)" }}>
          {children}
        </div>
      )}
    </span>
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

export default function StudioScreen({ tasks, channels, workflows, aiConfig, clipPackages, onSavePackage, onSaveTranscript, onFetchTranscript, onBack, profiles, onCreateShortsTask }) {
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
  const [selectedVideoIndex, setSelectedVideoIndex] = useState(0);
  // Old saved packages, and anything from before this existed, are one flat
  // object with no "videos" wrapper at all — treated as a single video here
  // so nothing already saved breaks. A genuinely new multi-video result uses
  // the real array.
  const videos = result && !result.parseFailed
    ? (result.videos && result.videos.length ? result.videos : [result])
    : [];
  const activeVideo = videos[selectedVideoIndex] || videos[0] || {};
  useEffect(() => { setSelectedVideoIndex(0); }, [result]);

  const [selectedShortIndices, setSelectedShortIndices] = useState(() => new Set());
  const [shortsTaskFormOpen, setShortsTaskFormOpen] = useState(false);
  // Selection is scoped to whichever video is active — each video has its
  // own source footage, so a selection made against one doesn't carry any
  // real meaning if you switch to a different video.
  useEffect(() => { setSelectedShortIndices(new Set()); setShortsTaskFormOpen(false); }, [selectedVideoIndex, result]);
  const toggleShortSelected = (i) => {
    setSelectedShortIndices((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  };

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
      channelId: t.channelId || null,
      channelName: ch ? ch.name : null,
      contentFormat: wf ? wf.contentType : null,
      monetised: !!(ch && ch.monetised),
      country: (ch && ch.country) || null,
      event: t.event || null,
      links: t.links || [],
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

  const [currentStatus, setCurrentStatus] = useState(null); // { icon, text }
  const [sourcesChecked, setSourcesChecked] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const lastStatusAtRef = useRef(0);
  const lastQueryRef = useRef(null);
  const sourcesCheckedRef = useRef(0);
  const lastPhaseRef = useRef(null);
  const heartbeatCountRef = useRef(0);

  // A continuously ticking clock, always visible while busy — not just
  // during a stall. This is what actually guarantees the screen never looks
  // frozen: even if the status text itself hasn't changed, the number is
  // always moving, which is the clearest possible "this is still alive"
  // signal there is.
  useEffect(() => {
    if (!busy) { setElapsedSeconds(0); return; }
    const startedAt = Date.now();
    const id = setInterval(() => setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(id);
  }, [busy]);

  // Real status events don't fire on any fixed schedule — there can be
  // genuine server-side reasoning between tool calls with no visible event
  // at all, which is exactly what can turn into a long silent stretch with
  // nothing on screen. There's genuinely nothing more specific available
  // from the API during that gap — every event type it documents is
  // already being watched — so this leans on what's actually already
  // known (how many sources, which phase it was last confirmed in) rather
  // than a disconnected generic phrase.
  useEffect(() => {
    if (!busy) { heartbeatCountRef.current = 0; return; }
    const id = setInterval(() => {
      const quietFor = Date.now() - lastStatusAtRef.current;
      if (quietFor < 7000) return;
      const n = heartbeatCountRef.current;
      heartbeatCountRef.current += 1;
      lastStatusAtRef.current = Date.now();
      const phase = lastPhaseRef.current;
      const sources = sourcesCheckedRef.current;
      let text;
      if (phase === "search" && sources > 0) {
        text = n % 2 === 0
          ? `Weighing what ${sources} source${sources === 1 ? "" : "s"} actually said`
          : `Deciding whether ${sources} source${sources === 1 ? "" : "s"} is enough, or another search is needed`;
      } else if (phase === "search") {
        text = "Still searching — this one's taking a moment to come back";
      } else if (phase === "write") {
        text = n % 2 === 0
          ? "Still working through the wording on this section"
          : "Still putting this section together";
      } else {
        text = "Reading through the transcript in detail";
      }
      setCurrentStatus({ icon: "think", text });
    }, 2000);
    return () => clearInterval(id);
  }, [busy]);
  const [wantShorts, setWantShorts] = useState(true);
  const [wantMultipleVideos, setWantMultipleVideos] = useState(true);

  const run = async (message, prior) => {
    setBusy(true); setError(""); setViewedPkg(null); setCurrentStatus(null); setSourcesChecked(0); // a new generation is always "current"
    lastStatusAtRef.current = Date.now();
    lastQueryRef.current = null;
    sourcesCheckedRef.current = 0;
    lastPhaseRef.current = null;
    heartbeatCountRef.current = 0;
    try {
      const next = [...prior, { role: "user", content: message }];
      const out = await generatePackage({
        history: next, apiKey: keys.anthropic, model: keys.model,
        onStatus: (s) => {
          lastStatusAtRef.current = Date.now();
          if (s.phase === "searching") {
            if (s.query) lastQueryRef.current = s.query;
            lastPhaseRef.current = "search";
            setCurrentStatus({ icon: "search", text: s.query ? `Searching: "${s.query}"` : "Starting a search…" });
          } else if (s.phase === "search_results") {
            // The real payoff for the pause after a search fires — actual
            // source names, attached to the same line as the query that
            // found them, not a description of "searching" with nothing
            // behind it.
            lastPhaseRef.current = "search";
            setSourcesChecked((n) => { sourcesCheckedRef.current = n + s.count; return sourcesCheckedRef.current; });
            const resultInfo = s.count === 0
              ? "no results"
              : s.domains.length
              ? `found ${s.domains.slice(0, 2).join(", ")}${s.domains.length > 2 ? `, +${s.domains.length - 2} more` : ""}`
              : `${s.count} result${s.count === 1 ? "" : "s"}`;
            setCurrentStatus({ icon: "search", text: lastQueryRef.current ? `"${lastQueryRef.current}" — ${resultInfo}` : resultInfo });
          } else if (s.phase === "thinking") {
            setCurrentStatus({ icon: "think", text: "Reasoning through what it found…" });
          } else if (s.phase === "writing") {
            lastPhaseRef.current = "write";
            setCurrentStatus({ icon: "write", text: s.field || "Starting to write the package…" });
          }
        },
      });
      setLiveResult(out);
      setLiveHistory([...next, { role: "assistant", content: out.raw || "" }]);
      // The transcript itself is saved separately (see onSaveTranscript
      // below) rather than embedded here — this package document is part
      // of a live-synced list capped at 200 items, and embedding a full
      // transcript in every one of them would add real bandwidth to every
      // app load for data that's only ever needed for whichever single
      // package someone actually tries to regenerate.
      if (onSavePackage && !out.parseFailed) {
        const savedId = await onSavePackage(taskId || null, out);
        if (onSaveTranscript && savedId) onSaveTranscript(savedId, transcript);
      }
    } catch (e) {
      setError(e.message || "Something went wrong.");
    }
    setBusy(false);
  };

  const generate = () => {
    if (!transcript.trim()) return;
    setLiveHistory([]);
    run(buildPrompt(transcript, { ...(taskContext || {}), adOptions: keys.adOptions, wantShorts, wantMultipleVideos }), []);
  };

  // Regenerating one block — headline, thumbnail, metadata, shorts, or ad
  // suitability — without re-running the whole package. Tracked per section
  // so regenerating one block never disables or misrepresents the state of
  // any other, even though only one is ever actually in flight at a time in
  // this UI.
  const [regeneratingSection, setRegeneratingSection] = useState(null);
  const [regenerateErrors, setRegenerateErrors] = useState({});
  const [regenerateStatus, setRegenerateStatus] = useState(null); // { icon, text } for whichever section is currently regenerating
  // Every past version of every regenerated section, scoped per video —
  // switching videos or loading a different package starts fresh, since an
  // old version from a different result has no business being restorable
  // into this one. Capped at 5 versions back per section, most recent first.
  const [sectionHistory, setSectionHistory] = useState({});
  const historyKey = (section) => `${selectedVideoIndex}-${section}`;
  useEffect(() => { setSectionHistory({}); }, [result]);

  const applyFieldsToVideo = (fields) => {
    const setter = viewedPkg ? setViewedPkg : setLiveResult;
    setter((prev) => {
      if (!prev) return prev;
      if (prev.videos && prev.videos.length) {
        return { ...prev, videos: prev.videos.map((v, i) => (i === selectedVideoIndex ? { ...v, ...fields } : v)) };
      }
      // Legacy flat-shape result — the single video IS the result object itself.
      return { ...prev, ...fields };
    });
  };

  const restoreVersion = (section, versionIndex) => {
    const key = historyKey(section);
    const history = sectionHistory[key] || [];
    const version = history[versionIndex];
    if (!version) return;
    // Restoring is itself undo-able — the version being replaced goes back
    // onto the stack rather than just vanishing, so restoring the wrong
    // one isn't a dead end.
    const currentSnapshot = {};
    Object.keys(version.fields).forEach((k) => { currentSnapshot[k] = activeVideo[k]; });
    setSectionHistory((h) => {
      const rest = history.filter((_, i) => i !== versionIndex);
      return { ...h, [key]: [{ fields: currentSnapshot, at: Date.now() }, ...rest].slice(0, 5) };
    });
    applyFieldsToVideo(version.fields);
  };

  const regenLastQueryRef = useRef(null);
  const regenLastStatusAtRef = useRef(0);
  const regenHeartbeatCountRef = useRef(0);

  // Same real gap as full generation had — there can be a genuine stretch
  // of invisible model reasoning with no event to show for it, which is
  // exactly what "stuck on Starting" looks like from the outside. This
  // fills that gap the same way: a plain reassurance that cycles rather
  // than freezing on a single repeated message.
  useEffect(() => {
    if (!regeneratingSection) { regenHeartbeatCountRef.current = 0; return; }
    const MESSAGES = [
      "Still working on it — this can take a moment",
      "Still going — reasoning through the details",
      "Still working — hang tight",
    ];
    const id = setInterval(() => {
      const quietFor = Date.now() - regenLastStatusAtRef.current;
      if (quietFor < 7000) return;
      const msgIdx = regenHeartbeatCountRef.current % MESSAGES.length;
      regenHeartbeatCountRef.current += 1;
      regenLastStatusAtRef.current = Date.now();
      setRegenerateStatus({ icon: "think", text: MESSAGES[msgIdx] });
    }, 2000);
    return () => clearInterval(id);
  }, [regeneratingSection]);

  const handleRegenerate = async (section) => {
    if (regeneratingSection) return; // one at a time, already in flight
    if (missingKey) { setRegenerateErrors((e) => ({ ...e, [section]: "Add your Anthropic API key in Profile first." })); return; }
    if (!transcript.trim()) {
      setRegenerateErrors((e) => ({ ...e, [section]: transcriptLoading
        ? "Still loading the transcript for this package — try again in a moment."
        : "No transcript is available for this package to regenerate against — this is likely an older package saved before this feature existed. Paste the transcript back into the box above, then try again." }));
      return;
    }
    setRegeneratingSection(section);
    setRegenerateErrors((e) => ({ ...e, [section]: null }));
    regenLastQueryRef.current = null;
    regenLastStatusAtRef.current = Date.now();
    regenHeartbeatCountRef.current = 0;
    setRegenerateStatus(null);
    try {
      const { fields } = await regenerateSection({
        transcript,
        task: { ...(taskContext || {}), adOptions: keys.adOptions },
        section,
        video: activeVideo,
        apiKey: keys.anthropic,
        model: keys.model,
        onStatus: (s) => {
          regenLastStatusAtRef.current = Date.now();
          // Same phase names, same phrasing as full generation, so this
          // reads as familiar rather than a second, different-feeling
          // status system — but kept fully separate from that handler so
          // regeneration can never affect its state or vice versa.
          if (s.phase === "searching") {
            if (s.query) regenLastQueryRef.current = s.query;
            setRegenerateStatus({ icon: "search", text: s.query ? `Searching: "${s.query}"` : "Starting a search…" });
          } else if (s.phase === "search_results") {
            const resultInfo = s.count === 0
              ? "no results"
              : s.domains.length
              ? `found ${s.domains.slice(0, 2).join(", ")}${s.domains.length > 2 ? `, +${s.domains.length - 2} more` : ""}`
              : `${s.count} result${s.count === 1 ? "" : "s"}`;
            setRegenerateStatus({ icon: "search", text: regenLastQueryRef.current ? `"${regenLastQueryRef.current}" — ${resultInfo}` : resultInfo });
          } else if (s.phase === "thinking") {
            setRegenerateStatus({ icon: "think", text: "Reasoning through what it found…" });
          } else if (s.phase === "writing") {
            setRegenerateStatus({ icon: "write", text: "Writing the new version…" });
          }
        },
      });
      const previousSnapshot = {};
      Object.keys(fields).forEach((k) => { previousSnapshot[k] = activeVideo[k]; });
      setSectionHistory((h) => {
        const key = historyKey(section);
        const existing = h[key] || [];
        return { ...h, [key]: [{ fields: previousSnapshot, at: Date.now() }, ...existing].slice(0, 5) };
      });
      applyFieldsToVideo(fields);
    } catch (e) {
      setRegenerateErrors((errs) => ({ ...errs, [section]: e.message || "Regeneration failed. Try again." }));
    } finally {
      setRegeneratingSection(null);
      setRegenerateStatus(null);
    }
  };

  const sendRefinement = () => {
    if (!refine.trim() || !liveHistory.length) return;
    const msg = refine.trim();
    setRefine("");
    run(msg, liveHistory);
  };

  // Preview a past package without touching the live one — "Back to current" undoes this.
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const loadHistoryItem = async (pkg) => {
    setViewedPkg(pkg); setError("");
    if (!onFetchTranscript) return;
    setTranscriptLoading(true);
    const t = await onFetchTranscript(pkg.id);
    // Clears rather than leaving whatever was previously in the box —
    // an empty result here means genuinely nothing was found (either an
    // older package saved before transcripts were stored this way, or a
    // fetch error), and a stale, mismatched transcript sitting in the box
    // would be worse than an honest blank, since regenerating against the
    // wrong source text is a real correctness problem, not just a missing feature.
    setTranscript(t || "");
    setTranscriptLoading(false);
  };
  const backToCurrent = () => setViewedPkg(null);

  const field = { background: "rgba(255,255,255,0.08)", borderColor: "rgba(255,255,255,0.2)", color: "#fff" };
  const fieldCls = "cs-field w-full rounded-lg border px-3 py-2 text-sm";

  return (
    <div className="flex-1 flex flex-col max-w-6xl w-full mx-auto px-6 py-8 sm:py-10 overflow-y-auto fade-in"
      style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Inter", "Segoe UI", Roboto, Helvetica, Arial, sans-serif' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
        @keyframes cs-rise { from { opacity: 0; transform: translateY(10px) scale(.98) } to { opacity: 1; transform: none } }
        @keyframes cs-pulse { 0%,100% { opacity: .35 } 50% { opacity: 1 } }
        @keyframes cs-sweep { 0% { transform: translateX(-100%) } 100% { transform: translateX(300%) } }
        @keyframes cs-status-in { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: none } }
        @keyframes cs-pulse-ring { 0% { transform: scale(.85); opacity: .9 } 70% { transform: scale(1.35); opacity: 0 } 100% { opacity: 0 } }
        @keyframes cs-spin { to { transform: rotate(360deg) } }
        @keyframes cs-pool-drift { 0%,100% { transform: translate(0,0) scale(1) } 50% { transform: translate(2%,-3%) scale(1.05) } }
        @keyframes checkDraw { from { stroke-dashoffset: 32 } to { stroke-dashoffset: 0 } }
        /* Apple's own sheet-presentation curve (reverse-engineered from UIKit) for
           things that open or settle into place, and a slight-overshoot "spring"
           curve for anything meant to feel pressed or toggled — this is what
           actually reads as "iOS" rather than a generic ease. */
        .cs-rise { animation: cs-rise .5s cubic-bezier(.32,.72,0,1) both; }
        .cs-spring { transition: transform .35s cubic-bezier(.34,1.56,.64,1), background .2s cubic-bezier(.32,.72,0,1), border-color .2s cubic-bezier(.32,.72,0,1); }
        .cs-pulse { animation: cs-pulse 1.4s ease-in-out infinite; }
        .cs-sweep { animation: cs-sweep 1.6s ease-in-out infinite; }
        .cs-status-icon-in { animation: cs-status-in .4s cubic-bezier(.32,.72,0,1) both; }
        .cs-status-text-in { animation: cs-status-in .4s cubic-bezier(.32,.72,0,1) both .05s; }
        .cs-pulse-ring { animation: cs-pulse-ring 1.8s cubic-bezier(.2,.7,.3,1) infinite; }
        .cs-spin { animation: cs-spin .8s linear infinite; }
        .cs-field { transition: border-color .18s cubic-bezier(.32,.72,0,1), box-shadow .18s cubic-bezier(.32,.72,0,1), background .18s cubic-bezier(.32,.72,0,1); }
        .cs-field:focus { outline: none; border-color: rgba(255,255,255,0.5); box-shadow: 0 0 0 3px rgba(255,255,255,0.12); }
        .cs-copy { transition: color .15s cubic-bezier(.32,.72,0,1), opacity .15s ease; }
        .cs-copy:hover { color: #2DD4C4 !important; }
        .cs-brighten { transition: color .15s cubic-bezier(.32,.72,0,1); }
        .cs-brighten:hover { color: #fff !important; }
        .cs-toggle-row { transition: background .15s cubic-bezier(.32,.72,0,1); border-radius: 8px; margin-left: -8px; margin-right: -8px; padding-left: 8px; padding-right: 8px; }
        .cs-toggle-row:hover { background: rgba(255,255,255,0.06); }
        .cs-toggle-track:active { transform: scale(0.93); }
        .cs-tab { transition: background .15s cubic-bezier(.32,.72,0,1), border-color .15s cubic-bezier(.32,.72,0,1); }
        .cs-tab:hover { background: rgba(255,255,255,0.16) !important; border-color: rgba(255,255,255,0.4) !important; }
        .cs-glass-cta {
          backdrop-filter: blur(18px) saturate(160%); -webkit-backdrop-filter: blur(18px) saturate(160%);
          border-top: 0.5px solid rgba(255,255,255,0.5); color: #fff;
          transition: transform .2s cubic-bezier(.32,.72,0,1), background .2s cubic-bezier(.32,.72,0,1);
        }
        .cs-glass-cta:hover { transform: translateY(-1px); }
        .cs-glass-cta:active { transform: scale(.97) translateY(0); }
        .cs-glass-cta-teal { background: rgba(45,212,196,0.22); border: 0.5px solid rgba(45,212,196,0.5); }
        .cs-glass-cta-teal:hover { background: rgba(45,212,196,0.34) !important; }
        .cs-glass-cta-violet { background: rgba(167,139,250,0.22); border: 0.5px solid rgba(167,139,250,0.5); }
        .cs-glass-cta-violet:hover { background: rgba(167,139,250,0.34) !important; }
        .cs-scroll-outer {
          border-radius: 20px; padding: 3px;
          background: rgba(255,255,255,0.03); border: 0.5px solid rgba(255,255,255,0.18);
        }
        .cs-scroll-inner {
          border-radius: 18px; padding: 12px;
          mask-image: linear-gradient(to bottom, transparent, black 20px, black calc(100% - 20px), transparent);
          -webkit-mask-image: linear-gradient(to bottom, transparent, black 20px, black calc(100% - 20px), transparent);
        }
        .cs-dropzone { transition: background .15s cubic-bezier(.32,.72,0,1), border-color .15s cubic-bezier(.32,.72,0,1); }
        .cs-dropzone:hover { background: rgba(255,255,255,0.06); border-color: rgba(255,255,255,0.4) !important; }

        /* The scene glass actually refracts — soft, blurred, related-hue pools,
           drifting very slowly so the whole screen feels quietly alive rather
           than static, the way Liquid Glass is meant to. */
        .cs-backdrop { position: fixed; inset: 0; z-index: 0; overflow: hidden; background: #141213; pointer-events: none; }
        .cs-pool { position: absolute; border-radius: 50%; filter: blur(60px); animation: cs-pool-drift 14s ease-in-out infinite; }

        /* One glass surface, used everywhere — sections, cards, buttons,
           inputs, modals. Real translucency plus a bright top edge, which is
           the actual visual signature of light catching a glass rim. */
        .cs-glass {
          background: rgba(15,12,10,0.46);
          border: 0.5px solid rgba(255,255,255,0.2);
          border-top: 0.5px solid rgba(255,255,255,0.4);
          backdrop-filter: blur(18px) saturate(150%);
          -webkit-backdrop-filter: blur(18px) saturate(150%);
        }
        .cs-glass-hover:hover { background: rgba(15,12,10,0.36); border-top-color: rgba(255,255,255,0.62); transform: translateY(-1px); }
        .cs-glass-btn {
          background: rgba(255,255,255,0.1); border: 0.5px solid rgba(255,255,255,0.28);
          color: rgba(255,255,255,0.85); border-radius: 100px;
        }
        .cs-glass-btn:hover { background: rgba(255,255,255,0.92); color: #26211d; }
        .cs-glass-btn:active { transform: scale(.96); }
        .cs-glass-row { transition: background .15s cubic-bezier(.32,.72,0,1), border-color .15s cubic-bezier(.32,.72,0,1); border-radius: 6px; }
        .cs-glass-row:hover { background: rgba(255,255,255,0.08); border-color: rgba(255,255,255,0.28) !important; }
        .cs-glass-row:hover .cs-copy-reveal { opacity: 0.75 !important; }

        @media (prefers-reduced-motion: reduce) { .cs-rise, .cs-pulse, .cs-sweep, .cs-status-icon-in, .cs-status-text-in, .cs-pulse-ring, .cs-spin, .cs-pool { animation: none !important; } .cs-spring, .cs-glass-hover, .cs-glass-btn { transition: none !important; } }
        /* Apple's own accessibility pattern for Liquid Glass: Reduced
           Transparency makes glass frostier and more opaque instead of
           removing the effect outright. */
        @media (prefers-reduced-transparency: reduce) { .cs-glass { background: rgba(10,8,7,0.92) !important; backdrop-filter: none !important; -webkit-backdrop-filter: none !important; } }
      `}</style>
      <div className="cs-backdrop" aria-hidden="true">
        <div className="cs-pool" style={{ top: "-15%", left: "-10%", width: "55%", height: "70%", background: "#378ADD", opacity: 0.55 }} />
        <div className="cs-pool" style={{ top: "10%", left: "55%", width: "50%", height: "60%", background: "#1D9E75", opacity: 0.5, animationDelay: "-4s" }} />
        <div className="cs-pool" style={{ top: "45%", left: "20%", width: "55%", height: "65%", background: "#7F77DD", opacity: 0.45, animationDelay: "-9s" }} />
        <div className="cs-pool" style={{ top: "55%", left: "60%", width: "40%", height: "50%", background: "#5DCAA5", opacity: 0.35, animationDelay: "-6s" }} />
      </div>

      <div style={{ position: "relative", zIndex: 1 }}>
      <div className="flex items-center justify-between mb-2">
        <h2 style={{ color: "#fff", letterSpacing: "-0.02em" }} className="text-2xl sm:text-3xl font-bold">Clip studio</h2>
        <button onClick={onBack} aria-label="Home" className="cs-glass cs-glass-hover cs-spring rounded-full p-2"><HomeIcon size={18} color="#fff" /></button>
      </div>
      <p style={{ color: "rgba(255,255,255,0.6)" }} className="text-sm mb-6">
        Link the task, drop in the transcript. Speakers and clip type are read from the transcript itself.
      </p>

      {missingKey && (
        <div className="cs-glass rounded-xl px-4 py-3 mb-5" style={{ borderColor: "rgba(242,120,75,0.4)" }}>
          <p style={{ color: COLORS.orange }} className="text-sm">No API key set — ask your admin to add one in Profile.</p>
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-6">
        {/* ---------- input ---------- */}
        <div className="flex flex-col gap-4">
          <div className="cs-glass rounded-2xl p-5">
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
                <p style={{ color: "rgba(255,255,255,0.4)" }} className="text-[11px]">
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
                <span style={{ color: "rgba(255,255,255,0.4)" }} className="font-mono text-[10px]">#{taskCode(taskId)}</span>
              </div>
            ) : <div className="mb-1.5" />}
            {taskId && (yieldStats.count > 0) && (
              <p style={{ color: COLORS.teal }} className="font-mono text-[11px] mt-2">
                {yieldStats.count} package{yieldStats.count === 1 ? "" : "s"} generated so far · {yieldStats.shorts} short{yieldStats.shorts === 1 ? "" : "s"} found total
              </p>
            )}
          </div>

          <div className="cs-glass rounded-2xl p-5">
            <Label>Transcript</Label>
            <label
              style={{ background: "rgba(255,255,255,0.08)", borderColor: transcript ? COLORS.teal : "rgba(255,255,255,0.22)" }}
              className="cs-dropzone flex flex-col items-center justify-center rounded-xl border-2 border-dashed py-10 px-4 cursor-pointer text-center">
              <input type="file" accept=".txt,.srt,.vtt,text/plain" className="hidden"
                onChange={(e) => loadFile(e.target.files && e.target.files[0])} />
              {transcript ? (
                <>
                  <p style={{ color: COLORS.teal }} className="text-sm font-semibold">{fileName || "Transcript loaded"}</p>
                  <p style={{ color: "rgba(255,255,255,0.4)" }} className="font-mono text-[11px] mt-1">
                    {transcript.trim().split(/\s+/).length.toLocaleString()} words
                    {hasTimecodes(transcript) ? " · timecodes found" : ""}
                  </p>
                  <p style={{ color: "rgba(255,255,255,0.4)" }} className="text-[10px] mt-2">Click to replace</p>
                </>
              ) : (
                <>
                  <p style={{ color: "rgba(255,255,255,0.6)" }} className="text-sm font-semibold">Upload transcript</p>
                  <p style={{ color: "rgba(255,255,255,0.4)" }} className="text-[11px] mt-1">.txt, .srt or .vtt</p>
                </>
              )}
            </label>

            <button onClick={() => setWantShorts((w) => !w)} disabled={busy}
              className="cs-toggle-row w-full flex items-center justify-between gap-2 mt-4 py-1.5 disabled:cursor-not-allowed">
              <span style={{ color: "rgba(255,255,255,0.6)" }} className="text-xs font-semibold">Find shorts too</span>
              <span style={{ backgroundColor: wantShorts ? COLORS.teal : "rgba(255,255,255,0.2)", opacity: busy ? 0.5 : 1 }}
                className="cs-spring cs-toggle-track relative w-9 h-5 rounded-full shrink-0">
                <span style={{ backgroundColor: "#fff", left: wantShorts ? 18 : 2 }}
                  className="cs-spring absolute top-0.5 w-4 h-4 rounded-full" />
              </span>
            </button>

            <button onClick={() => setWantMultipleVideos((w) => !w)} disabled={busy}
              className="cs-toggle-row w-full flex items-center justify-between gap-2 mt-2 py-1.5 disabled:cursor-not-allowed">
              <span style={{ color: "rgba(255,255,255,0.6)" }} className="text-xs font-semibold">Split into multiple videos if needed</span>
              <span style={{ backgroundColor: wantMultipleVideos ? COLORS.teal : "rgba(255,255,255,0.2)", opacity: busy ? 0.5 : 1 }}
                className="cs-spring cs-toggle-track relative w-9 h-5 rounded-full shrink-0">
                <span style={{ backgroundColor: "#fff", left: wantMultipleVideos ? 18 : 2 }}
                  className="cs-spring absolute top-0.5 w-4 h-4 rounded-full" />
              </span>
            </button>

            <button onClick={generate} disabled={busy || !transcript.trim() || missingKey}
              style={{ opacity: (busy || !transcript.trim() || missingKey) ? 0.4 : 1 }}
              className="cs-glass-cta cs-glass-cta-teal w-full rounded-xl py-3.5 text-sm font-bold disabled:cursor-not-allowed mt-2">
              {busy ? "Working…" : "Generate package"}
            </button>
          </div>

          {taskId && taskPackages.length > 0 && (
            <div className="cs-glass rounded-2xl p-5">
              <p style={{ color: "rgba(255,255,255,0.4)" }} className="font-mono text-[11px] tracking-[0.2em] uppercase mb-3">
                History for this task
              </p>
              <div className="flex flex-col gap-1.5 max-h-64 overflow-y-auto">
                {taskPackages.map((pkg) => {
                  // Backward compatible with packages saved before videos
                  // existed as a wrapper — those are just the flat shape.
                  const pkgVideos = pkg.videos && pkg.videos.length ? pkg.videos : [pkg];
                  const first = pkgVideos[0] || {};
                  const totalShorts = pkgVideos.reduce((n, v) => n + (v.shorts || []).length, 0);
                  return (
                    <button key={pkg.id} onClick={() => loadHistoryItem(pkg)}
                      style={{ background: "rgba(255,255,255,0.06)", border: "0.5px solid rgba(255,255,255,0.14)" }}
                      className="cs-spring cs-glass-row px-3 py-2 text-left">
                      <p style={{ color: "#fff" }} className="text-xs truncate">
                        {first.titleDescriptive || first.titleQuote || "Untitled package"}
                        {pkgVideos.length > 1 ? ` (+${pkgVideos.length - 1} more video${pkgVideos.length > 2 ? "s" : ""})` : ""}
                      </p>
                      <p style={{ color: "rgba(255,255,255,0.4)" }} className="font-mono text-[10px] mt-0.5">
                        {formatWhen(pkg.createdAt)} · {totalShorts} short{totalShorts === 1 ? "" : "s"}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* ---------- output ---------- */}
        <div className="cs-scroll-outer sticky top-4 self-start" style={{ maxHeight: "calc(100dvh - 7rem)" }}>
        <div className="cs-scroll-inner flex flex-col gap-4 overflow-y-auto" style={{ maxHeight: "calc(100dvh - 7.6rem)" }}>
          {error && (
            <div className="cs-glass rounded-xl px-4 py-3" style={{ borderColor: "rgba(226,75,74,0.4)" }}>
              <p style={{ color: "#F09595" }} className="text-sm">{error}</p>
            </div>
          )}

          {!result && !busy && !error && (
            <div className="cs-glass rounded-2xl p-10 text-center cs-rise">
              <div className="flex justify-center gap-1.5 mb-5" aria-hidden="true">
                {[0, 1, 2].map((i) => (
                  <span key={i} style={{
                    width: i === 1 ? 34 : 20, height: 4, borderRadius: 9999,
                    backgroundColor: i === 1 ? COLORS.teal : "rgba(255,255,255,0.2)",
                  }} />
                ))}
              </div>
              <p style={{ color: "rgba(255,255,255,0.6)" }} className="text-sm font-semibold">The package appears here</p>
              <p style={{ color: "rgba(255,255,255,0.4)" }} className="text-xs mt-2 leading-relaxed max-w-xs mx-auto">
                Title, description, tags, thumbnail direction, lower thirds, ad suitability and shorts.
              </p>
            </div>
          )}

          {busy && (
            <div className="cs-glass rounded-2xl p-8 cs-rise">
              <div className="relative h-1 rounded-full overflow-hidden mb-6" style={{ background: "rgba(255,255,255,0.14)" }}>
                <div className="cs-sweep absolute inset-y-0 w-1/3 rounded-full" style={{ backgroundColor: COLORS.teal }} />
              </div>
              <div className="flex flex-col items-center text-center gap-3 py-2">
                <div key={currentStatus ? currentStatus.icon : "idle"} className="cs-status-icon-in relative flex items-center justify-center"
                  style={{ width: 44, height: 44 }}>
                  <span className="cs-pulse-ring absolute inset-0 rounded-full" style={{ backgroundColor: COLORS.tealSoft }} />
                  <StatusIcon kind={currentStatus ? currentStatus.icon : "read"} />
                </div>
                <p key={currentStatus ? currentStatus.text : "reading"} style={{ color: "#fff" }}
                  className="cs-status-text-in text-sm font-medium max-w-md leading-relaxed">
                  {currentStatus ? currentStatus.text : "Reading the transcript…"}
                </p>
                {sourcesChecked > 0 && (
                  <p style={{ color: "rgba(255,255,255,0.4)" }} className="font-mono text-[10px] tracking-[0.1em] uppercase">
                    {sourcesChecked} source{sourcesChecked === 1 ? "" : "s"} checked
                  </p>
                )}
                {/* Deliberately outside the crossfading block above — ticks
                    every second on its own, so there's always something
                    visibly moving even in a stretch where the status text
                    genuinely has nothing new to say yet. */}
                <p style={{ color: "rgba(255,255,255,0.4)" }} className="font-mono text-[10px] tabular-nums">
                  {Math.floor(elapsedSeconds / 60)}:{String(elapsedSeconds % 60).padStart(2, "0")}
                </p>
              </div>
            </div>
          )}

          {result && !busy && (
            <>
              {viewingHistory && (
                <div className="cs-glass rounded-xl px-3 py-2 flex items-center justify-between gap-3 flex-wrap">
                  <p style={{ color: "rgba(255,255,255,0.4)" }} className="text-[11px]">
                    Viewing a past package{liveResult ? " — this isn't your current one." : "."}
                  </p>
                  {liveResult ? (
                    <button onClick={backToCurrent} style={{ color: COLORS.teal }} className="cs-brighten font-mono text-[11px] font-semibold shrink-0">
                      Back to current
                    </button>
                  ) : (
                    <span style={{ color: "rgba(255,255,255,0.4)" }} className="text-[11px] shrink-0">Generate a new one to make changes.</span>
                  )}
                </div>
              )}

              <div className="cs-glass rounded-lg px-3 py-2 cs-rise" style={{ borderColor: "rgba(242,120,75,0.4)" }}>
                <p style={{ color: COLORS.orange }} className="text-[11px] leading-relaxed">
                  Check every name, title and figure against the footage before publishing.
                </p>
              </div>

              {result.caution ? (
                <div className="flex items-center gap-2 cs-rise">
                  <span style={{ color: COLORS.orange }} className="font-mono text-[10px] tracking-[0.15em] uppercase">Caution</span>
                  <InfoNote accent={COLORS.orange}>{result.caution}</InfoNote>
                </div>
              ) : null}

              {activeVideo.clipType && (
                <div className="flex items-center gap-2 flex-wrap">
                  <span style={{ backgroundColor: COLORS.tealSoft, color: COLORS.teal }} className="font-mono text-[10px] rounded-full px-2.5 py-1">
                    {activeVideo.clipType}
                  </span>
                  {result.searchCount > 0 && (
                    <span style={{ color: "rgba(255,255,255,0.4)" }} className="font-mono text-[10px]">
                      {result.searchCount} search{result.searchCount === 1 ? "" : "es"} run
                    </span>
                  )}
                  {result.cacheInfo && result.cacheInfo.cacheRead > 0 && (
                    <span style={{ color: COLORS.violet }} className="font-mono text-[10px]" title="This request reused the cached system prompt instead of paying full price for it again.">
                      ⚡ cache hit — {result.cacheInfo.cacheRead.toLocaleString()} tokens reused
                    </span>
                  )}
                  {result.cacheInfo && result.cacheInfo.cacheRead === 0 && result.cacheInfo.cacheWritten > 0 && (
                    <span style={{ color: "rgba(255,255,255,0.4)" }} className="font-mono text-[10px]" title="First request in a while — cache created, next one within ~1h will reuse it.">
                      cache written — ready for next time
                    </span>
                  )}
                </div>
              )}

              {videos.length > 1 && (
                <div className="cs-glass rounded-xl p-3 cs-rise" style={{ borderColor: "rgba(167,139,250,0.4)" }}>
                  <p style={{ color: COLORS.violet }} className="font-mono text-[10px] tracking-[0.15em] uppercase mb-2 flex items-center gap-2">
                    This transcript covers {videos.length} separate videos
                    {result.splitReasoning && <InfoNote accent={COLORS.violet}>{result.splitReasoning}</InfoNote>}
                  </p>
                  <div className="flex gap-1.5 flex-wrap">
                    {videos.map((v, i) => (
                      <button key={i} onClick={() => setSelectedVideoIndex(i)}
                        style={{
                          backgroundColor: i === selectedVideoIndex ? COLORS.violet : "rgba(255,255,255,0.08)",
                          color: i === selectedVideoIndex ? "#fff" : "rgba(255,255,255,0.7)",
                          borderColor: i === selectedVideoIndex ? COLORS.violet : "rgba(255,255,255,0.2)",
                        }}
                        className={`cs-spring rounded-lg border px-3 py-1.5 text-xs font-semibold ${i === selectedVideoIndex ? "" : "cs-tab"}`}>
                        {i + 1}. {v.segmentLabel || `Video ${i + 1}`}
                      </button>
                    ))}
                  </div>
                  {(activeVideo.segmentStartsWith || activeVideo.segmentEndsWith) && (
                    <div className="mt-2">
                      <CopyBlock label="In-point — search this" value={activeVideo.segmentStartsWith} />
                      <CopyBlock label="Out-point — search this" value={activeVideo.segmentEndsWith} />
                    </div>
                  )}
                </div>
              )}

              {videos.length === 1 && result.splitReasoning && (
                // Confirms the split question was actually considered and
                // answered "no" — without this there's no way to tell that
                // from the model never having thought about it at all.
                <div className="flex items-center gap-2 cs-rise">
                  <span style={{ color: "rgba(255,255,255,0.4)" }} className="text-[11px]">Kept as one video</span>
                  <InfoNote accent={"rgba(255,255,255,0.5)"}>{result.splitReasoning}</InfoNote>
                </div>
              )}

              <Section accent={COLORS.violet} title="Headline, nameplates & date" delay={0}
                onRegenerate={() => handleRegenerate("headline")} regenerating={regeneratingSection === "headline"} regenerateError={regenerateErrors.headline} regenerateStatus={regeneratingSection === "headline" ? regenerateStatus : null}
                  history={sectionHistory[historyKey("headline")]} onRestore={(i) => restoreVersion("headline", i)}>
                <CopyBlock label="Headline" value={activeVideo.lowerThirdHeadline} />
                {(activeVideo.nameplates || []).map((np, i) => <NameplateRow key={i} np={np} />)}
                <CopyBlock label="Date" value={activeVideo.eventDate} />
              </Section>

              <Section accent={COLORS.orange} title="Thumbnail" delay={70}
                onRegenerate={() => handleRegenerate("thumbnail")} regenerating={regeneratingSection === "thumbnail"} regenerateError={regenerateErrors.thumbnail} regenerateStatus={regeneratingSection === "thumbnail" ? regenerateStatus : null}
                  history={sectionHistory[historyKey("thumbnail")]} onRestore={(i) => restoreVersion("thumbnail", i)}>
                <CopyBlock label="Text — quote (≤30 chars)" value={activeVideo.thumbnailTextShort} />
                <CopyBlock label="Text — quote, fuller (≤100 chars)" value={activeVideo.thumbnailTextMedium} />
                <CopyBlock label="Text — descriptive (≤70 chars)" value={activeVideo.thumbnailTextLong} />
                <CopyBlock label="Who to feature" value={(activeVideo.thumbnailPeople || []).join(", ")} />
                <CopyBlock label="Visual direction" value={activeVideo.thumbnailVisual} multiline />
              </Section>

              <Section accent={COLORS.teal} title="YouTube metadata" delay={140}
                onRegenerate={() => handleRegenerate("metadata")} regenerating={regeneratingSection === "metadata"} regenerateError={regenerateErrors.metadata} regenerateStatus={regeneratingSection === "metadata" ? regenerateStatus : null}
                  history={sectionHistory[historyKey("metadata")]} onRestore={(i) => restoreVersion("metadata", i)}>
                <CopyBlock label="Title — quote-led" value={activeVideo.titleQuote} />
                <CopyBlock label="Title — descriptive" value={activeVideo.titleDescriptive} />
                <CopyBlock label="Description" value={activeVideo.description} multiline />
                <CopyBlock label="Tags" value={(activeVideo.tags || []).join(", ")} multiline />
              </Section>

              {activeVideo.shorts && activeVideo.shorts.length > 0 && (
                <Section accent={COLORS.violet} title={`Shorts found (${activeVideo.shorts.length})`} delay={210}
                  onRegenerate={() => handleRegenerate("shorts")} regenerating={regeneratingSection === "shorts"} regenerateError={regenerateErrors.shorts} regenerateStatus={regeneratingSection === "shorts" ? regenerateStatus : null}
                  history={sectionHistory[historyKey("shorts")]} onRestore={(i) => restoreVersion("shorts", i)}>
                  <p style={{ color: "rgba(255,255,255,0.4)" }} className="text-[10px] mb-3 leading-relaxed">
                    Search the opening words in your timeline to find the in-point, the closing words for the out-point.
                  </p>
                  {onCreateShortsTask && (
                    <div className="flex items-center justify-between gap-3 mb-3">
                      <p style={{ color: "rgba(255,255,255,0.4)" }} className="text-[10px]">
                        {selectedShortIndices.size > 0 ? `${selectedShortIndices.size} selected` : "Select shorts to hand off as a task"}
                      </p>
                      {selectedShortIndices.size > 0 && (
                        <button onClick={() => setShortsTaskFormOpen(true)}
                          className="cs-glass-cta cs-glass-cta-violet rounded-lg px-3 py-1.5 text-xs font-semibold">
                          Turn {selectedShortIndices.size} into a task
                        </button>
                      )}
                    </div>
                  )}
                  <div className="flex flex-col gap-3">
                    {activeVideo.shorts.map((sh, i) => (
                      <ShortCard key={i} short={sh} index={i} transcript={transcript}
                        selectable={!!onCreateShortsTask} selected={selectedShortIndices.has(i)} onToggleSelected={() => toggleShortSelected(i)} />
                    ))}
                  </div>
                  {shortsTaskFormOpen && (
                    <ShortsToTaskForm
                      shorts={Array.from(selectedShortIndices).sort((a, b) => a - b).map((i) => activeVideo.shorts[i])}
                      videoTitle={activeVideo.titleDescriptive || activeVideo.titleQuote}
                      channelId={taskContext && taskContext.channelId}
                      channelName={taskContext && taskContext.channelName}
                      sourceLink={taskContext && taskContext.links && taskContext.links[0]}
                      channels={channels} profiles={profiles}
                      onCancel={() => setShortsTaskFormOpen(false)}
                      onCreate={async (form) => {
                        await onCreateShortsTask({
                          shorts: Array.from(selectedShortIndices).sort((a, b) => a - b).map((i) => activeVideo.shorts[i]),
                          videoTitle: activeVideo.titleDescriptive || activeVideo.titleQuote,
                          sourceLink: taskContext && taskContext.links && taskContext.links[0],
                          channelId: taskContext && taskContext.channelId,
                          ...form,
                        });
                        setSelectedShortIndices(new Set());
                        setShortsTaskFormOpen(false);
                      }}
                    />
                  )}
                </Section>
              )}

              {activeVideo.shorts && activeVideo.shorts.length === 0 && (
                <Section accent={COLORS.violet} title="Shorts" delay={210}
                  onRegenerate={() => handleRegenerate("shorts")} regenerating={regeneratingSection === "shorts"} regenerateError={regenerateErrors.shorts} regenerateStatus={regeneratingSection === "shorts" ? regenerateStatus : null}
                  history={sectionHistory[historyKey("shorts")]} onRestore={(i) => restoreVersion("shorts", i)}>
                  <p style={{ color: "rgba(255,255,255,0.4)" }} className="text-xs">No segment in this clip stands alone as a short.</p>
                </Section>
              )}

              {activeVideo.adSuitability && (activeVideo.adSuitability.selections || []).length > 0 && (
                <Section accent={COLORS.orange} title="Ad suitability — what to tick" delay={280}
                  onRegenerate={() => handleRegenerate("adSuitability")} regenerating={regeneratingSection === "adSuitability"} regenerateError={regenerateErrors.adSuitability} regenerateStatus={regeneratingSection === "adSuitability" ? regenerateStatus : null}
                  history={sectionHistory[historyKey("adSuitability")]} onRestore={(i) => restoreVersion("adSuitability", i)}>
                  {activeVideo.adSuitability.overall && (
                    <p style={{ color: "rgba(255,255,255,0.6)" }} className="text-xs mb-3 leading-relaxed">{activeVideo.adSuitability.overall}</p>
                  )}
                  {(() => {
                    const flagged = activeVideo.adSuitability.selections.filter(
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
                          <div key={i} style={{ background: "rgba(255,255,255,0.06)", border: "0.5px solid rgba(242,120,75,0.4)" }} className="rounded-lg px-3 py-2">
                            <div className="flex items-center gap-2">
                              <p style={{ color: "#fff" }} className="text-[11px] flex-1 leading-relaxed">{sel.question}</p>
                              <span style={{ backgroundColor: COLORS.orangeSoft, color: COLORS.orange }}
                                className="font-mono text-[10px] rounded-full px-2 py-0.5 shrink-0">
                                {sel.answer}
                              </span>
                            </div>
                            {sel.reason && (
                              <p style={{ color: "rgba(255,255,255,0.4)" }} className="text-[10px] mt-1 leading-relaxed">{sel.reason}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                  {(activeVideo.adSuitability.unjudgeable || []).length > 0 && (
                    <p style={{ color: COLORS.orange }} className="text-[11px] mt-3 leading-relaxed">
                      Judge these yourself from the footage: {activeVideo.adSuitability.unjudgeable.join("; ")}
                    </p>
                  )}
                </Section>
              )}

              <Section accent={"rgba(255,255,255,0.4)"} title="Source" delay={350}>
                {taskContext && taskContext.event && taskContext.event.source ? (
                  <CopyBlock label="Source" value={taskContext.event.source} multiline />
                ) : (
                  <p style={{ color: "rgba(255,255,255,0.4)" }} className="text-xs italic">
                    {taskId
                      ? "This task has no Source set — add one from Tasks → Edit → Hearing record."
                      : "Link a task with a Source filled in to show it here."}
                  </p>
                )}
              </Section>

              {result.parseFailed && (
                <p style={{ color: "rgba(255,255,255,0.4)" }} className="text-[11px] leading-relaxed">
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

// Turns the shorts an editor picked out into a real task for anyone in the
// same channel — a reference thumbnail is required specifically so whoever
// gets assigned can tell which clip this is at a glance, without needing
// Clip Studio access themselves.
function ShortsToTaskForm({ shorts, videoTitle, channelId, channelName, sourceLink, channels, profiles, onCancel, onCreate }) {
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [assignedToUid, setAssignedToUid] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const channel = (channels || []).find((c) => c.id === channelId);
  const channelMembers = channel ? (channel.memberUids || []).map((uidVal) => ({ uid: uidVal, name: displayNameFor(uidVal, profiles) })) : [];

  const pickImage = (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    setImageFile(f);
    const reader = new FileReader();
    reader.onload = () => setImagePreview(reader.result);
    reader.readAsDataURL(f);
  };

  const submit = async () => {
    if (!imageFile) { setErr("A reference thumbnail is required — this is how whoever picks it up will know which clip it is."); return; }
    if (!assignedToUid) { setErr("Pick who this goes to."); return; }
    setErr(""); setBusy(true);
    try {
      await onCreate({ referenceImageFile: imageFile, assignedToUid, dueDate: dueDate || null });
    } catch (e) {
      setErr("Couldn't create the task — try again.");
      setBusy(false);
    }
  };

  return (
    <div className="cs-glass rounded-xl p-4 mt-3" style={{ borderColor: "rgba(167,139,250,0.4)" }}>
      <p style={{ color: COLORS.violet }} className="font-mono text-[10px] tracking-[0.15em] uppercase mb-3">
        {shorts.length === 1 ? "Turn this short into a task" : `Turn these ${shorts.length} shorts into one task`}
      </p>

      <div className="flex flex-col gap-1 mb-3">
        {shorts.map((s, i) => (
          <p key={i} style={{ color: "rgba(255,255,255,0.6)" }} className="text-xs truncate">• {s.title || "Untitled short"}</p>
        ))}
      </div>

      <p style={{ color: "rgba(255,255,255,0.4)" }} className="font-mono text-[10px] tracking-[0.15em] uppercase mb-1.5">Reference thumbnail — required</p>
      <p style={{ color: "rgba(255,255,255,0.4)" }} className="text-[10px] mb-2 leading-relaxed">
        A quick screenshot from the footage — this is how whoever gets this task will recognise which clip it is at a glance.
      </p>
      {imagePreview ? (
        <div className="flex items-center gap-2 mb-3">
          <img src={imagePreview} alt="" className="w-16 h-16 object-cover rounded-lg" style={{ borderColor: "rgba(255,255,255,0.2)" }} />
          <label style={{ color: COLORS.violet }} className="cs-brighten text-xs font-semibold cursor-pointer">
            Change image
            <input type="file" accept="image/*" onChange={pickImage} className="hidden" />
          </label>
        </div>
      ) : (
        <label style={{ borderColor: "rgba(255,255,255,0.2)", color: "rgba(255,255,255,0.6)" }}
          className="cs-dropzone flex items-center justify-center rounded-lg border border-dashed py-3 text-xs cursor-pointer mb-3">
          Choose an image
          <input type="file" accept="image/*" onChange={pickImage} className="hidden" />
        </label>
      )}

      <p style={{ color: "rgba(255,255,255,0.4)" }} className="font-mono text-[10px] tracking-[0.15em] uppercase mb-1.5">Assign to — {channelName || "this channel"}</p>
      <select value={assignedToUid} onChange={(e) => setAssignedToUid(e.target.value)}
        style={{ backgroundColor: "rgba(255,255,255,0.08)", borderColor: "rgba(255,255,255,0.2)", color: "#fff" }}
        className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 mb-3">
        <option value="">Choose an editor</option>
        {channelMembers.map((m) => <option key={m.uid} value={m.uid}>{m.name}</option>)}
      </select>

      <p style={{ color: "rgba(255,255,255,0.4)" }} className="font-mono text-[10px] tracking-[0.15em] uppercase mb-1.5">Due date — optional</p>
      <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)}
        style={{ backgroundColor: "rgba(255,255,255,0.08)", borderColor: "rgba(255,255,255,0.2)", color: "#fff" }}
        className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 mb-3" />

      {!sourceLink && (
        <p style={{ color: COLORS.orange }} className="text-[10px] mb-3 leading-relaxed">
          This task has no source footage link attached — add one on the original task first, or whoever picks this up won't have a way to reach the footage.
        </p>
      )}
      {err && <p style={{ color: COLORS.danger }} className="text-xs mb-3">{err}</p>}

      <div className="flex gap-2">
        <button onClick={onCancel} disabled={busy}
          className="cs-spring cs-glass-btn flex-1 py-2 text-xs font-semibold disabled:opacity-50">
          Cancel
        </button>
        <button onClick={submit} disabled={busy} style={{ opacity: busy ? 0.6 : 1 }}
          className="cs-glass-cta cs-glass-cta-violet flex-1 rounded-lg py-2 text-xs font-bold disabled:cursor-not-allowed">
          {busy ? "Creating…" : "Create task"}
        </button>
      </div>
    </div>
  );
}

function ShortCard({ short, index, transcript, selectable, selected, onToggleSelected }) {
  const [open, setOpen] = useState(index === 0);
  // This does a real search through the whole transcript — on a long
  // hearing that's genuine synchronous work. Recomputing it on every
  // render (including just opening/closing this card) was blocking the
  // click from visually registering right away, which is exactly what
  // "the button animates but doesn't open" looks like from the outside.
  const span = useMemo(() => measureSpan(transcript, short.startsWith, short.endsWith), [transcript, short.startsWith, short.endsWith]);
  // Character span is the primary, verified signal; timecode duration (when
  // present) is shown alongside it but character count is what's measured
  // against real text, not estimated.
  const timecode = span.timecode || short.timecode;
  const secsFromTimecode = parseTimecodeSeconds(timecode);
  const tooLong = span.chars != null ? span.chars > 1400 : (secsFromTimecode != null && secsFromTimecode > 60);
  const overSoftTarget = span.chars != null && span.chars > 700 && span.chars <= 1400;

  return (
    <div className="cs-glass cs-glass-hover cs-spring rounded-xl p-3" style={{ borderColor: tooLong ? COLORS.orange : selected ? COLORS.violet : "rgba(255,255,255,0.2)" }}>
      <div className="flex items-center gap-2">
        {selectable && (
          <input type="checkbox" checked={!!selected} onChange={onToggleSelected} aria-label={`Select short ${index + 1}`}
            className="shrink-0" style={{ accentColor: COLORS.violet, width: 15, height: 15 }} />
        )}
        <button onClick={() => setOpen((o) => !o)} className="flex-1 flex items-center gap-2 text-left min-w-0">
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
        <span style={{ color: "#fff" }} className="text-xs flex-1 truncate">{short.title}</span>
        {span.chars != null ? (
          <span style={{ color: tooLong ? COLORS.orange : overSoftTarget ? "rgba(255,255,255,0.6)" : "rgba(255,255,255,0.4)" }} className="font-mono text-[10px] shrink-0">
            {span.chars} chars
          </span>
        ) : secsFromTimecode != null ? (
          <span style={{ color: tooLong ? COLORS.orange : "rgba(255,255,255,0.4)" }} className="font-mono text-[10px] shrink-0">
            ~{secsFromTimecode}s
          </span>
        ) : null}
        <span style={{ color: COLORS.teal }} className="font-mono text-[10px] shrink-0">{open ? "Hide" : "Open"}</span>
        </button>
      </div>

      {open && (
        <div className="mt-3">
          {timecode ? (
            <p style={{ color: COLORS.teal }} className="font-mono text-[11px] mb-2">
              {timecode}{span.timecode ? "" : short.timecode ? " (unverified)" : ""}
            </p>
          ) : null}
          {short.why && (
            <p style={{ color: "rgba(255,255,255,0.4)" }} className="text-[11px] mb-3 leading-relaxed">{short.why}</p>
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
          {short.adSuitability && (short.adSuitability.selections || []).length > 0 && (() => {
            const flagged = short.adSuitability.selections.filter((sel) => !/^none$/i.test((sel.answer || "").trim()));
            return (
              <div className="mt-2">
                <p style={{ color: "rgba(255,255,255,0.4)" }} className="font-mono text-[10px] tracking-[0.15em] uppercase mb-1.5">This short's ad suitability</p>
                {flagged.length === 0 ? (
                  <p style={{ color: COLORS.teal }} className="text-xs">Nothing flagged — select "None" across every category.</p>
                ) : (
                  <div className="flex flex-col gap-1">
                    {flagged.map((sel, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <span style={{ color: "#fff" }} className="text-[11px] flex-1">{sel.question}</span>
                        <span style={{ backgroundColor: COLORS.orangeSoft, color: COLORS.orange }} className="font-mono text-[10px] rounded-full px-2 py-0.5 shrink-0">{sel.answer}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}

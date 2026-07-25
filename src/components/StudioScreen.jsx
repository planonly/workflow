import React, { useState, useRef } from "react";
import { COLORS } from "../lib/core";
import { HomeIcon, X, Plus } from "./Icon";
import { getKeys, generateMetadata, synthesiseVoice, buildPrompt } from "../lib/ai";

const EVENT_TYPES = [
  "Committee hearing", "Floor debate", "Testimony", "Press gaggle",
  "Markup", "Confirmation hearing", "Press conference", "Other",
];

function Label({ children }) {
  return (
    <p style={{ color: COLORS.textFaint }} className="font-mono text-[10px] tracking-[0.15em] uppercase mb-1.5">
      {children}
    </p>
  );
}

function CopyBlock({ label, value, multiline }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch (e) { /* clipboard unavailable */ }
  };
  return (
    <div className="mb-3">
      <div className="flex items-center justify-between mb-1.5">
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

export default function StudioScreen({ channels, onBack }) {
  const [eventType, setEventType] = useState("Committee hearing");
  const [body, setBody] = useState("");
  const [date, setDate] = useState("");
  const [subject, setSubject] = useState("");
  const [hook, setHook] = useState("");
  const [format, setFormat] = useState("long");
  const [channel, setChannel] = useState("");
  const [speakers, setSpeakers] = useState([{ name: "", role: "" }]);
  const [transcript, setTranscript] = useState("");

  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [refine, setRefine] = useState("");
  const [history, setHistory] = useState([]);

  const [audioUrl, setAudioUrl] = useState(null);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceError, setVoiceError] = useState("");
  const audioBlobRef = useRef(null);

  const keys = getKeys();
  const missingKey = !keys.anthropic;

  const setSpeaker = (i, field, val) =>
    setSpeakers((s) => s.map((sp, idx) => (idx === i ? { ...sp, [field]: val } : sp)));
  const addSpeaker = () => setSpeakers((s) => [...s, { name: "", role: "" }]);
  const removeSpeaker = (i) => setSpeakers((s) => (s.length === 1 ? s : s.filter((_, idx) => idx !== i)));

  const context = { eventType, body, date, subject, hook, format, channel, speakers };

  const run = async (userMessage, priorHistory) => {
    setBusy(true); setError("");
    try {
      const nextHistory = [...priorHistory, { role: "user", content: userMessage }];
      const out = await generateMetadata({ history: nextHistory, apiKey: keys.anthropic });
      setResult(out);
      setHistory([...nextHistory, { role: "assistant", content: out.raw || "" }]);
      setAudioUrl(null);
    } catch (e) {
      setError(e.message || "Something went wrong.");
    }
    setBusy(false);
  };

  const generate = () => {
    if (!transcript.trim()) return;
    setHistory([]);
    run(buildPrompt(transcript, context), []);
  };

  const sendRefinement = () => {
    if (!refine.trim() || !history.length) return;
    const msg = refine.trim();
    setRefine("");
    run(msg, history);
  };

  const makeVoiceover = async () => {
    if (!result || !result.commentary) return;
    setVoiceBusy(true); setVoiceError("");
    try {
      const blob = await synthesiseVoice({ text: result.commentary, apiKey: keys.eleven, voiceId: keys.voiceId });
      audioBlobRef.current = blob;
      setAudioUrl(URL.createObjectURL(blob));
    } catch (e) {
      setVoiceError(e.message || "Voiceover failed.");
    }
    setVoiceBusy(false);
  };

  const downloadAudio = () => {
    if (!audioBlobRef.current) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(audioBlobRef.current);
    a.download = "commentary.mp3";
    a.click();
  };

  const field = {
    backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, color: COLORS.textPrimary,
  };
  const fieldCls = "w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2";

  return (
    <div className="flex-1 flex flex-col max-w-6xl w-full mx-auto px-6 py-8 sm:py-10 overflow-y-auto fade-in">
      <div className="flex items-center justify-between mb-2">
        <h2 style={{ color: COLORS.textPrimary }} className="text-2xl sm:text-3xl font-bold">Clip studio</h2>
        <button onClick={onBack} aria-label="Home" style={{ borderColor: COLORS.border, color: COLORS.textMuted }}
          className="rounded-full border p-2 hover:opacity-80 transition-opacity"><HomeIcon size={18} /></button>
      </div>
      <p style={{ color: COLORS.textFaint }} className="text-sm mb-6">
        The more context you give, the less it has to guess — and the less it can get wrong.
      </p>

      {missingKey && (
        <div style={{ backgroundColor: COLORS.orangeSoft, borderColor: COLORS.orange }} className="rounded-xl border px-4 py-3 mb-5">
          <p style={{ color: COLORS.orange }} className="text-sm">Add your API keys in Profile before using this.</p>
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-6">
        {/* ---------------- Input ---------------- */}
        <div className="flex flex-col gap-4">
          <div style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border }} className="rounded-2xl border p-5">
            <p style={{ color: COLORS.textFaint }} className="font-mono text-[11px] tracking-[0.2em] uppercase mb-4">The event</p>

            <div className="grid sm:grid-cols-2 gap-3 mb-3">
              <div>
                <Label>Type</Label>
                <select value={eventType} onChange={(e) => setEventType(e.target.value)} style={field} className={fieldCls}>
                  {EVENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <Label>Date</Label>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={field} className={fieldCls} />
              </div>
            </div>

            <div className="mb-3">
              <Label>Committee or chamber</Label>
              <input value={body} onChange={(e) => setBody(e.target.value)}
                placeholder="e.g. Senate Judiciary Committee" style={field} className={fieldCls} />
            </div>

            <div className="mb-3">
              <Label>Subject</Label>
              <input value={subject} onChange={(e) => setSubject(e.target.value)}
                placeholder="What the exchange is about" style={field} className={fieldCls} />
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <Label>Format</Label>
                <div className="flex gap-1.5">
                  {[["long", "Long-form"], ["short", "Short"]].map(([val, lbl]) => (
                    <button key={val} onClick={() => setFormat(val)}
                      style={{
                        backgroundColor: format === val ? (val === "short" ? COLORS.orangeSoft : COLORS.tealSoft) : COLORS.bgElevated,
                        color: format === val ? (val === "short" ? COLORS.orange : COLORS.teal) : COLORS.textMuted,
                        borderColor: format === val ? (val === "short" ? COLORS.orange : COLORS.teal) : COLORS.border,
                      }}
                      className="flex-1 rounded-lg border px-2 py-2 text-xs font-semibold transition-all">
                      {lbl}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <Label>Channel</Label>
                <select value={channel} onChange={(e) => setChannel(e.target.value)} style={field} className={fieldCls}>
                  <option value="">Not specified</option>
                  {(channels || []).map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
                </select>
              </div>
            </div>
          </div>

          <div style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border }} className="rounded-2xl border p-5">
            <div className="flex items-center justify-between mb-1">
              <p style={{ color: COLORS.textFaint }} className="font-mono text-[11px] tracking-[0.2em] uppercase">Speakers</p>
              <button onClick={addSpeaker} style={{ color: COLORS.teal }} className="font-mono text-[10px] hover:opacity-80 flex items-center gap-1">
                <Plus size={12} /> Add
              </button>
            </div>
            <p style={{ color: COLORS.textFaint }} className="text-[11px] mb-3 leading-relaxed">
              Give full names and titles — it uses these verbatim instead of guessing from the transcript.
            </p>
            <div className="flex flex-col gap-2">
              {speakers.map((sp, i) => (
                <div key={i} className="flex gap-2">
                  <input value={sp.name} onChange={(e) => setSpeaker(i, "name", e.target.value)}
                    placeholder="Sen. Jane Doe" style={field} className={`${fieldCls} flex-1`} />
                  <input value={sp.role} onChange={(e) => setSpeaker(i, "role", e.target.value)}
                    placeholder="R-TX, Chair" style={field} className={`${fieldCls} flex-1`} />
                  {speakers.length > 1 && (
                    <button onClick={() => removeSpeaker(i)} style={{ color: COLORS.danger }} className="p-2 hover:opacity-70 shrink-0">
                      <X size={14} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border }} className="rounded-2xl border p-5">
            <Label>Why you cut this clip</Label>
            <textarea value={hook} onChange={(e) => setHook(e.target.value)} rows={2}
              placeholder="The newsworthy bit — what made you pick this moment"
              style={field} className={`${fieldCls} leading-relaxed mb-4`} />

            <Label>Transcript</Label>
            <textarea value={transcript} onChange={(e) => setTranscript(e.target.value)} rows={12}
              placeholder={"SEN. DOE: The question before this committee is…\nWITNESS: I'd answer that by saying…"}
              style={field} className={`${fieldCls} leading-relaxed`} />

            <button onClick={generate} disabled={busy || !transcript.trim() || missingKey}
              style={{ backgroundColor: COLORS.teal, color: "#04211D", opacity: (busy || !transcript.trim() || missingKey) ? 0.4 : 1 }}
              className="w-full rounded-xl py-3 text-sm font-bold hover:brightness-105 transition-all disabled:cursor-not-allowed mt-4">
              {busy ? "Working…" : "Generate"}
            </button>
          </div>
        </div>

        {/* ---------------- Output ---------------- */}
        <div className="flex flex-col gap-4">
          {error && (
            <div style={{ backgroundColor: "rgba(225,90,90,0.12)", borderColor: COLORS.danger }} className="rounded-xl border px-4 py-3">
              <p style={{ color: COLORS.danger }} className="text-sm">{error}</p>
            </div>
          )}

          {!result && !busy && !error && (
            <div style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border }}
              className="rounded-2xl border p-8 text-center">
              <p style={{ color: COLORS.textMuted }} className="text-sm">Results appear here.</p>
              <p style={{ color: COLORS.textFaint }} className="text-xs mt-1.5 leading-relaxed">
                Fill in what you know, paste the transcript, and generate.
              </p>
            </div>
          )}

          {busy && !result && (
            <div style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border }} className="rounded-2xl border p-8 text-center">
              <p style={{ color: COLORS.textMuted }} className="text-sm">Reading the transcript…</p>
            </div>
          )}

          {result && (
            <div style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border }} className="rounded-2xl border p-5">
              <div style={{ backgroundColor: COLORS.orangeSoft }} className="rounded-lg px-3 py-2 mb-4">
                <p style={{ color: COLORS.orange }} className="text-[11px] leading-relaxed">
                  Check every fact against the footage before publishing.
                </p>
              </div>

              {result.caution ? (
                <div style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.orange }} className="rounded-lg border px-3 py-2 mb-4">
                  <p style={{ color: COLORS.textMuted }} className="text-xs leading-relaxed">{result.caution}</p>
                </div>
              ) : null}

              {(result.titles || []).map((t, i) => (
                <CopyBlock key={i} label={`Title ${i + 1}`} value={t} />
              ))}
              {result.description && <CopyBlock label="Description" value={result.description} multiline />}
              {result.tags && result.tags.length > 0 && <CopyBlock label="Tags" value={result.tags.join(", ")} multiline />}

              {result.commentary && (
                <>
                  <CopyBlock label="Commentary script" value={result.commentary} multiline />
                  <div className="flex items-center gap-2 flex-wrap">
                    <button onClick={makeVoiceover} disabled={voiceBusy}
                      style={{ backgroundColor: COLORS.tealSoft, color: COLORS.teal, opacity: voiceBusy ? 0.5 : 1 }}
                      className="rounded-lg px-3 py-2 text-xs font-semibold hover:brightness-110 transition-all">
                      {voiceBusy ? "Generating voice…" : "Generate voiceover"}
                    </button>
                    {audioUrl && (
                      <button onClick={downloadAudio} style={{ borderColor: COLORS.border, color: COLORS.textMuted }}
                        className="rounded-lg border px-3 py-2 text-xs font-semibold hover:opacity-80">
                        Download mp3
                      </button>
                    )}
                  </div>
                  {voiceError && <p style={{ color: COLORS.danger }} className="text-xs mt-2">{voiceError}</p>}
                  {audioUrl && <audio controls src={audioUrl} className="w-full mt-3" />}
                </>
              )}
            </div>
          )}

          {result && (
            <div className="flex gap-2">
              <input value={refine} onChange={(e) => setRefine(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendRefinement()}
                placeholder="Ask for changes — shorter title, different angle…"
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

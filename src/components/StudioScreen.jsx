import React, { useState, useRef } from "react";
import { COLORS } from "../lib/core";
import { HomeIcon, X } from "./Icon";
import { getKeys, generateMetadata, synthesiseVoice } from "../lib/ai";

function Field({ label, value, multiline }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch (e) { /* clipboard unavailable */ }
  };
  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-1.5">
        <p style={{ color: COLORS.textFaint }} className="font-mono text-[10px] tracking-[0.15em] uppercase">{label}</p>
        <button onClick={copy} style={{ color: COLORS.teal }} className="font-mono text-[10px] hover:opacity-80">
          {copied ? "Copied ✓" : "Copy"}
        </button>
      </div>
      <div style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, color: COLORS.textPrimary }}
        className={`rounded-lg border px-3 py-2.5 text-sm ${multiline ? "whitespace-pre-wrap leading-relaxed" : "truncate"}`}>
        {value}
      </div>
    </div>
  );
}

export default function StudioScreen({ onBack }) {
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

  const run = async (userMessage, priorHistory) => {
    setBusy(true); setError("");
    try {
      const nextHistory = [...priorHistory, { role: "user", content: userMessage }];
      const out = await generateMetadata({ transcript, history: nextHistory, apiKey: keys.anthropic });
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
    run(`Transcript of the clip:\n\n${transcript.trim()}`, []);
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

  const missingKey = !keys.anthropic;

  return (
    <div className="flex-1 flex flex-col max-w-3xl w-full mx-auto px-6 py-8 sm:py-10 overflow-y-auto fade-in">
      <div className="flex items-center justify-between mb-6">
        <h2 style={{ color: COLORS.textPrimary }} className="text-2xl sm:text-3xl font-bold">Clip studio</h2>
        <button onClick={onBack} aria-label="Home" style={{ borderColor: COLORS.border, color: COLORS.textMuted }}
          className="rounded-full border p-2 hover:opacity-80 transition-opacity"><HomeIcon size={18} /></button>
      </div>

      {missingKey && (
        <div style={{ backgroundColor: COLORS.orangeSoft, borderColor: COLORS.orange }} className="rounded-xl border px-4 py-3 mb-5">
          <p style={{ color: COLORS.orange }} className="text-sm">
            Add your API keys in Profile before using this.
          </p>
        </div>
      )}

      <p style={{ color: COLORS.textFaint }} className="font-mono text-[11px] tracking-[0.2em] uppercase mb-2">Transcript</p>
      <textarea
        value={transcript}
        onChange={(e) => setTranscript(e.target.value)}
        rows={10}
        placeholder={"Paste the clip transcript here, with speaker labels.\n\nSEN. SMITH: The question before this committee is…\nWITNESS: I'd answer that by saying…"}
        style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, color: COLORS.textPrimary }}
        className="w-full rounded-xl border px-4 py-3 text-sm outline-none focus:ring-2 mb-3 leading-relaxed"
      />

      <button onClick={generate} disabled={busy || !transcript.trim() || missingKey}
        style={{ backgroundColor: COLORS.teal, color: "#04211D", opacity: (busy || !transcript.trim() || missingKey) ? 0.4 : 1 }}
        className="rounded-xl py-3 text-sm font-bold hover:brightness-105 transition-all disabled:cursor-not-allowed mb-5">
        {busy ? "Working…" : "Generate metadata and commentary"}
      </button>

      {error && (
        <div style={{ backgroundColor: "rgba(225,90,90,0.12)", borderColor: COLORS.danger }} className="rounded-xl border px-4 py-3 mb-5">
          <p style={{ color: COLORS.danger }} className="text-sm">{error}</p>
        </div>
      )}

      {result && (
        <div style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border }} className="rounded-2xl border p-5 mb-5">
          <div style={{ backgroundColor: COLORS.orangeSoft }} className="rounded-lg px-3 py-2 mb-4">
            <p style={{ color: COLORS.orange }} className="text-[11px] leading-relaxed">
              Check every fact against the footage before publishing. This is generated text and can be confidently wrong.
            </p>
          </div>

          {result.caution ? (
            <div style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.orange }} className="rounded-lg border px-3 py-2 mb-4">
              <p style={{ color: COLORS.textMuted }} className="text-xs leading-relaxed">{result.caution}</p>
            </div>
          ) : null}

          {result.titles && result.titles.length > 0 && (
            <div className="mb-4">
              <p style={{ color: COLORS.textFaint }} className="font-mono text-[10px] tracking-[0.15em] uppercase mb-1.5">Title options</p>
              {result.titles.map((t, i) => <Field key={i} label={`Option ${i + 1}`} value={t} />)}
            </div>
          )}

          {result.description && <Field label="Description" value={result.description} multiline />}
          {result.tags && result.tags.length > 0 && <Field label="Tags" value={result.tags.join(", ")} multiline />}

          {result.commentary && (
            <div>
              <Field label="Commentary script" value={result.commentary} multiline />
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
            </div>
          )}
        </div>
      )}

      {result && (
        <div className="flex gap-2">
          <input value={refine} onChange={(e) => setRefine(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendRefinement()}
            placeholder="Ask for changes — shorter title, different angle, more detail…"
            style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, color: COLORS.textPrimary }}
            className="flex-1 rounded-xl border px-4 py-2.5 text-sm outline-none focus:ring-2" />
          <button onClick={sendRefinement} disabled={busy || !refine.trim()}
            style={{ backgroundColor: COLORS.teal, color: "#04211D", opacity: (busy || !refine.trim()) ? 0.4 : 1 }}
            className="rounded-xl px-4 py-2.5 text-sm font-bold">
            Send
          </button>
        </div>
      )}
    </div>
  );
}

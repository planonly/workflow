import React, { useState, useEffect } from "react";
import { COLORS } from "../lib/core";
import firebase from "../lib/firebase";

// A short, representative slice of an edit — deliberately generic rather than
// the team's real step list, since this screen is visible before sign-in.
const DEMO_STEPS = [
  { label: "Cut",       time: "12:04" },
  { label: "Transcribe", time: "04:38" },
  { label: "Color",     time: "08:15" },
  { label: "Mix",       time: "05:52" },
  { label: "Export",    time: "03:20" },
];

// Sign-in only. Accounts are created by an admin from the Profile screen —
// there's no self-serve signup path in an internal tool.
export default function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [playhead, setPlayhead] = useState(2);

  // The playhead sweeps the timeline on a slow loop — ambient, not attention-
  // seeking. Frozen entirely when the visitor prefers reduced motion.
  useEffect(() => {
    const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;
    const id = setInterval(() => setPlayhead((p) => (p + 1) % (DEMO_STEPS.length + 1)), 2200);
    return () => clearInterval(id);
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setError(""); setBusy(true); setResetSent(false);
    try {
      await firebase.auth().signInWithEmailAndPassword(email.trim(), password);
    } catch (err) {
      setError((err && err.message ? err.message : "Something went wrong").replace("Firebase: ", ""));
    }
    setBusy(false);
  };

  const forgotPassword = async () => {
    if (!email.trim()) { setError("Enter your email above first, then tap this again."); return; }
    setError("");
    try {
      await firebase.auth().sendPasswordResetEmail(email.trim());
      setResetSent(true);
    } catch (err) {
      setError((err && err.message ? err.message : "Couldn't send reset email").replace("Firebase: ", ""));
    }
  };

  const inputStyle = {
    backgroundColor: COLORS.bgElevated,
    borderColor: COLORS.border,
    color: COLORS.textPrimary,
  };

  return (
    <div style={{ backgroundColor: COLORS.bg }} className="min-h-screen w-full">
      <style>{`
        @keyframes wc-sweep { 0%,100% { opacity: .55 } 50% { opacity: 1 } }
        .wc-live { animation: wc-sweep 2.2s ease-in-out infinite; }
        .wc-in { animation: fadeIn .5s ease-out both; }
        .wc-in-2 { animation: fadeIn .5s ease-out .12s both; }
        .wc-field:focus { outline: none; box-shadow: 0 0 0 2px ${COLORS.teal}55; border-color: ${COLORS.teal}; }
        .wc-link:focus-visible { outline: 2px solid ${COLORS.teal}; outline-offset: 3px; border-radius: 4px; }
        @media (prefers-reduced-motion: reduce) { .wc-live { animation: none; } }
      `}</style>

      <div className="min-h-screen w-full max-w-6xl mx-auto px-6 py-10 flex flex-col lg:flex-row lg:items-center lg:gap-20">

        {/* Identity — the timeline is the signature: it's the same instrument
            you spend the day looking at once you're inside. */}
        <div className="wc-in flex-1 lg:max-w-xl">
          <p style={{ color: COLORS.textFaint }} className="font-mono text-[11px] tracking-[0.28em] uppercase mb-6">
            Workflow Controller
          </p>

          <h1
            style={{ color: COLORS.textPrimary, letterSpacing: "-0.035em", lineHeight: 1.02 }}
            className="text-5xl sm:text-6xl lg:text-7xl font-bold mb-5"
          >
            Every step,<br />
            <span style={{ color: COLORS.teal }}>on the clock.</span>
          </h1>

          <p style={{ color: COLORS.textMuted }} className="text-base sm:text-lg leading-relaxed mb-12 max-w-md">
            One step at a time, timed as you go — so the team always knows what's
            running, who's on it, and where the hours went.
          </p>

          {/* Timeline */}
          <div className="max-w-md">
            <div className="relative mb-3" aria-hidden="true">
              <div
                className="absolute -top-2.5 transition-all duration-700 ease-out"
                style={{
                  left: `${((Math.min(playhead, DEMO_STEPS.length - 1) + 0.5) / DEMO_STEPS.length) * 100}%`,
                  transform: "translateX(-50%)",
                  width: 0, height: 0,
                  borderLeft: "5px solid transparent",
                  borderRight: "5px solid transparent",
                  borderTop: `6px solid ${COLORS.teal}`,
                }}
              />
              <div className="flex gap-1.5">
                {DEMO_STEPS.map((_, i) => (
                  <div
                    key={i}
                    className={`h-1.5 flex-1 rounded-full transition-colors duration-500 ${i === playhead ? "wc-live" : ""}`}
                    style={{ backgroundColor: i <= playhead ? COLORS.teal : COLORS.border }}
                  />
                ))}
              </div>
            </div>

            <ul className="flex flex-col">
              {DEMO_STEPS.map((s, i) => {
                const done = i < playhead;
                const current = i === playhead;
                return (
                  <li
                    key={s.label}
                    style={{ borderColor: COLORS.border }}
                    className="flex items-center gap-3 border-b last:border-b-0 py-2.5"
                  >
                    <span style={{ color: COLORS.textFaint }} className="font-mono text-[11px] w-6 shrink-0">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span
                      className="text-sm flex-1 transition-colors duration-500"
                      style={{ color: current ? COLORS.textPrimary : done ? COLORS.textMuted : COLORS.textFaint }}
                    >
                      {s.label}
                    </span>
                    {current ? (
                      <span className="flex items-center gap-1.5 shrink-0">
                        <span
                          className="wc-live inline-block"
                          style={{ width: 6, height: 6, borderRadius: 9999, backgroundColor: COLORS.orange }}
                        />
                        <span style={{ color: COLORS.orange }} className="font-mono text-[11px]">running</span>
                      </span>
                    ) : (
                      <span
                        className="font-mono text-[11px] shrink-0 transition-colors duration-500"
                        style={{ color: done ? COLORS.orange : COLORS.textFaint }}
                      >
                        {done ? s.time : "—"}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>

        {/* Sign in */}
        <div className="wc-in-2 w-full lg:w-[380px] shrink-0 mt-14 lg:mt-0">
          <div
            style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border }}
            className="rounded-2xl border p-7"
          >
            <h2 style={{ color: COLORS.textPrimary }} className="text-xl font-bold mb-6">Sign in</h2>

            <form onSubmit={submit} className="flex flex-col gap-3">
              <label className="flex flex-col gap-1.5">
                <span style={{ color: COLORS.textFaint }} className="font-mono text-[10px] tracking-[0.15em] uppercase">Email</span>
                <input
                  type="email" required autoComplete="email"
                  value={email} onChange={(e) => setEmail(e.target.value)}
                  style={inputStyle}
                  className="wc-field rounded-xl border px-4 py-3 text-sm"
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span style={{ color: COLORS.textFaint }} className="font-mono text-[10px] tracking-[0.15em] uppercase">Password</span>
                <input
                  type="password" required autoComplete="current-password"
                  value={password} onChange={(e) => setPassword(e.target.value)}
                  style={inputStyle}
                  className="wc-field rounded-xl border px-4 py-3 text-sm"
                />
              </label>

              {error && <p style={{ color: COLORS.danger }} className="text-xs leading-relaxed">{error}</p>}
              {resetSent && <p style={{ color: COLORS.teal }} className="text-xs">Reset email sent — check your inbox.</p>}

              <button
                type="submit" disabled={busy}
                style={{ backgroundColor: COLORS.teal, color: "#04211D", opacity: busy ? 0.6 : 1 }}
                className="wc-link rounded-xl py-3 text-sm font-bold mt-2 transition-all active:scale-[0.98] hover:brightness-105"
              >
                {busy ? "Signing in…" : "Sign in"}
              </button>
            </form>

            <button
              onClick={forgotPassword}
              style={{ color: COLORS.textMuted }}
              className="wc-link text-xs mt-4 w-full text-center hover:opacity-80"
            >
              Forgot password?
            </button>
          </div>

          <p style={{ color: COLORS.textFaint }} className="text-[11px] mt-5 text-center leading-relaxed">
            Need an account? Ask your admin to create one.
          </p>
        </div>
      </div>
    </div>
  );
}

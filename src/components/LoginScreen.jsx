import React, { useState } from "react";
import { COLORS } from "../lib/core";
import firebase from "../lib/firebase";

// Sign-in only. This is an internal tool — accounts are created by an admin
// from the Profile screen, not self-serve, so there's no signup path here.
export default function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [resetSent, setResetSent] = useState(false);

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

  return (
    <div style={{ backgroundColor: COLORS.bg }} className="min-h-screen w-full flex items-center justify-center px-6">
      <div style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border }} className="w-full max-w-sm rounded-2xl border p-8 fade-in">
        <p style={{ color: COLORS.textFaint }} className="font-mono text-[11px] tracking-[0.2em] uppercase mb-2">Workflow Controller</p>
        <h1 style={{ color: COLORS.textPrimary }} className="text-2xl font-bold mb-6">Sign in</h1>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email"
            style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, color: COLORS.textPrimary }}
            className="rounded-xl border px-4 py-3 text-sm outline-none focus:ring-2" />
          <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password"
            style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, color: COLORS.textPrimary }}
            className="rounded-xl border px-4 py-3 text-sm outline-none focus:ring-2" />
          {error && <p style={{ color: COLORS.danger }} className="text-xs">{error}</p>}
          {resetSent && <p style={{ color: COLORS.teal }} className="text-xs">Reset email sent — check your inbox.</p>}
          <button type="submit" disabled={busy} style={{ backgroundColor: COLORS.teal, color: "#04211D", opacity: busy ? 0.6 : 1 }}
            className="rounded-xl py-3 text-sm font-bold mt-2 transition-all active:scale-[0.98]">
            {busy ? "Please wait…" : "Sign In"}
          </button>
        </form>
        <button onClick={forgotPassword} style={{ color: COLORS.textFaint }} className="text-xs mt-4 w-full text-center hover:opacity-80">
          Forgot password?
        </button>
        <p style={{ color: COLORS.textFaint }} className="text-[11px] mt-6 text-center leading-relaxed">
          Need an account? Ask your admin to create one for you.
        </p>
      </div>
    </div>
  );
}

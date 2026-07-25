import React, { useState } from "react";
import { COLORS } from "../lib/core";
import firebase from "../lib/firebase";

export default function LoginScreen() {
  const [mode, setMode] = useState("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [role, setRole] = useState("editor");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError(""); setBusy(true); setResetSent(false);
    try {
      if (mode === "signin") {
        await firebase.auth().signInWithEmailAndPassword(email.trim(), password);
      } else {
        let requiredCode = "";
        try {
          const snap = await firebase.firestore().collection("public").doc("settings").get();
          if (snap.exists) requiredCode = snap.data().inviteCode || "";
        } catch (e2) {}
        if (requiredCode && inviteCode.trim() !== requiredCode) {
          setError("That team code doesn't match. Ask a teammate for the current code.");
          setBusy(false);
          return;
        }
        const cred = await firebase.auth().createUserWithEmailAndPassword(email.trim(), password);
        const displayName = name.trim() || email.split("@")[0];
        await cred.user.updateProfile({ displayName });
        await firebase.firestore().collection("sharedData").doc("workflowController").set({
          profiles: { [cred.user.uid]: { displayName, email: email.trim(), role } },
        }, { merge: true });
      }
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
        <h1 style={{ color: COLORS.textPrimary }} className="text-2xl font-bold mb-6">{mode === "signin" ? "Sign in" : "Create account"}</h1>
        <form onSubmit={submit} className="flex flex-col gap-3">
          {mode === "signup" && (
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name"
              style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, color: COLORS.textPrimary }}
              className="rounded-xl border px-4 py-3 text-sm outline-none focus:ring-2" />
          )}
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email"
            style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, color: COLORS.textPrimary }}
            className="rounded-xl border px-4 py-3 text-sm outline-none focus:ring-2" />
          <input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password"
            style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, color: COLORS.textPrimary }}
            className="rounded-xl border px-4 py-3 text-sm outline-none focus:ring-2" />
          {mode === "signup" && (
            <input value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} placeholder="Team code (ask a teammate)"
              style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, color: COLORS.textPrimary }}
              className="rounded-xl border px-4 py-3 text-sm outline-none focus:ring-2" />
          )}
          {mode === "signup" && (
            <div className="flex flex-col gap-1.5">
              <p style={{ color: COLORS.textFaint }} className="font-mono text-[10px] tracking-[0.15em] uppercase">Your role</p>
              <div className="flex gap-1.5">
                {[["editor", "Editor"], ["partner", "Channel partner"], ["supervisor", "Supervisor"]].map(([val, label]) => (
                  <button key={val} type="button" onClick={() => setRole(val)}
                    style={{ backgroundColor: role === val ? COLORS.tealSoft : COLORS.bgElevated, color: role === val ? COLORS.teal : COLORS.textMuted, borderColor: role === val ? COLORS.teal : COLORS.border }}
                    className="flex-1 rounded-lg border px-2 py-2 text-[11px] font-semibold transition-all">
                    {label}
                  </button>
                ))}
              </div>
              <p style={{ color: COLORS.textFaint }} className="text-[10px] leading-relaxed">
                Editors and partners only see channels they're added to. Supervisors see everything.
              </p>
            </div>
          )}
          {error && <p style={{ color: COLORS.danger }} className="text-xs">{error}</p>}
          {resetSent && <p style={{ color: COLORS.teal }} className="text-xs">Reset email sent — check your inbox.</p>}
          <button type="submit" disabled={busy} style={{ backgroundColor: COLORS.teal, color: "#04211D", opacity: busy ? 0.6 : 1 }}
            className="rounded-xl py-3 text-sm font-bold mt-2 transition-all active:scale-[0.98]">
            {busy ? "Please wait…" : mode === "signin" ? "Sign In" : "Create Account"}
          </button>
        </form>
        {mode === "signin" && (
          <button onClick={forgotPassword} style={{ color: COLORS.textFaint }} className="text-xs mt-4 w-full text-center hover:opacity-80">
            Forgot password?
          </button>
        )}
        <button onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setError(""); setResetSent(false); }} style={{ color: COLORS.textMuted }} className="text-xs mt-3 w-full text-center hover:opacity-80">
          {mode === "signin" ? "New here? Create an account" : "Already have an account? Sign in"}
        </button>
        <p style={{ color: COLORS.textFaint }} className="text-[11px] mt-6 text-center leading-relaxed">
          You and anyone else who signs in here share the same workflows and run history.
        </p>
      </div>
    </div>
  );
}


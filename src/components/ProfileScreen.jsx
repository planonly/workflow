import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { COLORS, displayNameFor } from "../lib/core";
import { LogOut } from "./Icon";
import { ScreenHeader } from "./shared";
import firebase from "../lib/firebase";


export default function ProfileScreen({ user, profiles, myRole, onUpdateName, onUpdateRole, onBack, onSignOut }) {
  const [name, setName] = useState(displayNameFor(user.uid, profiles, user.email));
  const [nameSaved, setNameSaved] = useState(false);
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [pwError, setPwError] = useState("");
  const [pwSuccess, setPwSuccess] = useState(false);
  const [pwBusy, setPwBusy] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [teamCode, setTeamCode] = useState("");
  const [teamCodeLoaded, setTeamCodeLoaded] = useState(false);
  const [teamCodeSaved, setTeamCodeSaved] = useState(false);

  useEffect(() => {
    firebase.firestore().collection("public").doc("settings").get()
      .then((snap) => { if (snap.exists) setTeamCode(snap.data().inviteCode || ""); })
      .catch(() => {})
      .finally(() => setTeamCodeLoaded(true));
  }, []);

  const saveTeamCode = async () => {
    try {
      await firebase.firestore().collection("public").doc("settings").set({ inviteCode: teamCode.trim() }, { merge: true });
      setTeamCodeSaved(true);
      setTimeout(() => setTeamCodeSaved(false), 2000);
    } catch (e) {}
  };

  const saveName = async () => {
    await onUpdateName(name);
    setNameSaved(true);
    setTimeout(() => setNameSaved(false), 2000);
  };

  const changePassword = async (e) => {
    e.preventDefault();
    setPwError(""); setPwSuccess(false); setPwBusy(true);
    try {
      const cred = firebase.auth.EmailAuthProvider.credential(user.email, currentPw);
      await user.reauthenticateWithCredential(cred);
      await user.updatePassword(newPw);
      setPwSuccess(true);
      setCurrentPw(""); setNewPw("");
    } catch (err) {
      setPwError((err && err.message ? err.message : "Something went wrong").replace("Firebase: ", ""));
    }
    setPwBusy(false);
  };

  const sendReset = async () => {
    try {
      await firebase.auth().sendPasswordResetEmail(user.email);
      setResetSent(true);
    } catch (e) {}
  };

  return (
    <div className="flex-1 flex flex-col max-w-lg w-full mx-auto px-6 py-8 sm:py-10 fade-in">
      <ScreenHeader title="Profile" onClose={onBack} />

      <div style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border }} className="rounded-2xl border p-5 mb-5">
        <p style={{ color: COLORS.textFaint }} className="font-mono text-[11px] tracking-[0.2em] uppercase mb-3">Display name</p>
        <div className="flex gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)}
            style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, color: COLORS.textPrimary }}
            className="flex-1 rounded-xl border px-4 py-2.5 text-sm outline-none focus:ring-2" />
          <button onClick={saveName} style={{ backgroundColor: COLORS.tealSoft, color: COLORS.teal }} className="rounded-xl px-4 py-2.5 text-sm font-semibold hover:brightness-110 transition-all">
            {nameSaved ? "Saved" : "Save"}
          </button>
        </div>
        <p style={{ color: COLORS.textFaint }} className="font-mono text-[11px] mt-4">Email</p>
        <p style={{ color: COLORS.textMuted }} className="text-sm">{user.email}</p>
      </div>

      <div style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border }} className="rounded-2xl border p-5 mb-5">
        <p style={{ color: COLORS.textFaint }} className="font-mono text-[11px] tracking-[0.2em] uppercase mb-3">Your role</p>
        <div className="flex gap-1.5">
          {[["editor", "Editor"], ["partner", "Channel partner"], ["supervisor", "Supervisor"]].map(([val, label]) => (
            <button key={val} onClick={() => onUpdateRole(val)}
              style={{ backgroundColor: myRole === val ? COLORS.tealSoft : COLORS.bgElevated, color: myRole === val ? COLORS.teal : COLORS.textMuted, borderColor: myRole === val ? COLORS.teal : COLORS.border }}
              className="flex-1 rounded-lg border px-2 py-2.5 text-xs font-semibold transition-all">
              {label}
            </button>
          ))}
        </div>
        <p style={{ color: COLORS.textFaint }} className="text-[11px] mt-3 leading-relaxed">
          Editors and partners only see channels they're added to (via a channel's "Add editor"). Partners are view-only. Supervisors see and manage everything.
        </p>
      </div>

      <div style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border }} className="rounded-2xl border p-5 mb-5">
        <p style={{ color: COLORS.textFaint }} className="font-mono text-[11px] tracking-[0.2em] uppercase mb-3">Change password</p>
        <form onSubmit={changePassword} className="flex flex-col gap-2.5">
          <input type="password" required value={currentPw} onChange={(e) => setCurrentPw(e.target.value)} placeholder="Current password"
            style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, color: COLORS.textPrimary }}
            className="rounded-xl border px-4 py-2.5 text-sm outline-none focus:ring-2" />
          <input type="password" required minLength={6} value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="New password"
            style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, color: COLORS.textPrimary }}
            className="rounded-xl border px-4 py-2.5 text-sm outline-none focus:ring-2" />
          {pwError && <p style={{ color: COLORS.danger }} className="text-xs">{pwError}</p>}
          {pwSuccess && <p style={{ color: COLORS.teal }} className="text-xs">Password updated.</p>}
          <button type="submit" disabled={pwBusy} style={{ backgroundColor: COLORS.tealSoft, color: COLORS.teal, opacity: pwBusy ? 0.6 : 1 }}
            className="rounded-xl py-2.5 text-sm font-semibold hover:brightness-110 transition-all">
            {pwBusy ? "Please wait…" : "Update password"}
          </button>
        </form>
        <button onClick={sendReset} style={{ color: COLORS.textFaint }} className="text-xs mt-3 hover:opacity-80">
          {resetSent ? "Reset email sent — check your inbox" : "Or email me a reset link instead"}
        </button>
      </div>

      <div style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border }} className="rounded-2xl border p-5 mb-5">
        <p style={{ color: COLORS.textFaint }} className="font-mono text-[11px] tracking-[0.2em] uppercase mb-2">Team access code</p>
        <p style={{ color: COLORS.textFaint }} className="text-xs mb-3 leading-relaxed">
          Anyone creating an account needs this code. Leave it blank to allow open signup.
        </p>
        {teamCodeLoaded && (
          <div className="flex gap-2">
            <input value={teamCode} onChange={(e) => setTeamCode(e.target.value)} placeholder="No code set — signup is open"
              style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, color: COLORS.textPrimary }}
              className="flex-1 rounded-xl border px-4 py-2.5 text-sm outline-none focus:ring-2" />
            <button onClick={saveTeamCode} style={{ backgroundColor: COLORS.tealSoft, color: COLORS.teal }} className="rounded-xl px-4 py-2.5 text-sm font-semibold hover:brightness-110 transition-all">
              {teamCodeSaved ? "Saved" : "Save"}
            </button>
          </div>
        )}
      </div>

      <button onClick={onSignOut} style={{ borderColor: COLORS.border, color: COLORS.danger }}
        className="flex items-center justify-center gap-2 rounded-2xl border py-3.5 text-sm font-semibold hover:opacity-80 transition-opacity">
        <LogOut size={16} /> Sign out
      </button>
    </div>
  );
}

/* ---------------------------- DAY DETAIL SCREEN ---------------------------- */


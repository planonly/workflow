import React, { useState } from "react";
import { COLORS, displayNameFor } from "../lib/core";
import { LogOut, Plus, X } from "./Icon";
import { ScreenHeader } from "./shared";
import firebase from "../lib/firebase";
import { getKeys, setKeys } from "../lib/ai";

const ROLES = [
  ["editor", "Editor"],
  ["partner", "Partner"],
  ["supervisor", "Supervisor"],
  ["admin", "Admin"],
  ["none", "No access"],
];
const ROLE_LABEL = {
  admin: "Admin", supervisor: "Supervisor", editor: "Editor", partner: "Channel partner", none: "No access",
};

export default function ProfileScreen({ user, profiles, myRole, isAdmin, channels, onUpdateName, onUpdateUserRole, onUpdateUserName, onSetUserChannels, onCreateUser, aiConfig, onSaveAiConfig, onBack, onSignOut }) {
  const [name, setName] = useState(displayNameFor(user.uid, profiles, user.email));
  const [nameSaved, setNameSaved] = useState(false);
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [pwError, setPwError] = useState("");
  const [pwSuccess, setPwSuccess] = useState(false);
  const [pwBusy, setPwBusy] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  // New-account form (admin only)
  const [createOpen, setCreateOpen] = useState(false);
  const [nuName, setNuName] = useState("");
  const [nuEmail, setNuEmail] = useState("");
  const [nuPw, setNuPw] = useState("");
  const [nuRole, setNuRole] = useState("editor");
  const [nuChannels, setNuChannels] = useState([]);
  const [nuError, setNuError] = useState("");
  const [nuBusy, setNuBusy] = useState(false);
  const [nuSuccess, setNuSuccess] = useState("");

  // Team-wide clip studio config, seeded from the synced value.
  const [aiKeys, setAiKeys] = useState(() => ({
    anthropicKey: (aiConfig && aiConfig.anthropicKey) || "",
    model: (aiConfig && aiConfig.model) || "claude-sonnet-4-6",
    adOptions: (aiConfig && aiConfig.adOptions) || "",
  }));
  const [keysSaved, setKeysSaved] = useState(false);

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

  const toggleNuChannel = (id) => {
    setNuChannels((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  };

  const submitNewUser = async () => {
    setNuError(""); setNuSuccess(""); setNuBusy(true);
    const err = await onCreateUser({ email: nuEmail, password: nuPw, displayName: nuName, role: nuRole, channelIds: nuChannels });
    if (err) {
      setNuError(err);
    } else {
      setNuSuccess(`${nuName.trim() || nuEmail} created. Share their email and password with them.`);
      setNuName(""); setNuEmail(""); setNuPw(""); setNuRole("editor"); setNuChannels([]);
      setCreateOpen(false);
    }
    setNuBusy(false);
  };

  const teamMembers = Object.keys(profiles || {}).map((uidVal) => ({
    uid: uidVal,
    name: displayNameFor(uidVal, profiles),
    email: (profiles[uidVal] && profiles[uidVal].email) || "",
    role: (profiles[uidVal] && profiles[uidVal].role) || "none",
  }));

  const canSubmitNew = nuEmail.trim() && nuPw.length >= 6 && !nuBusy;

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
        <p style={{ color: COLORS.textFaint }} className="font-mono text-[11px] mt-4">Your role</p>
        <p style={{ color: COLORS.textMuted }} className="text-sm">{ROLE_LABEL[myRole] || myRole}</p>
        {!isAdmin && (
          <p style={{ color: COLORS.textFaint }} className="text-[11px] mt-1.5">Only an admin can change roles.</p>
        )}
      </div>

      {isAdmin && (
        <div style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border }} className="rounded-2xl border p-5 mb-5">
          <div className="flex items-center justify-between mb-3">
            <p style={{ color: COLORS.textFaint }} className="font-mono text-[11px] tracking-[0.2em] uppercase">Team</p>
            <button onClick={() => { setCreateOpen((o) => !o); setNuError(""); setNuSuccess(""); }}
              style={{ color: COLORS.teal }} className="font-mono text-[11px] tracking-wide hover:opacity-80 flex items-center gap-1">
              <Plus size={13} /> {createOpen ? "Close" : "New account"}
            </button>
          </div>

          {nuSuccess && <p style={{ color: COLORS.teal }} className="text-xs mb-3">{nuSuccess}</p>}

          {createOpen && (
            <div style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border }} className="rounded-xl border p-4 mb-4 flex flex-col gap-2.5">
              <input value={nuName} onChange={(e) => setNuName(e.target.value)} placeholder="Their name"
                style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border, color: COLORS.textPrimary }}
                className="rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2" />
              <input type="email" value={nuEmail} onChange={(e) => setNuEmail(e.target.value)} placeholder="Their email"
                style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border, color: COLORS.textPrimary }}
                className="rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2" />
              <input value={nuPw} onChange={(e) => setNuPw(e.target.value)} placeholder="Temporary password (6+ characters)"
                style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border, color: COLORS.textPrimary }}
                className="rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2" />

              <div>
                <p style={{ color: COLORS.textFaint }} className="font-mono text-[10px] tracking-[0.15em] uppercase mb-1.5">Role</p>
                <div className="flex gap-1 flex-wrap">
                  {ROLES.map(([val, label]) => (
                    <button key={val} type="button" onClick={() => setNuRole(val)}
                      style={{ backgroundColor: nuRole === val ? COLORS.tealSoft : COLORS.bgCard, color: nuRole === val ? COLORS.teal : COLORS.textMuted, borderColor: nuRole === val ? COLORS.teal : COLORS.border }}
                      className="rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition-all">
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p style={{ color: COLORS.textFaint }} className="font-mono text-[10px] tracking-[0.15em] uppercase mb-1.5">Channels</p>
                <div className="flex gap-1 flex-wrap">
                  {(channels || []).map((c) => (
                    <button key={c.id} type="button" onClick={() => toggleNuChannel(c.id)}
                      style={{ backgroundColor: nuChannels.includes(c.id) ? COLORS.violetSoft : COLORS.bgCard, color: nuChannels.includes(c.id) ? COLORS.violet : COLORS.textMuted, borderColor: nuChannels.includes(c.id) ? COLORS.violet : COLORS.border }}
                      className="rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition-all">
                      {c.name}
                    </button>
                  ))}
                  {(!channels || channels.length === 0) && (
                    <p style={{ color: COLORS.textFaint }} className="text-[11px] italic">No channels yet.</p>
                  )}
                </div>
              </div>

              {nuError && <p style={{ color: COLORS.danger }} className="text-xs">{nuError}</p>}
              <button onClick={submitNewUser} disabled={!canSubmitNew}
                style={{ backgroundColor: COLORS.teal, color: "#04211D", opacity: canSubmitNew ? 1 : 0.4 }}
                className="rounded-lg py-2.5 text-sm font-bold hover:brightness-105 transition-all disabled:cursor-not-allowed mt-1">
                {nuBusy ? "Creating…" : "Create account"}
              </button>
              <p style={{ color: COLORS.textFaint }} className="text-[10px] leading-relaxed">
                They'll sign in with this email and password. Tell them to change the password from their own Profile screen afterward.
              </p>
            </div>
          )}

          <p style={{ color: COLORS.textFaint }} className="text-[11px] mb-4 leading-relaxed">
            Admins manage accounts and roles. Supervisors run the work (tasks, attendance, workflows) across all channels. Editors and partners only see channels they're added to; partners are read-only.
          </p>

          <div className="flex flex-col gap-2">
            {teamMembers.map((m) => (
              <TeamMemberRow
                key={m.uid}
                member={m}
                isSelf={m.uid === user.uid}
                channels={channels}
                onUpdateUserRole={onUpdateUserRole}
                onUpdateUserName={onUpdateUserName}
                onSetUserChannels={onSetUserChannels}
              />
            ))}
          </div>
        </div>
      )}

      <div style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border }} className="rounded-2xl border p-5 mb-5">
        <p style={{ color: COLORS.textFaint }} className="font-mono text-[11px] tracking-[0.2em] uppercase mb-2">Clip studio</p>
        {isAdmin ? (
          <>
            <p style={{ color: COLORS.textFaint }} className="text-[11px] mb-3 leading-relaxed">
              Set once here and it syncs to the whole team — nobody else has to enter it.
              Stored in your database, behind sign-in, never in the app's code.
            </p>
            <div className="flex flex-col gap-2">
              <input type="password" value={aiKeys.anthropicKey} placeholder="Anthropic API key"
                onChange={(e) => setAiKeys({ ...aiKeys, anthropicKey: e.target.value })}
                style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, color: COLORS.textPrimary }}
                className="rounded-xl border px-4 py-2.5 text-sm outline-none focus:ring-2" />
              <input value={aiKeys.model} placeholder="Model"
                onChange={(e) => setAiKeys({ ...aiKeys, model: e.target.value })}
                style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, color: COLORS.textPrimary }}
                className="rounded-xl border px-4 py-2.5 text-sm outline-none focus:ring-2" />
              <textarea value={aiKeys.adOptions} rows={3}
                placeholder="Optional — custom self-certification options"
                onChange={(e) => setAiKeys({ ...aiKeys, adOptions: e.target.value })}
                style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, color: COLORS.textPrimary }}
                className="rounded-xl border px-4 py-2.5 text-sm outline-none focus:ring-2 leading-relaxed" />
              <button onClick={() => { onSaveAiConfig(aiKeys); setKeysSaved(true); setTimeout(() => setKeysSaved(false), 2000); }}
                style={{ backgroundColor: COLORS.tealSoft, color: COLORS.teal }}
                className="rounded-xl py-2.5 text-sm font-semibold hover:brightness-110 transition-all">
                {keysSaved ? "Saved for everyone" : "Save"}
              </button>
            </div>
          </>
        ) : (
          <p style={{ color: COLORS.textMuted }} className="text-sm">
            {(aiConfig && aiConfig.anthropicKey) ? "Ready to use." : "Not set up yet — ask your admin."}
          </p>
        )}
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

      <button onClick={onSignOut} style={{ borderColor: COLORS.border, color: COLORS.danger }}
        className="flex items-center justify-center gap-2 rounded-2xl border py-3.5 text-sm font-semibold hover:opacity-80 transition-opacity">
        <LogOut size={16} /> Sign out
      </button>
    </div>
  );
}

function TeamMemberRow({ member, isSelf, channels, onUpdateUserRole, onUpdateUserName, onSetUserChannels }) {
  const [open, setOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState(member.name);
  const [nameSaved, setNameSaved] = useState(false);

  const memberChannelIds = (channels || []).filter((c) => (c.memberUids || []).includes(member.uid)).map((c) => c.id);

  const saveName = () => {
    onUpdateUserName(member.uid, nameDraft);
    setNameSaved(true);
    setTimeout(() => setNameSaved(false), 1800);
  };

  const toggleChannel = (id) => {
    const next = memberChannelIds.includes(id)
      ? memberChannelIds.filter((x) => x !== id)
      : [...memberChannelIds, id];
    onSetUserChannels(member.uid, next);
  };

  return (
    <div style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border }} className="rounded-xl border">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-2 px-3.5 py-3 text-left">
        <div className="flex-1 min-w-0">
          <p style={{ color: COLORS.textPrimary }} className="text-sm truncate">{member.name}{isSelf ? " (you)" : ""}</p>
          {member.email && <p style={{ color: COLORS.textFaint }} className="font-mono text-[10px] truncate">{member.email}</p>}
        </div>
        <span style={{ backgroundColor: COLORS.tealSoft, color: COLORS.teal }} className="font-mono text-[10px] rounded-full px-2 py-0.5 shrink-0">
          {ROLE_LABEL[member.role] || member.role}
        </span>
        <span style={{ color: COLORS.textFaint }} className="font-mono text-[10px] shrink-0">
          {memberChannelIds.length} ch
        </span>
      </button>

      {open && (
        <div style={{ borderColor: COLORS.border }} className="border-t px-3.5 py-3 flex flex-col gap-3">
          <div>
            <p style={{ color: COLORS.textFaint }} className="font-mono text-[10px] tracking-[0.15em] uppercase mb-1.5">Name</p>
            <div className="flex gap-2">
              <input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)}
                style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border, color: COLORS.textPrimary }}
                className="flex-1 rounded-lg border px-3 py-1.5 text-sm outline-none focus:ring-2" />
              <button onClick={saveName} style={{ backgroundColor: COLORS.tealSoft, color: COLORS.teal }}
                className="rounded-lg px-3 py-1.5 text-xs font-semibold hover:brightness-110 transition-all">
                {nameSaved ? "Saved" : "Save"}
              </button>
            </div>
          </div>

          <div>
            <p style={{ color: COLORS.textFaint }} className="font-mono text-[10px] tracking-[0.15em] uppercase mb-1.5">Role</p>
            {isSelf ? (
              <p style={{ color: COLORS.textFaint }} className="text-[11px]">Ask another admin to change your own role.</p>
            ) : (
              <div className="flex gap-1 flex-wrap">
                {ROLES.map(([val, label]) => (
                  <button key={val} onClick={() => { if (window.confirm(`Change ${member.name}'s role to ${label}?`)) onUpdateUserRole(member.uid, val); }}
                    style={{ backgroundColor: member.role === val ? COLORS.tealSoft : COLORS.bgCard, color: member.role === val ? COLORS.teal : COLORS.textMuted, borderColor: member.role === val ? COLORS.teal : COLORS.border }}
                    className="rounded-lg border px-2 py-1.5 text-[11px] font-semibold transition-all">
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <p style={{ color: COLORS.textFaint }} className="font-mono text-[10px] tracking-[0.15em] uppercase mb-1.5">Channels</p>
            <div className="flex gap-1 flex-wrap">
              {(channels || []).map((c) => {
                const on = memberChannelIds.includes(c.id);
                return (
                  <button key={c.id} onClick={() => toggleChannel(c.id)}
                    style={{ backgroundColor: on ? COLORS.violetSoft : COLORS.bgCard, color: on ? COLORS.violet : COLORS.textMuted, borderColor: on ? COLORS.violet : COLORS.border }}
                    className="rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition-all">
                    {c.name}
                  </button>
                );
              })}
              {(!channels || channels.length === 0) && (
                <p style={{ color: COLORS.textFaint }} className="text-[11px] italic">No channels yet.</p>
              )}
            </div>
          </div>

          <p style={{ color: COLORS.textFaint }} className="text-[10px] leading-relaxed">
            Sign-in email can't be changed here — they can change it themselves, or you can reset it from the Firebase console.
          </p>
        </div>
      )}
    </div>
  );
}

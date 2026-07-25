import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { COLORS, formatTime, formatHours, formatDateShort, dayKey, displayNameFor } from "../lib/core";
import { ChannelIcon, HomeIcon, Play, Trash2, UserPlus, X } from "./Icon";
import { DailyBars, StatCard } from "./shared";


export default function ChannelDashboard({ channel, channels, workflows, runs, profiles, canManage, canManageChannels, canManageMembers, onRename, onUpdateMeta, onDelete, onToggleMember, onOpenWorkflow, onOpenDay, onBack }) {
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(channel ? channel.name : "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  if (!channel) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
        <p style={{ color: COLORS.textMuted }} className="mb-4">This channel no longer exists.</p>
        <button onClick={onBack} style={{ backgroundColor: COLORS.teal, color: "#04211D" }} className="rounded-xl px-5 py-2.5 text-sm font-bold">Back to Home</button>
      </div>
    );
  }

  const channelWorkflows = workflows.filter((w) => w.channelId === channel.id);
  const wfIds = new Set(channelWorkflows.map((w) => w.id));
  const channelRuns = runs.filter((r) => wfIds.has(r.workflowId));
  const videosPosted = channelRuns.length;
  const totalTime = channelRuns.reduce((s, r) => s + r.totalSeconds, 0);
  const avgTime = videosPosted ? totalTime / videosPosted : 0;
  const workflowById = useMemo(() => {
    const m = {};
    channelWorkflows.forEach((w) => { m[w.id] = w; });
    return m;
  }, [channelWorkflows]);
  const isShort = (r) => (workflowById[r.workflowId] || {}).contentType === "short";
  const shortsCount = channelRuns.filter(isShort).length;
  const longCount = videosPosted - shortsCount;

  const memberUids = channel.memberUids || [];
  const memberStats = memberUids.map((muid) => {
    const rs = channelRuns.filter((r) => r.completedByUid === muid);
    return {
      uid: muid,
      name: displayNameFor(muid, profiles, profiles[muid] && profiles[muid].email),
      videos: rs.length,
      time: rs.reduce((s, r) => s + r.totalSeconds, 0),
    };
  }).sort((a, b) => b.videos - a.videos);

  const allKnownUids = useMemo(() => {
    const s = new Set(Object.keys(profiles || {}));
    runs.forEach((r) => { if (r.completedByUid) s.add(r.completedByUid); });
    return Array.from(s);
  }, [profiles, runs]);
  const nonMembers = allKnownUids.filter((u) => !memberUids.includes(u));

  const dailyData = useMemo(() => {
    const days = [];
    const now = new Date();
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      days.push({ key, label: d.toLocaleDateString(undefined, { weekday: "narrow" }), long: 0, short: 0 });
    }
    const map = {};
    days.forEach((d) => { map[d.key] = d; });
    channelRuns.forEach((r) => {
      const k = dayKey(r.completedAt);
      if (!map[k]) return;
      map[k][isShort(r) ? "short" : "long"] += 1;
    });
    return days;
  }, [channelRuns, workflowById]);

  const commitName = () => { onRename(channel.id, nameDraft); setEditingName(false); };

  return (
    <div className="flex-1 flex flex-col max-w-4xl w-full mx-auto px-6 py-8 sm:py-10 overflow-y-auto fade-in">
      <div className="flex items-start justify-between mb-6 flex-wrap gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div style={{ backgroundColor: COLORS.violetSoft, color: COLORS.violet }} className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0">
            <ChannelIcon size={20} />
          </div>
          <div className="min-w-0">
            <p style={{ color: COLORS.textFaint }} className="font-mono text-[11px] tracking-[0.2em] uppercase mb-1">Channel</p>
            {editingName && canManageChannels ? (
              <input autoFocus value={nameDraft} onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && commitName()} onBlur={commitName}
                style={{ backgroundColor: COLORS.bgElevated, color: COLORS.textPrimary, borderColor: COLORS.border }}
                className="rounded-lg border px-2 py-1 text-xl font-bold outline-none" />
            ) : (
              <h1 onClick={() => canManageChannels && setEditingName(true)} style={{ color: COLORS.textPrimary }} className={`text-2xl sm:text-3xl font-bold truncate ${canManageChannels ? "cursor-pointer" : ""}`} title={canManageChannels ? "Click to rename" : undefined}>{channel.name}</h1>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {canManageChannels && (
            <button onClick={() => setConfirmDelete(true)} aria-label="Delete channel" style={{ borderColor: COLORS.border, color: COLORS.danger }} className="rounded-full border p-2 hover:opacity-80 transition-opacity"><Trash2 size={18} /></button>
          )}
          <button onClick={onBack} aria-label="Home" style={{ borderColor: COLORS.border, color: COLORS.textMuted }} className="rounded-full border p-2 hover:opacity-80 transition-opacity"><HomeIcon size={18} /></button>
        </div>
      </div>

      {/* Channel details */}
      <div style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border }} className="rounded-2xl border p-5 mb-5">
        <p style={{ color: COLORS.textFaint }} className="font-mono text-[11px] tracking-[0.2em] uppercase mb-4">Channel details</p>
        <div className="flex flex-col gap-3">
          <div className="flex gap-3 flex-wrap">
            <div className="flex-1 min-w-[140px]">
              <p style={{ color: COLORS.textFaint }} className="font-mono text-[10px] tracking-[0.15em] uppercase mb-1.5">Country</p>
              {canManageChannels ? (
                <input value={channel.country || ""} placeholder="e.g. United States"
                  onChange={(e) => onUpdateMeta(channel.id, { country: e.target.value })}
                  style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, color: COLORS.textPrimary }}
                  className="w-full rounded-lg border px-3 py-1.5 text-sm outline-none focus:ring-2" />
              ) : (
                <p style={{ color: COLORS.textMuted }} className="text-sm">{channel.country || "—"}</p>
              )}
            </div>
            <div className="flex-1 min-w-[140px]">
              <p style={{ color: COLORS.textFaint }} className="font-mono text-[10px] tracking-[0.15em] uppercase mb-1.5">Channel handle or URL</p>
              {canManageChannels ? (
                <input value={channel.handle || ""} placeholder="@handle"
                  onChange={(e) => onUpdateMeta(channel.id, { handle: e.target.value })}
                  style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, color: COLORS.textPrimary }}
                  className="w-full rounded-lg border px-3 py-1.5 text-sm outline-none focus:ring-2" />
              ) : (
                <p style={{ color: COLORS.textMuted }} className="text-sm truncate">{channel.handle || "—"}</p>
              )}
            </div>
          </div>

          <div>
            <p style={{ color: COLORS.textFaint }} className="font-mono text-[10px] tracking-[0.15em] uppercase mb-1.5">Monetisation</p>
            {canManageChannels ? (
              <div className="flex gap-1.5">
                {[[true, "Monetised"], [false, "Not monetised"]].map(([val, label]) => (
                  <button key={String(val)} onClick={() => onUpdateMeta(channel.id, { monetised: val })}
                    style={{
                      backgroundColor: !!channel.monetised === val ? COLORS.tealSoft : COLORS.bgElevated,
                      color: !!channel.monetised === val ? COLORS.teal : COLORS.textMuted,
                      borderColor: !!channel.monetised === val ? COLORS.teal : COLORS.border,
                    }}
                    className="rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all">
                    {label}
                  </button>
                ))}
              </div>
            ) : (
              <p style={{ color: COLORS.textMuted }} className="text-sm">{channel.monetised ? "Monetised" : "Not monetised"}</p>
            )}
          </div>

          <div>
            <p style={{ color: COLORS.textFaint }} className="font-mono text-[10px] tracking-[0.15em] uppercase mb-1.5">Notes</p>
            {canManageChannels ? (
              <textarea value={channel.notes || ""} rows={2} placeholder="Anything the team should know about this channel"
                onChange={(e) => onUpdateMeta(channel.id, { notes: e.target.value })}
                style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, color: COLORS.textPrimary }}
                className="w-full rounded-lg border px-3 py-1.5 text-sm outline-none focus:ring-2" />
            ) : (
              <p style={{ color: COLORS.textMuted }} className="text-sm">{channel.notes || "—"}</p>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-3">
        <StatCard label="Videos posted" value={videosPosted} color={COLORS.textPrimary} />
        <StatCard label="Long-form" value={longCount} color={COLORS.teal} />
        <StatCard label="Shorts" value={shortsCount} color={COLORS.orange} />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
        <StatCard label="Editors" value={memberUids.length} color={COLORS.violet} />
        <StatCard label="Time tracked" value={formatHours(totalTime)} color={COLORS.orange} />
        <StatCard label="Avg / video" value={formatTime(avgTime)} color={COLORS.teal} />
      </div>

      <div style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border }} className="rounded-2xl border p-5 mb-6">
        <p style={{ color: COLORS.textFaint }} className="font-mono text-[11px] tracking-[0.2em] uppercase mb-4">Videos posted, last 14 days</p>
        <DailyBars days={dailyData} onOpenDay={onOpenDay} />
      </div>

      <div style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border }} className="rounded-2xl border p-5 mb-6">
        <div className="flex items-center justify-between mb-4">
          <p style={{ color: COLORS.textFaint }} className="font-mono text-[11px] tracking-[0.2em] uppercase">Editors on this channel</p>
          {canManageMembers && nonMembers.length > 0 && (
            <button onClick={() => setAddOpen((o) => !o)} style={{ color: COLORS.teal }} className="font-mono text-[11px] tracking-wide hover:opacity-80 flex items-center gap-1">
              <UserPlus size={13} /> Add editor
            </button>
          )}
        </div>

        {addOpen && canManageMembers && (
          <div className="flex flex-col gap-1.5 mb-4">
            {nonMembers.map((muid) => (
              <button key={muid} onClick={() => { onToggleMember(channel.id, muid); setAddOpen(false); }}
                style={{ backgroundColor: COLORS.bgElevated, color: COLORS.textPrimary, borderColor: COLORS.border }}
                className="text-left rounded-lg border px-3 py-2 text-sm hover:opacity-80 transition-opacity">
                {displayNameFor(muid, profiles)}
              </button>
            ))}
          </div>
        )}

        {memberStats.length === 0 ? (
          <p style={{ color: COLORS.textFaint }} className="text-sm italic py-2">No editors assigned yet.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {memberStats.map((m) => (
              <div key={m.uid} className="flex items-center gap-3">
                <div style={{ backgroundColor: COLORS.tealSoft, color: COLORS.teal }} className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm shrink-0">
                  {m.name.slice(0, 1).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p style={{ color: COLORS.textPrimary }} className="text-sm font-semibold truncate">{m.name}</p>
                  <p style={{ color: COLORS.textFaint }} className="font-mono text-[11px]">{m.videos} videos · {formatHours(m.time)}</p>
                </div>
                {canManageMembers && (
                  <button onClick={() => onToggleMember(channel.id, m.uid)} aria-label="Remove from channel" style={{ color: COLORS.danger }} className="p-1.5 hover:opacity-70 shrink-0"><X size={16} /></button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {canManage && (
        <React.Fragment>
      <p style={{ color: COLORS.textFaint }} className="font-mono text-[11px] tracking-[0.2em] uppercase mb-3">Workflows on this channel</p>
      <div className="grid sm:grid-cols-2 gap-4 mb-4">
        {channelWorkflows.length === 0 && (
          <p style={{ color: COLORS.textFaint }} className="text-sm italic sm:col-span-2">No workflows assigned to this channel yet. Assign one from the workflow's Edit screen.</p>
        )}
        {channelWorkflows.map((w) => {
          const rs = channelRuns.filter((r) => r.workflowId === w.id);
          const last = rs.length ? rs.reduce((a, b) => (new Date(a.completedAt) > new Date(b.completedAt) ? a : b)) : null;
          return (
            <div key={w.id} style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border }} className="rounded-2xl border p-5 flex flex-col">
              <div className="flex-1">
                <p style={{ color: COLORS.textPrimary }} className="font-semibold text-lg mb-1 truncate">{w.title || "Untitled workflow"}</p>
                <p style={{ color: COLORS.textFaint }} className="font-mono text-xs mb-1">{w.steps.length} steps · {rs.length} runs</p>
                <p style={{ color: COLORS.textFaint }} className="font-mono text-xs">{last ? `Last run ${formatDateShort(last.completedAt)}` : "Not started yet"}</p>
              </div>
              <button onClick={() => onOpenWorkflow(w.id)} style={{ backgroundColor: COLORS.teal, color: "#04211D" }}
                className="mt-4 flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-bold hover:brightness-105 transition-all active:scale-[0.98]">
                <Play size={15} /> Continue
              </button>
            </div>
          );
        })}
      </div>
        </React.Fragment>
      )}

      {confirmDelete && (
        <div className="fixed inset-0 flex items-center justify-center px-6" style={{ backgroundColor: "rgba(0,0,0,0.6)" }}>
          <div style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border }} className="rounded-2xl border p-6 max-w-sm w-full">
            <p style={{ color: COLORS.textPrimary }} className="font-semibold mb-2">Delete "{channel.name}"?</p>
            <p style={{ color: COLORS.textMuted }} className="text-sm mb-6">Workflows assigned to it become unassigned. Run history is kept.</p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmDelete(false)} style={{ borderColor: COLORS.border, color: COLORS.textMuted }} className="flex-1 rounded-xl border py-3 text-sm font-semibold">Cancel</button>
              <button onClick={() => { onDelete(channel.id); }} style={{ backgroundColor: COLORS.danger, color: "#2A0A0A" }} className="flex-1 rounded-xl py-3 text-sm font-bold">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------------------- PROFILE SCREEN ---------------------------- */


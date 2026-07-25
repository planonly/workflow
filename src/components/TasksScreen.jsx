import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { displayNameFor, formatFullDate, COLORS } from "../lib/core";
import { HomeIcon, LinkIcon, Plus, X } from "./Icon";


export default function TasksScreen({ user, profiles, channels, tasks, isSupervisor, onCreate, onUpdateStatus, onDelete, onBack }) {
  const [formOpen, setFormOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assignedToUid, setAssignedToUid] = useState("");
  const [channelId, setChannelId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [linkLabel, setLinkLabel] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [links, setLinks] = useState([]);

  const teamMembers = Object.keys(profiles || {}).map((uidVal) => ({ uid: uidVal, name: displayNameFor(uidVal, profiles) }));

  const addLink = () => {
    if (!linkUrl.trim()) return;
    setLinks((l) => [...l, { label: linkLabel.trim() || linkUrl.trim(), url: linkUrl.trim() }]);
    setLinkLabel(""); setLinkUrl("");
  };
  const removeLink = (i) => setLinks((l) => l.filter((_, idx) => idx !== i));

  const resetForm = () => {
    setTitle(""); setDescription(""); setAssignedToUid(""); setChannelId(""); setDueDate(""); setLinks([]); setLinkLabel(""); setLinkUrl("");
    setFormOpen(false);
  };

  const submit = () => {
    if (!title.trim() || !assignedToUid) return;
    onCreate({ title, description, assignedToUid, channelId: channelId || null, dueDate: dueDate || null, links });
    resetForm();
  };

  const myTasks = tasks.filter((t) => t.assignedToUid === user.uid).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const allTasksSorted = [...tasks].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const visibleTasks = isSupervisor ? allTasksSorted : myTasks;

  return (
    <div className="flex-1 flex flex-col max-w-3xl w-full mx-auto px-6 py-8 sm:py-10 overflow-y-auto fade-in">
      <div className="flex items-center justify-between mb-6">
        <h2 style={{ color: COLORS.textPrimary }} className="text-2xl sm:text-3xl font-bold">Tasks</h2>
        <button onClick={onBack} aria-label="Home" style={{ borderColor: COLORS.border, color: COLORS.textMuted }} className="rounded-full border p-2 hover:opacity-80 transition-opacity"><HomeIcon size={18} /></button>
      </div>

      {isSupervisor && (
        <button onClick={() => setFormOpen((o) => !o)} style={{ backgroundColor: formOpen ? COLORS.tealSoft : COLORS.teal, color: formOpen ? COLORS.teal : "#04211D", borderColor: COLORS.teal }}
          className="flex items-center justify-center gap-2 rounded-xl border py-3 text-sm font-bold mb-5 hover:brightness-105 transition-all">
          <Plus size={16} /> {formOpen ? "Close" : "Assign new task"}
        </button>
      )}

      {formOpen && isSupervisor && (
        <div style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border }} className="rounded-2xl border p-5 mb-6 flex flex-col gap-3">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Task title"
            style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, color: COLORS.textPrimary }}
            className="rounded-xl border px-4 py-2.5 text-sm outline-none focus:ring-2" />

          <select value={assignedToUid} onChange={(e) => setAssignedToUid(e.target.value)}
            style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, color: COLORS.textPrimary }}
            className="rounded-xl border px-4 py-2.5 text-sm outline-none focus:ring-2">
            <option value="">Assign to…</option>
            {teamMembers.map((m) => <option key={m.uid} value={m.uid}>{m.name}</option>)}
          </select>

          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} placeholder="Instructions, prompts to use, notes…"
            style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, color: COLORS.textPrimary }}
            className="rounded-xl border px-4 py-2.5 text-sm outline-none focus:ring-2" />

          <div>
            <p style={{ color: COLORS.textFaint }} className="font-mono text-[10px] tracking-[0.15em] uppercase mb-2">Links (source files, docs, etc.)</p>
            {links.length > 0 && (
              <div className="flex flex-col gap-1.5 mb-2">
                {links.map((l, i) => (
                  <div key={i} style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border }} className="flex items-center gap-2 rounded-lg border px-3 py-1.5">
                    <LinkIcon size={13} style={{ color: COLORS.teal }} />
                    <span style={{ color: COLORS.textPrimary }} className="text-xs flex-1 truncate">{l.label}</span>
                    <button onClick={() => removeLink(i)} style={{ color: COLORS.danger }}><X size={13} /></button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <input value={linkLabel} onChange={(e) => setLinkLabel(e.target.value)} placeholder="Label"
                style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, color: COLORS.textPrimary }}
                className="w-24 rounded-lg border px-3 py-2 text-xs outline-none focus:ring-2" />
              <input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addLink()} placeholder="https://…"
                style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, color: COLORS.textPrimary }}
                className="flex-1 rounded-lg border px-3 py-2 text-xs outline-none focus:ring-2" />
              <button onClick={addLink} style={{ backgroundColor: COLORS.tealSoft, color: COLORS.teal }} className="rounded-lg px-3 py-2 text-xs font-semibold hover:brightness-110 transition-all">Add</button>
            </div>
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <p style={{ color: COLORS.textFaint }} className="font-mono text-[10px] tracking-[0.15em] uppercase mb-1.5">Channel (optional)</p>
              <select value={channelId} onChange={(e) => setChannelId(e.target.value)}
                style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, color: COLORS.textPrimary }}
                className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none focus:ring-2">
                <option value="">None</option>
                {channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="flex-1">
              <p style={{ color: COLORS.textFaint }} className="font-mono text-[10px] tracking-[0.15em] uppercase mb-1.5">Due date (optional)</p>
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)}
                style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, color: COLORS.textPrimary }}
                className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none focus:ring-2" />
            </div>
          </div>

          <button onClick={submit} disabled={!title.trim() || !assignedToUid} style={{ backgroundColor: COLORS.teal, color: "#04211D", opacity: (!title.trim() || !assignedToUid) ? 0.4 : 1 }}
            className="rounded-xl py-3 text-sm font-bold mt-1 hover:brightness-105 transition-all disabled:cursor-not-allowed">
            Assign task
          </button>
        </div>
      )}

      <div className="flex flex-col gap-3">
        {visibleTasks.length === 0 && (
          <p style={{ color: COLORS.textFaint }} className="text-sm italic text-center py-10">
            {isSupervisor ? "No tasks assigned yet." : "Nothing assigned to you right now."}
          </p>
        )}
        {visibleTasks.map((t) => (
          <TaskCard key={t.id} task={t} profiles={profiles} channels={channels} isSupervisor={isSupervisor} isMine={t.assignedToUid === user.uid}
            onUpdateStatus={onUpdateStatus} onDelete={onDelete} />
        ))}
      </div>
    </div>
  );
}

function TaskCard({ task, profiles, channels, isSupervisor, isMine, onUpdateStatus, onDelete }) {
  const statusColor = task.status === "done" ? COLORS.teal : task.status === "in_progress" ? COLORS.orange : COLORS.textFaint;
  const statusBg = task.status === "done" ? COLORS.tealSoft : task.status === "in_progress" ? COLORS.orangeSoft : COLORS.bgElevated;
  const channel = task.channelId ? channels.find((c) => c.id === task.channelId) : null;

  return (
    <div style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border }} className="rounded-2xl border p-5">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0">
          <p style={{ color: COLORS.textPrimary }} className="font-semibold text-base">{task.title}</p>
          <p style={{ color: COLORS.textFaint }} className="font-mono text-[11px] mt-1">
            {isSupervisor ? `Assigned to ${displayNameFor(task.assignedToUid, profiles)}` : `From ${displayNameFor(task.assignedByUid, profiles)}`}
            {channel ? ` · ${channel.name}` : ""}
            {task.dueDate ? ` · Due ${formatFullDate(task.dueDate)}` : ""}
          </p>
        </div>
        <span style={{ backgroundColor: statusBg, color: statusColor }} className="font-mono text-[10px] rounded-full px-2.5 py-1 shrink-0">
          {task.status === "done" ? "Done" : task.status === "in_progress" ? "In progress" : "Pending"}
        </span>
      </div>

      {task.description && (
        <p style={{ color: COLORS.textMuted }} className="text-sm mb-3 whitespace-pre-wrap">{task.description}</p>
      )}

      {task.links && task.links.length > 0 && (
        <div className="flex flex-col gap-1.5 mb-3">
          {task.links.map((l, i) => (
            <a key={i} href={l.url} target="_blank" rel="noopener noreferrer"
              style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, color: COLORS.teal }}
              className="flex items-center gap-2 rounded-lg border px-3 py-2 text-xs hover:opacity-80 transition-opacity">
              <LinkIcon size={13} /> {l.label}
            </a>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 mt-3">
        {isMine && task.status !== "done" && (
          <button onClick={() => onUpdateStatus(task.id, task.status === "pending" ? "in_progress" : "done")}
            style={{ backgroundColor: COLORS.tealSoft, color: COLORS.teal }} className="rounded-lg px-3 py-1.5 text-xs font-semibold hover:brightness-110 transition-all">
            {task.status === "pending" ? "Start" : "Mark done"}
          </button>
        )}
        {isMine && task.status === "done" && (
          <button onClick={() => onUpdateStatus(task.id, "in_progress")} style={{ color: COLORS.textFaint }} className="text-xs hover:opacity-80">
            Reopen
          </button>
        )}
        {isSupervisor && (
          <button onClick={() => onDelete(task.id)} style={{ color: COLORS.danger }} className="text-xs hover:opacity-80 ml-auto">
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

/* ---------------------------- DASHBOARD ---------------------------- */


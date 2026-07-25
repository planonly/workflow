import React, { useState, useMemo, useRef } from "react";
import { displayNameFor, formatFullDate, formatDateShort, formatTime, COLORS } from "../lib/core";
import { HomeIcon, LinkIcon, Plus, X, Settings } from "./Icon";
import { downloadHls, saveBlob, isM3u8 } from "../lib/hls";

const STATUS_TABS = [
  ["all", "All"],
  ["pending", "Pending"],
  ["in_progress", "In progress"],
  ["done", "Done"],
];

function isOverdue(task) {
  if (!task.dueDate || task.status === "done") return false;
  return task.dueDate < new Date().toISOString().slice(0, 10);
}

export default function TasksScreen({ user, profiles, channels, tasks, runs, isSupervisor, onCreate, onUpdateStatus, onUpdateTask, onDelete, onBack }) {
  const [formOpen, setFormOpen] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [assigneeFilter, setAssigneeFilter] = useState("all");

  const teamMembers = Object.keys(profiles || {}).map((uidVal) => ({ uid: uidVal, name: displayNameFor(uidVal, profiles) }));

  const myTasks = tasks.filter((t) => t.assignedToUid === user.uid);
  const baseTasks = isSupervisor ? tasks : myTasks;

  const visibleTasks = useMemo(() => {
    let list = [...baseTasks];
    if (statusFilter !== "all") list = list.filter((t) => t.status === statusFilter);
    if (isSupervisor && assigneeFilter !== "all") list = list.filter((t) => t.assignedToUid === assigneeFilter);
    return list.sort((a, b) => {
      const aOver = isOverdue(a), bOver = isOverdue(b);
      if (aOver !== bOver) return aOver ? -1 : 1;
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
  }, [baseTasks, statusFilter, assigneeFilter, isSupervisor]);

  const startCreate = () => { setEditingTaskId(null); setFormOpen(true); };
  const startEdit = (task) => { setEditingTaskId(task.id); setFormOpen(true); };
  const closeForm = () => { setFormOpen(false); setEditingTaskId(null); };

  const editingTask = editingTaskId ? tasks.find((t) => t.id === editingTaskId) : null;

  const handleSubmit = (data) => {
    if (editingTask) onUpdateTask(editingTask.id, data);
    else onCreate(data);
    closeForm();
  };

  return (
    <div className="flex-1 flex flex-col max-w-3xl w-full mx-auto px-6 py-8 sm:py-10 overflow-y-auto fade-in">
      <div className="flex items-center justify-between mb-6">
        <h2 style={{ color: COLORS.textPrimary }} className="text-2xl sm:text-3xl font-bold">Tasks</h2>
        <button onClick={onBack} aria-label="Home" style={{ borderColor: COLORS.border, color: COLORS.textMuted }} className="rounded-full border p-2 hover:opacity-80 transition-opacity"><HomeIcon size={18} /></button>
      </div>

      {isSupervisor && (
        <button onClick={formOpen && !editingTask ? closeForm : startCreate}
          style={{ backgroundColor: (formOpen && !editingTask) ? COLORS.tealSoft : COLORS.teal, color: (formOpen && !editingTask) ? COLORS.teal : "#04211D", borderColor: COLORS.teal }}
          className="flex items-center justify-center gap-2 rounded-xl border py-3 text-sm font-bold mb-5 hover:brightness-105 transition-all">
          <Plus size={16} /> {(formOpen && !editingTask) ? "Close" : "Assign new task"}
        </button>
      )}

      {formOpen && (
        <TaskForm
          key={editingTaskId || "new"}
          initial={editingTask}
          teamMembers={teamMembers}
          channels={channels}
          onSubmit={handleSubmit}
          onCancel={closeForm}
        />
      )}

      {/* Filters */}
      <div className="flex items-center gap-2 mb-5 flex-wrap">
        <div className="flex gap-1.5">
          {STATUS_TABS.map(([val, label]) => (
            <button key={val} onClick={() => setStatusFilter(val)}
              style={{ backgroundColor: statusFilter === val ? COLORS.tealSoft : "transparent", color: statusFilter === val ? COLORS.teal : COLORS.textMuted, borderColor: statusFilter === val ? COLORS.teal : COLORS.border }}
              className="rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-all">
              {label}
            </button>
          ))}
        </div>
        {isSupervisor && (
          <select value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)}
            style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, color: COLORS.textPrimary }}
            className="rounded-lg border px-2.5 py-1.5 text-xs outline-none focus:ring-2 ml-auto">
            <option value="all">Everyone</option>
            {teamMembers.map((m) => <option key={m.uid} value={m.uid}>{m.name}</option>)}
          </select>
        )}
      </div>

      <div className="flex flex-col gap-3">
        {visibleTasks.length === 0 && (
          <p style={{ color: COLORS.textFaint }} className="text-sm italic text-center py-10">
            {isSupervisor ? "No tasks match this filter." : "Nothing assigned to you right now."}
          </p>
        )}
        {visibleTasks.map((t) => (
          <TaskCard key={t.id} task={t} profiles={profiles} channels={channels} isSupervisor={isSupervisor} isMine={t.assignedToUid === user.uid}
            overdue={isOverdue(t)}
            taskRuns={(runs || []).filter((r) => r.taskId === t.id)}
            onUpdateStatus={onUpdateStatus} onEdit={() => startEdit(t)} onDelete={onDelete} />
        ))}
      </div>
    </div>
  );
}

function TaskForm({ initial, teamMembers, channels, onSubmit, onCancel }) {
  const [title, setTitle] = useState(initial?.title || "");
  const [description, setDescription] = useState(initial?.description || "");
  const [assignedToUid, setAssignedToUid] = useState(initial?.assignedToUid || "");
  const [channelId, setChannelId] = useState(initial?.channelId || "");
  const [dueDate, setDueDate] = useState(initial?.dueDate || "");
  const [linkLabel, setLinkLabel] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [links, setLinks] = useState(initial?.links || []);

  const addLink = () => {
    if (!linkUrl.trim()) return;
    setLinks((l) => [...l, { label: linkLabel.trim() || linkUrl.trim(), url: linkUrl.trim() }]);
    setLinkLabel(""); setLinkUrl("");
  };
  const removeLink = (i) => setLinks((l) => l.filter((_, idx) => idx !== i));

  const submit = () => {
    if (!title.trim() || !assignedToUid) return;
    onSubmit({ title, description, assignedToUid, channelId: channelId || null, dueDate: dueDate || null, links });
  };

  return (
    <div style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border }} className="rounded-2xl border p-5 mb-6 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p style={{ color: COLORS.textFaint }} className="font-mono text-[11px] tracking-[0.2em] uppercase">{initial ? "Edit task" : "New task"}</p>
        <button onClick={onCancel} style={{ color: COLORS.textMuted }}><X size={16} /></button>
      </div>

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
        {initial ? "Save changes" : "Assign task"}
      </button>
    </div>
  );
}

function TaskCard({ task, profiles, channels, isSupervisor, isMine, overdue, taskRuns, onUpdateStatus, onEdit, onDelete }) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const totalOnTask = (taskRuns || []).reduce((s2, r) => s2 + (r.totalSeconds || 0), 0);
  const statusColor = task.status === "done" ? COLORS.teal : task.status === "in_progress" ? COLORS.orange : COLORS.textFaint;
  const statusBg = task.status === "done" ? COLORS.tealSoft : task.status === "in_progress" ? COLORS.orangeSoft : COLORS.bgElevated;
  const channel = task.channelId ? channels.find((c) => c.id === task.channelId) : null;

  return (
    <div style={{ backgroundColor: COLORS.bgCard, borderColor: overdue ? COLORS.danger : COLORS.border }} className="rounded-2xl border p-5">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0">
          <p style={{ color: COLORS.textPrimary }} className="font-semibold text-base">{task.title}</p>
          <p style={{ color: COLORS.textFaint }} className="font-mono text-[11px] mt-1">
            {isSupervisor ? `Assigned to ${displayNameFor(task.assignedToUid, profiles)}` : `From ${displayNameFor(task.assignedByUid, profiles)}`}
            {channel ? ` · ${channel.name}` : ""}
            {task.dueDate ? ` · Due ${formatFullDate(task.dueDate)}` : ""}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <span style={{ backgroundColor: statusBg, color: statusColor }} className="font-mono text-[10px] rounded-full px-2.5 py-1">
            {task.status === "done" ? "Done" : task.status === "in_progress" ? "In progress" : "Pending"}
          </span>
          {overdue && (
            <span style={{ backgroundColor: "rgba(225,90,90,0.14)", color: COLORS.danger }} className="font-mono text-[10px] rounded-full px-2.5 py-1">
              Overdue
            </span>
          )}
        </div>
      </div>

      {task.description && (
        <p style={{ color: COLORS.textMuted }} className="text-sm mb-3 whitespace-pre-wrap">{task.description}</p>
      )}

      {task.links && task.links.length > 0 && (
        <div className="flex flex-col gap-1.5 mb-3">
          {task.links.map((l, i) => (
            isM3u8(l.url)
              ? <VideoDownload key={i} link={l} taskTitle={task.title} />
              : (
                <a key={i} href={l.url} target="_blank" rel="noopener noreferrer"
                  style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, color: COLORS.teal }}
                  className="flex items-center gap-2 rounded-lg border px-3 py-2 text-xs hover:opacity-80 transition-opacity">
                  <LinkIcon size={13} /> {l.label}
                </a>
              )
          ))}
        </div>
      )}

      {taskRuns && taskRuns.length > 0 && (
        <div style={{ borderColor: COLORS.border }} className="border-t mt-3 pt-3">
          <button onClick={() => setHistoryOpen((o) => !o)} className="flex items-center gap-2 w-full text-left">
            <span style={{ color: COLORS.textFaint }} className="font-mono text-[11px] flex-1">
              {taskRuns.length} run{taskRuns.length === 1 ? "" : "s"} · {formatTime(totalOnTask)} on this video
            </span>
            <span style={{ color: COLORS.teal }} className="font-mono text-[11px]">{historyOpen ? "Hide" : "History"}</span>
          </button>
          {historyOpen && (
            <div className="flex flex-col gap-1.5 mt-2">
              {[...taskRuns].sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt)).map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-2">
                  <span style={{ color: COLORS.textMuted }} className="font-mono text-[11px] truncate">
                    {formatDateShort(r.completedAt)} · {displayNameFor(r.completedByUid, profiles, r.completedBy)}
                  </span>
                  <span style={{ color: COLORS.orange }} className="font-mono text-[11px] shrink-0">{formatTime(r.totalSeconds)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-3 mt-3 flex-wrap">
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
          <button onClick={onEdit} style={{ color: COLORS.textMuted }} className="text-xs font-semibold hover:opacity-80 flex items-center gap-1">
            <Settings size={13} /> Edit
          </button>
        )}
        {isSupervisor && (
          <button onClick={() => { if (window.confirm("Delete this task?")) onDelete(task.id); }} style={{ color: COLORS.danger }} className="text-xs hover:opacity-80 ml-auto">
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

// Pulls an HLS stream straight from its source to this machine. Nothing passes
// through our storage, which is the entire point — but it also means the source
// server has to permit cross-origin reads, and many don't.
function VideoDownload({ link, taskTitle }) {
  const [state, setState] = useState("idle"); // idle | working | done | error
  const [progress, setProgress] = useState({ done: 0, total: 0, phase: "" });
  const [error, setError] = useState(null);
  const abortRef = useRef(null);

  const safeName = (taskTitle || link.label || "video").replace(/[^a-z0-9]+/gi, "_").slice(0, 60);

  const start = async () => {
    setState("working"); setError(null); setProgress({ done: 0, total: 0, phase: "manifest" });
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const { blob, extension } = await downloadHls(link.url, {
        signal: controller.signal,
        onProgress: setProgress,
      });
      saveBlob(blob, `${safeName}.${extension}`);
      setState("done");
    } catch (e) {
      if (e.name === "AbortError") { setState("idle"); return; }
      setError(
        e.code === "CORS"
          ? "This server won't allow the browser to download it directly."
          : (e.message || "Download failed.")
      );
      setState("error");
    } finally {
      abortRef.current = null;
    }
  };

  const cancel = () => { if (abortRef.current) abortRef.current.abort(); };

  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div style={{ backgroundColor: COLORS.bgElevated, borderColor: state === "error" ? COLORS.danger : COLORS.border }}
      className="rounded-lg border px-3 py-2.5">
      <div className="flex items-center gap-2">
        <LinkIcon size={13} style={{ color: COLORS.teal }} />
        <span style={{ color: COLORS.textMuted }} className="text-xs flex-1 truncate">{link.label}</span>

        {state === "idle" && (
          <button onClick={start} style={{ backgroundColor: COLORS.teal, color: "#04211D" }}
            className="rounded-lg px-3 py-1.5 text-xs font-bold hover:brightness-105 transition-all active:scale-[0.98] shrink-0">
            Download
          </button>
        )}
        {state === "working" && (
          <button onClick={cancel} style={{ borderColor: COLORS.border, color: COLORS.textMuted }}
            className="rounded-lg border px-3 py-1.5 text-xs font-semibold shrink-0">
            Cancel
          </button>
        )}
        {state === "done" && (
          <span style={{ color: COLORS.teal }} className="font-mono text-[11px] shrink-0">Saved ✓</span>
        )}
        {state === "error" && (
          <button onClick={start} style={{ borderColor: COLORS.border, color: COLORS.textMuted }}
            className="rounded-lg border px-3 py-1.5 text-xs font-semibold shrink-0">
            Retry
          </button>
        )}
      </div>

      {state === "working" && (
        <div className="mt-2">
          <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: COLORS.border }}>
            <div className="h-full rounded-full transition-all duration-200"
              style={{ width: `${pct}%`, backgroundColor: COLORS.teal }} />
          </div>
          <p style={{ color: COLORS.textFaint }} className="font-mono text-[10px] mt-1.5">
            {progress.phase === "manifest"
              ? "Reading playlist…"
              : `${progress.done} / ${progress.total} segments · ${pct}%`}
          </p>
        </div>
      )}

      {state === "error" && (
        <div className="mt-2">
          <p style={{ color: COLORS.danger }} className="text-[11px] leading-relaxed">{error}</p>
          <div className="flex items-center gap-2 mt-1.5">
            <button onClick={() => navigator.clipboard && navigator.clipboard.writeText(link.url)}
              style={{ color: COLORS.teal }} className="font-mono text-[10px] hover:opacity-80">
              Copy link
            </button>
            <span style={{ color: COLORS.textFaint }} className="text-[10px]">
              — paste into VLC (File → Open Network) or yt-dlp to grab it manually.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

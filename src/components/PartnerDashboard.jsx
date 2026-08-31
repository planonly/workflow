import React, { useState, useMemo } from "react";
import { COLORS, dayKey, displayNameFor, formatTime, formatFullDate, formatScriptsForTeleprompter } from "../lib/core";
import { ChatIcon, LogOut } from "./Icon";
import { DailyBars, StatCard } from "./shared";

// Flattens every video across every pending recording task that has
// scriptsData into one ordered list — a partner might have several such
// tasks pending at once, and "today's scripts" means all of it combined,
// not one task at a time. Excludes anything checked off before
// downloading, then hands off to the teleprompter-safe formatter, since
// this is the actual file a partner downloads and feeds into a
// voice-activated teleprompter — it deliberately produces something
// different from the labeled version shown inline elsewhere in the app,
// because a voice-matching teleprompter has no way to tell a spoken line
// apart from a bracketed instruction or a decorative separator, and gets
// stuck (or forces the partner to read stray symbols out loud) on anything
// that isn't literally meant to be spoken.
function buildCombinedScriptsText(recordingTasksWithScripts, excludedKeys) {
  const entries = [];
  recordingTasksWithScripts.forEach((task) => {
    (task.scriptsData || []).forEach((s, i) => {
      const key = `${task.id}:${i}`;
      if (!excludedKeys.has(key)) entries.push(s);
    });
  });
  return formatScriptsForTeleprompter(entries);
}

function RecordingCard({ task, allTasks, onMarkRecorded, sourceTask, excludedScriptKeys, onToggleScriptExcluded }) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [link, setLink] = useState("");
  const done = task.status === "done";
  const expected = (task.longFormCount || 0) + (task.shortsCount || 0);

  // Every piece spawned from this recording carries sourceRecordingId — this
  // is what makes the yield real rather than a guess: it's counting actual
  // linked tasks and their actual status, not approximating from one flag.
  const pieces = done ? allTasks.filter((t) => t.sourceRecordingId === task.id) : [];
  const finished = pieces.filter((p) => p.status === "done").length;
  const inProgress = pieces.filter((p) => p.status === "in_progress").length;

  return (
    <div style={{ backgroundColor: COLORS.bgCard, borderColor: done ? COLORS.border : COLORS.violet }} className="rounded-2xl border p-5">
      <div className="flex items-start justify-between gap-3 mb-2">
        <p style={{ color: COLORS.textPrimary }} className="font-semibold text-sm">{task.title}</p>
        <div className="flex items-center gap-2 shrink-0">
          {sourceTask && (
            <span style={{ backgroundColor: sourceTask.status === "done" ? COLORS.tealSoft : COLORS.bgElevated, color: sourceTask.status === "done" ? COLORS.teal : COLORS.textFaint }}
              className="font-mono text-[10px] rounded-full px-2 py-0.5">
              {sourceTask.status === "done" ? "Video posted" : "Editing in progress"}
            </span>
          )}
          {task.dueDate && !done && (
            <span style={{ color: COLORS.textFaint }} className="font-mono text-[11px]">Due {task.dueDate}</span>
          )}
        </div>
      </div>
      {expected > 0 && (
        <p style={{ color: COLORS.textFaint }} className="font-mono text-[10.5px] mb-2">
          {task.longFormCount || 0} long-form &middot; {task.shortsCount || 0} shorts
        </p>
      )}
      {!done && (
        <div style={{ backgroundColor: COLORS.bgElevated }} className="rounded-xl p-3 mb-3 max-h-48 overflow-y-auto">
          <p style={{ color: COLORS.textMuted }} className="text-sm whitespace-pre-wrap leading-relaxed">{task.script}</p>
        </div>
      )}
      {!done && Array.isArray(task.scriptsData) && task.scriptsData.length > 0 && excludedScriptKeys && (
        <div className="flex flex-col gap-1.5 mb-3">
          <p style={{ color: COLORS.textFaint }} className="font-mono text-[10px] tracking-[0.15em] uppercase">Include in download</p>
          {task.scriptsData.map((s, i) => {
            const key = `${task.id}:${i}`;
            const excluded = excludedScriptKeys.has(key);
            return (
              <label key={i} className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={!excluded} onChange={() => onToggleScriptExcluded(key)}
                  className="accent-current" style={{ color: COLORS.violet }} />
                <span style={{ color: excluded ? COLORS.textFaint : COLORS.textMuted }} className="text-xs truncate">
                  {s.videoTitle || `Script ${i + 1}`}
                </span>
              </label>
            );
          })}
        </div>
      )}
      {done ? (
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <div style={{ backgroundColor: COLORS.border }} className="flex-1 h-1.5 rounded-full overflow-hidden">
              <div style={{ backgroundColor: COLORS.teal, width: pieces.length ? `${(finished / pieces.length) * 100}%` : "0%" }} className="h-full rounded-full" />
            </div>
            <span style={{ color: COLORS.teal }} className="font-mono text-[11px] shrink-0 font-semibold">{finished} of {pieces.length || expected} done</span>
          </div>
          <p style={{ color: COLORS.textFaint }} className="text-[11px]">
            {inProgress > 0 ? `${inProgress} being edited right now` : finished === (pieces.length || expected) && pieces.length > 0 ? "All delivered." : "Sent — waiting to be picked up."}
          </p>
        </div>
      ) : linkOpen ? (
        <div className="flex gap-2">
          <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Paste the Dropbox link"
            style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, color: COLORS.textPrimary }}
            className="flex-1 rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2" />
          <button onClick={() => { if (link.trim()) onMarkRecorded(task.id, link.trim()); }}
            disabled={!link.trim()}
            style={{ backgroundColor: COLORS.violet, color: "#1A0B2E", opacity: link.trim() ? 1 : 0.4 }}
            className="rounded-lg px-4 py-2 text-sm font-bold shrink-0">
            Done
          </button>
        </div>
      ) : (
        <button onClick={() => setLinkOpen(true)} style={{ backgroundColor: COLORS.violetSoft, color: COLORS.violet }}
          className="rounded-lg px-4 py-2 text-sm font-bold hover:brightness-110 transition-all">
          Mark recorded
        </button>
      )}
    </div>
  );
}

export default function PartnerDashboard({ user, profiles, channel, workflows, runs, progress, attendance, tasks, onMarkRecorded, onOpenDay, onOpenMessages, unreadRoomCount, onOpenProfile, onSignOut }) {
  // Which individual scripts are excluded from the next download, keyed
  // "taskId:videoIndex" so exclusions work independently across however
  // many separate script tasks are currently pending, not just within one.
  const [excludedScriptKeys, setExcludedScriptKeys] = useState(() => new Set());
  const toggleScriptExcluded = (key) => {
    setExcludedScriptKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };
  const myPendingRecordings = useMemo(
    () => tasks.filter((t) => t.taskType === "record" && t.assignedToUid === user.uid && t.status !== "done")
      .sort((a, b) => (a.dueDate || "9999") < (b.dueDate || "9999") ? -1 : 1),
    [tasks, user.uid]
  );
  const myCompletedRecordings = useMemo(
    () => tasks.filter((t) => t.taskType === "record" && t.assignedToUid === user.uid && t.status === "done")
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
      .slice(0, 6),
    [tasks, user.uid]
  );

  // Which of the currently-pending recordings have anchor-script data
  // attached — the pool "download today's scripts" draws from. These are
  // ordinary recording tasks, just ones that happen to carry structured
  // script data alongside the flat text already shown inline on the card.
  const myPendingRecordingsWithScripts = useMemo(
    () => myPendingRecordings.filter((t) => Array.isArray(t.scriptsData) && t.scriptsData.length > 0),
    [myPendingRecordings]
  );

  const dailyData = useMemo(() => {
    const days = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const key = dayKey(d.toISOString());
      const dayRuns = runs.filter((r) => dayKey(r.completedAt) === key);
      const wfType = (id) => (workflows.find((w) => w.id === id) || {}).contentType || "long";
      days.push({
        key,
        long: dayRuns.filter((r) => wfType(r.workflowId) === "long").length,
        short: dayRuns.filter((r) => wfType(r.workflowId) === "short").length,
      });
    }
    return days;
  }, [runs, workflows]);

  const last7 = runs.filter((r) => (Date.now() - new Date(r.completedAt).getTime()) < 7 * 86400000);
  const last7Prev = runs.filter((r) => {
    const age = Date.now() - new Date(r.completedAt).getTime();
    return age >= 7 * 86400000 && age < 14 * 86400000;
  });
  // "Videos" and their week-over-week trend should mean the same thing —
  // a checking run isn't a video, so it's excluded from both, otherwise the
  // trend percentage wouldn't relate to the video count shown right next to it.
  const isVideoRun = (r) => (workflows.find((w) => w.id === r.workflowId) || {}).contentType !== "checking";
  const last7Videos = last7.filter(isVideoRun);
  const last7PrevVideos = last7Prev.filter(isVideoRun);
  const trend = last7PrevVideos.length === 0 ? null : Math.round(((last7Videos.length - last7PrevVideos.length) / last7PrevVideos.length) * 100);
  const last7LongCount = last7Videos.filter((r) => (workflows.find((w) => w.id === r.workflowId) || {}).contentType !== "short").length;
  const last7ShortsCount = last7Videos.filter((r) => (workflows.find((w) => w.id === r.workflowId) || {}).contentType === "short").length;

  const workflowIds = new Set(workflows.map((w) => w.id));
  const liveNow = Object.values(progress || {}).filter((pr) => {
    if (!pr || !pr.uid || !pr.lastActiveAt || pr.isComplete) return false;
    if (!workflowIds.has(pr.workflowId)) return false;
    const anyTime = Object.values(pr.stepTimes || {}).some((t) => t > 0);
    if (!((pr.stepIndex || 0) > 0 || anyTime)) return false;
    const ageMins = (Date.now() - new Date(pr.lastActiveAt).getTime()) / 60000;
    return ageMins <= 60;
  }).map((pr) => {
    const wf = workflows.find((w) => w.id === pr.workflowId) || {};
    const tk = pr.taskId ? tasks.find((t) => t.id === pr.taskId) : null;
    return {
      name: displayNameFor(pr.uid, profiles),
      // Deliberately no step number or step text here — a partner sees that
      // someone's working, not the internal detail of what step they're on.
      workflowTitle: wf.title || "a workflow",
      contentType: wf.contentType || "long",
      taskTitle: tk ? tk.title : null,
      paused: !!pr.paused,
    };
  });

  // The channel's actual editing queue — not just who's active right now,
  // but what's waiting and what's underway, so the partner can see the
  // pipeline state without asking anyone directly.
  const channelTasks = tasks.filter((t) => t.taskType !== "record" && t.channelId === (channel && channel.id) && (t.status === "pending" || t.status === "in_progress"));

  // Same ordering editors themselves see — grouped by person, each in their
  // own real priority sequence, not an arbitrary list. This is what makes
  // "editing queue" actually mean something rather than just being a filter.
  const channelTasksSorted = useMemo(() => {
    const byEditor = {};
    channelTasks.forEach((t) => { (byEditor[t.assignedToUid] = byEditor[t.assignedToUid] || []).push(t); });
    const sortByOrder = (arr) => [...arr].sort((a, b) => {
      const ao = a.order != null ? a.order : Infinity;
      const bo = b.order != null ? b.order : Infinity;
      if (ao !== bo) return ao - bo;
      return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    });
    const uids = Object.keys(byEditor).sort((a, b) => displayNameFor(a, profiles).localeCompare(displayNameFor(b, profiles)));
    return uids.flatMap((uid) => sortByOrder(byEditor[uid]).map((t, i) => ({ ...t, _rank: i + 1, _editorName: displayNameFor(uid, profiles) })));
  }, [channelTasks, profiles]);

  const channelUids = new Set((channel && channel.memberUids) || []);
  const today = dayKey(new Date().toISOString());
  const attendanceToday = Object.values(attendance || {})
    .filter((rec) => rec.date === today && channelUids.has(rec.uid))
    .map((rec) => ({ ...rec, name: displayNameFor(rec.uid, profiles) }));

  return (
    <div className="flex-1 flex flex-col max-w-5xl w-full mx-auto px-6 py-8 sm:py-10 overflow-y-auto fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 style={{ color: COLORS.textPrimary }} className="text-2xl sm:text-3xl font-bold">{channel ? channel.name : "Your channel"}</h2>
          <p style={{ color: COLORS.textFaint }} className="text-sm mt-0.5">Welcome back, {displayNameFor(user.uid, profiles, user.email)}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onOpenMessages} aria-label="Messages" style={{ borderColor: COLORS.border, color: COLORS.textMuted }} className="relative rounded-full border p-2 hover:brightness-150 transition-all">
            <ChatIcon size={18} />
            {unreadRoomCount > 0 && (
              <span style={{ backgroundColor: COLORS.teal, color: "#04211D" }} className="absolute -top-1.5 -right-1.5 rounded-full w-4 h-4 text-[9px] font-bold flex items-center justify-center">
                {unreadRoomCount > 9 ? "9+" : unreadRoomCount}
              </span>
            )}
          </button>
          <button onClick={onOpenProfile} className="flex items-center gap-2 hover:opacity-80 transition-opacity" aria-label="Your profile" title="Your profile">
            <div style={{ backgroundColor: COLORS.tealSoft, color: COLORS.teal }} className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs shrink-0">
              {displayNameFor(user.uid, profiles, user.email).slice(0, 1).toUpperCase()}
            </div>
          </button>
          <button onClick={onSignOut} aria-label="Sign out" style={{ borderColor: COLORS.border, color: COLORS.textMuted }} className="rounded-full border p-2 hover:brightness-150 transition-all">
            <LogOut size={18} />
          </button>
        </div>
      </div>

      {/* Recording queue — the one thing that's actually actionable, so it comes
          first. Always shown, even when empty — a section that just vanishes
          when there's nothing to show is indistinguishable from being broken. */}
      <div className="mb-8">
        <div className="flex items-center justify-between gap-3 mb-3">
          <p style={{ color: COLORS.violet }} className="font-mono text-[11px] tracking-[0.2em] uppercase">Scripts to record</p>
          {myPendingRecordingsWithScripts.length > 0 && (
            <button onClick={() => {
              const text = buildCombinedScriptsText(myPendingRecordingsWithScripts, excludedScriptKeys);
              if (!text) return;
              const blob = new Blob([text], { type: "text/plain" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `scripts-${dayKey(new Date().toISOString())}.txt`;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              URL.revokeObjectURL(url);
            }}
              disabled={myPendingRecordingsWithScripts.every((t) => (t.scriptsData || []).every((s, i) => excludedScriptKeys.has(`${t.id}:${i}`)))}
              style={{ backgroundColor: COLORS.violetSoft, color: COLORS.violet }}
              className="rounded-lg px-3 py-1.5 text-xs font-bold hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed shrink-0">
              Download today's scripts
            </button>
          )}
        </div>
        {myPendingRecordings.length > 0 ? (
          <div className="flex flex-col gap-3">
            {myPendingRecordings.map((t) => (
              <RecordingCard key={t.id} task={t} allTasks={tasks} onMarkRecorded={onMarkRecorded}
                sourceTask={t.sourceTaskId ? tasks.find((x) => x.id === t.sourceTaskId) : null}
                excludedScriptKeys={excludedScriptKeys} onToggleScriptExcluded={toggleScriptExcluded} />
            ))}
          </div>
        ) : (
          <div style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border }} className="rounded-2xl border p-5">
            <p style={{ color: COLORS.textFaint }} className="text-sm italic">Nothing here yet — new scripts will show up here as soon as there's one ready.</p>
          </div>
        )}
      </div>

      {myCompletedRecordings.length > 0 && (
        <div className="mb-8">
          <p style={{ color: COLORS.violet }} className="font-mono text-[11px] tracking-[0.2em] uppercase mb-3">Sent for editing</p>
          <div className="flex flex-col gap-3">
            {myCompletedRecordings.map((t) => <RecordingCard key={t.id} task={t} allTasks={tasks} onMarkRecorded={onMarkRecorded} />)}
          </div>
        </div>
      )}

      {/* Performance pulse */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <StatCard label="Videos, last 7 days" value={last7Videos.length} color={last7Videos.length === 0 ? COLORS.textFaint : COLORS.textPrimary} />
        <StatCard label="Long-form" value={last7LongCount} color={last7LongCount === 0 ? COLORS.textFaint : COLORS.teal} />
        <StatCard label="Shorts" value={last7ShortsCount} color={last7ShortsCount === 0 ? COLORS.textFaint : COLORS.orange} />
        <StatCard label="Trend vs prior week" value={trend == null ? "—" : `${trend > 0 ? "+" : ""}${trend}%`} color={trend == null ? COLORS.textFaint : trend >= 0 ? COLORS.teal : COLORS.danger} />
      </div>

      <div style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border }} className="rounded-2xl border p-5 mb-6">
        <DailyBars days={dailyData} onOpenDay={onOpenDay} />
      </div>

      {/* Live tracker — step-free */}
      {liveNow.length > 0 && (
        <div style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border }} className="rounded-2xl border p-5 mb-6">
          <p style={{ color: COLORS.textFaint }} className="font-mono text-[11px] tracking-[0.2em] uppercase mb-3">Working on right now</p>
          <div className="flex flex-col gap-2">
            {liveNow.map((a, i) => (
              <div key={i} className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <span style={{ backgroundColor: a.contentType === "short" ? COLORS.orangeSoft : a.contentType === "checking" ? COLORS.violetSoft : COLORS.tealSoft, color: a.contentType === "short" ? COLORS.orange : a.contentType === "checking" ? COLORS.violet : COLORS.teal }}
                    className="font-mono text-[9px] rounded-full px-1.5 py-0.5 shrink-0 uppercase">
                    {a.contentType === "short" ? "Short" : a.contentType === "checking" ? "Checking" : "Long"}
                  </span>
                  <span style={{ color: COLORS.textPrimary }} className="text-sm truncate">{a.name} — {a.taskTitle || a.workflowTitle}</span>
                </div>
                {a.paused && <span style={{ color: COLORS.orange }} className="font-mono text-[10px] shrink-0">paused</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* The channel's editing queue — what's waiting and what's underway */}
      {channelTasksSorted.length > 0 && (
        <div style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border }} className="rounded-2xl border p-5 mb-6">
          <p style={{ color: COLORS.textFaint }} className="font-mono text-[11px] tracking-[0.2em] uppercase mb-3">Editing queue</p>
          <div className="flex flex-col gap-2">
            {channelTasksSorted.map((t, i) => (
              <React.Fragment key={t.id}>
                {(i === 0 || channelTasksSorted[i - 1]._editorName !== t._editorName) && (
                  <p style={{ color: COLORS.textFaint }} className="font-mono text-[10px] tracking-[0.15em] uppercase mt-2 first:mt-0">{t._editorName}</p>
                )}
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <span style={{ backgroundColor: COLORS.violetSoft, color: COLORS.violet }} className="font-mono text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center shrink-0">
                      {t._rank}
                    </span>
                    <span style={{ backgroundColor: t.contentType === "short" ? COLORS.orangeSoft : t.contentType === "checking" ? COLORS.violetSoft : COLORS.tealSoft, color: t.contentType === "short" ? COLORS.orange : t.contentType === "checking" ? COLORS.violet : COLORS.teal }}
                      className="font-mono text-[9px] rounded-full px-1.5 py-0.5 shrink-0 uppercase">
                      {t.contentType === "short" ? "Short" : t.contentType === "checking" ? "Checking" : "Long"}
                    </span>
                    <span style={{ color: COLORS.textPrimary }} className="text-sm truncate">{t.title}</span>
                  </div>
                  <span style={{ backgroundColor: t.status === "in_progress" ? COLORS.orangeSoft : COLORS.bgElevated, color: t.status === "in_progress" ? COLORS.orange : COLORS.textFaint }}
                    className="font-mono text-[10px] rounded-full px-2 py-0.5 shrink-0">
                    {t.status === "in_progress" ? "In progress" : "Pending"}
                  </span>
                </div>
              </React.Fragment>
            ))}
          </div>
        </div>
      )}

      {/* Attendance — read only, today's snapshot */}
      <div style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border }} className="rounded-2xl border p-5">
        <p style={{ color: COLORS.textFaint }} className="font-mono text-[11px] tracking-[0.2em] uppercase mb-3">Team today</p>
        {attendanceToday.length === 0 ? (
          <p style={{ color: COLORS.textFaint }} className="text-sm italic">Nobody's clocked in yet today.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {attendanceToday.map((rec) => (
              <div key={rec.uid} className="flex items-center justify-between gap-3">
                <span style={{ color: COLORS.textPrimary }} className="text-sm">{rec.name}</span>
                <span style={{ color: rec.punchOut ? COLORS.textFaint : rec.onBreak ? COLORS.orange : COLORS.teal }} className="font-mono text-xs">
                  {rec.punchOut ? "Clocked out" : rec.onBreak ? "On break" : "On the clock"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

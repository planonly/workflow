import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { COLORS, formatTime, dayKey, attendanceWorkedSeconds, attendanceGrossSeconds, attendanceBreakSeconds, formatClock, displayNameFor, formatFullDate, runCode, youtubeThumbnailUrl } from "../lib/core";
import { ArrowLeft, ArrowRight, HomeIcon } from "./Icon";
import { StatCard } from "./shared";


export default function DayDetailScreen({ dateKey, workflows, runs, profiles, channels, channelId, attendance, onChangeDate, onBack, onUpdateRun }) {
  const scopedWorkflowIds = channelId ? new Set(workflows.filter((w) => w.channelId === channelId).map((w) => w.id)) : null;
  // A true page-level filter, not a display grouping — scopeMode picks the
  // dimension, scopeEditor/scopeChannel hold the specific selection within
  // it. Everything on the page derives from the same filtered dayRuns
  // below, so metrics, attendance, and the activity list can never show
  // three different scopes at once the way the old per-section grouping did.
  const [scopeMode, setScopeMode] = useState("none"); // none | editor | channel
  const [scopeEditor, setScopeEditor] = useState("all");
  const [scopeChannel, setScopeChannel] = useState("all");
  const dayRunsUnfiltered = useMemo(
    () => runs.filter((r) => dayKey(r.completedAt) === dateKey && (!scopedWorkflowIds || scopedWorkflowIds.has(r.workflowId))),
    [runs, dateKey, channelId]
  );
  const workflowById = useMemo(() => {
    const m = {};
    workflows.forEach((w) => { m[w.id] = w; });
    return m;
  }, [workflows]);
  // Only offer editors/channels that actually have activity this day — no
  // point scrolling through the whole team or every channel to find the
  // handful that were active.
  const editorsToday = useMemo(() => {
    const uids = new Set(dayRunsUnfiltered.map((r) => r.completedByUid).filter(Boolean));
    return Array.from(uids).map((uid) => ({ uid, name: displayNameFor(uid, profiles) }));
  }, [dayRunsUnfiltered, profiles]);
  const channelsToday = useMemo(() => {
    const ids = new Set(dayRunsUnfiltered.map((r) => (workflowById[r.workflowId] || {}).channelId).filter(Boolean));
    return Array.from(ids).map((id) => ({ id, name: (channels.find((c) => c.id === id) || {}).name || "Unknown channel" }));
  }, [dayRunsUnfiltered, workflowById, channels]);
  const dayRuns = useMemo(() => {
    if (scopeMode === "editor" && scopeEditor !== "all") return dayRunsUnfiltered.filter((r) => r.completedByUid === scopeEditor);
    if (scopeMode === "channel" && scopeChannel !== "all") return dayRunsUnfiltered.filter((r) => (workflowById[r.workflowId] || {}).channelId === scopeChannel);
    return dayRunsUnfiltered;
  }, [dayRunsUnfiltered, scopeMode, scopeEditor, scopeChannel, workflowById]);
  const totalTime = dayRuns.reduce((s, r) => s + r.totalSeconds, 0);
  const isShort = (r) => (workflowById[r.workflowId] || {}).contentType === "short";
  const isChecking = (r) => (workflowById[r.workflowId] || {}).contentType === "checking";
  const videoRuns = dayRuns.filter((r) => !isChecking(r));
  const checksCount = dayRuns.filter(isChecking).length;
  const shortsCount = videoRuns.filter(isShort).length;
  const longCount = videoRuns.length - shortsCount;

  const byEditor = {};
  dayRuns.forEach((r) => {
    const eid = r.completedByUid || "unknown";
    if (!byEditor[eid]) byEditor[eid] = { uid: eid, videos: 0, time: 0 };
    byEditor[eid].videos += 1;
    byEditor[eid].time += r.totalSeconds;
  });
  const editorList = Object.values(byEditor)
    .map((e) => ({ ...e, name: displayNameFor(e.uid, profiles, e.uid === "unknown" ? null : undefined) }))
    .sort((a, b) => b.time - a.time);

  // Attendance follows the same scope: a specific editor selected shows
  // just their record; a specific channel selected shows the attendance of
  // whoever actually worked on that channel this day (derived from the
  // already-scoped dayRuns above, not a separate channel field on the
  // attendance record itself, since attendance isn't recorded per channel).
  const attendanceForDay = useMemo(() => {
    const scopedUids = scopeMode === "editor" && scopeEditor !== "all" ? new Set([scopeEditor])
      : scopeMode === "channel" && scopeChannel !== "all" ? new Set(dayRuns.map((r) => r.completedByUid).filter(Boolean))
      : null;
    return Object.entries(attendance || {})
      .filter(([, rec]) => rec.date === dateKey)
      // This tracks the team's production hours, not whoever happened to
      // punch in — an admin's own clock record isn't part of that.
      .filter(([, rec]) => (profiles[rec.uid] || {}).role !== "admin")
      .filter(([, rec]) => !scopedUids || scopedUids.has(rec.uid))
      .map(([key, rec]) => ({
        ...rec, key, name: displayNameFor(rec.uid, profiles),
        gross: attendanceGrossSeconds(rec), breakTime: attendanceBreakSeconds(rec), worked: attendanceWorkedSeconds(rec),
      }))
      .sort((a, b) => new Date(a.punchIn) - new Date(b.punchIn));
  }, [attendance, dateKey, profiles, scopeMode, scopeEditor, scopeChannel, dayRuns]);

  const shiftDay = (delta) => {
    const d = new Date(dateKey + "T00:00:00");
    d.setDate(d.getDate() + delta);
    onChangeDate(d.toISOString().slice(0, 10));
  };

  const isToday = dateKey === new Date().toISOString().slice(0, 10);

  return (
    <div className="flex-1 flex flex-col max-w-3xl w-full mx-auto px-6 py-8 sm:py-10 overflow-y-auto fade-in">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h2 style={{ color: COLORS.textPrimary }} className="text-2xl sm:text-3xl font-bold">Day view</h2>
        <button onClick={onBack} aria-label="Home" style={{ borderColor: COLORS.border, color: COLORS.textMuted }} className="rounded-full border p-2 hover:opacity-80 transition-opacity"><HomeIcon size={18} /></button>
      </div>

      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <button onClick={() => shiftDay(-1)} aria-label="Previous day" style={{ borderColor: COLORS.border, color: COLORS.textMuted }} className="rounded-full border p-2 hover:opacity-80 transition-opacity"><ArrowLeft size={16} /></button>
        <input type="date" value={dateKey} onChange={(e) => onChangeDate(e.target.value)}
          style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, color: COLORS.textPrimary }}
          className="rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2" />
        <button onClick={() => shiftDay(1)} disabled={isToday} aria-label="Next day" style={{ borderColor: COLORS.border, color: COLORS.textMuted, opacity: isToday ? 0.35 : 1 }} className="rounded-full border p-2 hover:opacity-80 transition-opacity disabled:cursor-not-allowed"><ArrowRight size={16} /></button>
        <p style={{ color: COLORS.textFaint }} className="font-mono text-sm ml-1">{formatFullDate(dateKey)}</p>
      </div>

      {/* This is a page-level scope, not a display option for one section —
          picking Editor or Channel here filters the metrics, attendance,
          and activity list below all at once, from the same source. "By
          editor" only appears as a dimension when there's more than one
          editor's work to actually filter by, and "By channel" only when
          this view isn't already scoped to one channel from elsewhere in
          the app — offering a dimension that would trivially produce one
          result isn't a real choice. */}
      <div className="flex items-center gap-2 mb-6 flex-wrap">
        <div className="flex items-center gap-1 rounded-lg p-0.5" style={{ backgroundColor: COLORS.bgElevated }}>
          <p style={{ color: COLORS.textFaint }} className="font-mono text-[10px] px-1.5">Scope</p>
          {[["none", "Everyone"], ...(editorsToday.length > 1 ? [["editor", "Editor"]] : []), ...(!channelId && channelsToday.length > 1 ? [["channel", "Channel"]] : [])].map(([value, label]) => (
            <button key={value} onClick={() => setScopeMode(value)}
              style={{ backgroundColor: scopeMode === value ? COLORS.teal : "transparent", color: scopeMode === value ? "#04211D" : COLORS.textFaint }}
              className="rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors">
              {label}
            </button>
          ))}
        </div>
        {scopeMode === "editor" && (
          <select value={scopeEditor} onChange={(e) => setScopeEditor(e.target.value)}
            style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, color: COLORS.textPrimary }}
            className="rounded-lg border px-2.5 py-2 text-sm outline-none focus:ring-2">
            <option value="all">Everyone</option>
            {editorsToday.map((e) => <option key={e.uid} value={e.uid}>{e.name}</option>)}
          </select>
        )}
        {scopeMode === "channel" && (
          <select value={scopeChannel} onChange={(e) => setScopeChannel(e.target.value)}
            style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, color: COLORS.textPrimary }}
            className="rounded-lg border px-2.5 py-2 text-sm outline-none focus:ring-2">
            <option value="all">All channels</option>
            {channelsToday.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
      </div>

      {scopeMode === "editor" && scopeEditor !== "all" && (
        <EditorDailyReport
          editorName={displayNameFor(scopeEditor, profiles)}
          attendanceRecord={attendanceForDay[0] || null}
          taskSeconds={totalTime}
          videoCount={videoRuns.length}
        />
      )}

      <div className="grid grid-cols-3 gap-3 mb-3">
        <StatCard label="Videos posted" value={videoRuns.length} color={videoRuns.length === 0 ? COLORS.textFaint : COLORS.textPrimary} />
        <StatCard label="Long-form" value={longCount} color={longCount === 0 ? COLORS.textFaint : COLORS.teal} />
        <StatCard label="Shorts" value={shortsCount} color={shortsCount === 0 ? COLORS.textFaint : COLORS.orange} />
      </div>
      <div className={checksCount > 0 ? "grid grid-cols-3 gap-3 mb-6" : "grid grid-cols-2 gap-3 mb-6"}>
        {checksCount > 0 && <StatCard label="Checks" value={checksCount} color={COLORS.violet} />}
        <StatCard label="Time worked" value={formatTime(totalTime)} color={totalTime === 0 ? COLORS.textFaint : COLORS.orange} />
        <StatCard label="Active editors" value={editorList.length} color={editorList.length === 0 ? COLORS.textFaint : COLORS.violet} />
      </div>

      <div style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border }} className="rounded-2xl border p-5 mb-5">
        <p style={{ color: COLORS.textFaint }} className="font-mono text-[11px] tracking-[0.2em] uppercase mb-4">Attendance</p>
        {attendanceForDay.length === 0 ? (
          <p style={{ color: COLORS.textFaint }} className="text-sm italic">No one punched in this day.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {attendanceForDay.map((rec) => (
              <div key={rec.uid} className="flex items-center gap-3">
                <div style={{ backgroundColor: COLORS.tealSoft, color: COLORS.teal }} className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs shrink-0">
                  {rec.name.slice(0, 1).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p style={{ color: COLORS.textPrimary }} className="text-sm font-semibold truncate">{rec.name}</p>
                  <p style={{ color: COLORS.textFaint }} className="font-mono text-[11px]">
                    {formatClock(rec.punchIn)} – {rec.punchOut ? formatClock(rec.punchOut) : "now"}
                    {rec.breaks && rec.breaks.length > 0 ? ` · ${rec.breaks.length} break${rec.breaks.length === 1 ? "" : "s"}` : ""}
                  </p>
                </div>
                <p style={{ color: rec.worked === 0 ? COLORS.textFaint : COLORS.orange }} className="font-mono text-xs font-semibold shrink-0">{formatTime(rec.worked)}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border }} className="rounded-2xl border p-5 mb-4">
        <p style={{ color: COLORS.textPrimary }} className="text-sm font-bold mb-4">Activity this day</p>
        {dayRuns.length === 0 ? (
          <p style={{ color: COLORS.textFaint }} className="text-sm italic">{scopeMode === "none" ? "Nothing posted this day." : "Nothing in this scope today."}</p>
        ) : (
          <div className="flex flex-col gap-2">
            {dayRuns.map((r) => <DayRunRow key={r.id} run={r} profiles={profiles} onUpdateRun={onUpdateRun} />)}
          </div>
        )}
      </div>
    </div>
  );
}

// The structured per-editor daily report — everything laid out to be read
// at a glance and questioned in a meeting: what time they were actually
// clocked in for, exactly which breaks they took and how long each ran,
// how that adds up to worked time, and — the number that actually matters
// for accountability — how much of that worked time shows up as completed
// tasks versus not.
function EditorDailyReport({ editorName, attendanceRecord, taskSeconds, videoCount }) {
  const utilization = attendanceRecord && attendanceRecord.worked > 0
    ? Math.round((taskSeconds / attendanceRecord.worked) * 100)
    : null;
  const utilizationColor = utilization === null ? COLORS.textFaint
    : utilization >= 70 ? COLORS.teal
    : utilization >= 40 ? COLORS.orange
    : COLORS.danger;

  return (
    <div style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.violet }} className="rounded-2xl border p-5 mb-6">
      <p style={{ color: COLORS.violet }} className="font-mono text-[11px] tracking-[0.2em] uppercase mb-4">{editorName} — daily report</p>

      {!attendanceRecord ? (
        <p style={{ color: COLORS.textFaint }} className="text-sm italic mb-1">
          Didn't punch in this day{taskSeconds > 0 ? ` — but logged ${formatTime(taskSeconds)} on ${videoCount} video${videoCount === 1 ? "" : "s"} with no attendance record at all.` : "."}
        </p>
      ) : (
        <>
          <p style={{ color: COLORS.textPrimary }} className="text-sm mb-4">
            Punched in <span style={{ color: COLORS.teal }} className="font-mono font-semibold">{formatClock(attendanceRecord.punchIn)}</span>
            {" "}→{" "}
            <span style={{ color: COLORS.teal }} className="font-mono font-semibold">{attendanceRecord.punchOut ? formatClock(attendanceRecord.punchOut) : "still clocked in"}</span>
          </p>

          <div className="grid grid-cols-3 gap-3 mb-4">
            <StatCard label="Punched in for" value={formatTime(attendanceRecord.gross)} color={COLORS.textPrimary} />
            <StatCard label="On break" value={formatTime(attendanceRecord.breakTime)} color={COLORS.orange} />
            <StatCard label="Actually worked" value={formatTime(attendanceRecord.worked)} color={COLORS.teal} />
          </div>

          {attendanceRecord.breaks && attendanceRecord.breaks.length > 0 && (
            <div className="mb-4">
              <p style={{ color: COLORS.textFaint }} className="font-mono text-[10px] tracking-[0.15em] uppercase mb-2">
                {attendanceRecord.breaks.length} break{attendanceRecord.breaks.length === 1 ? "" : "s"} taken
              </p>
              <div className="flex flex-col gap-1.5">
                {attendanceRecord.breaks.map((b, i) => {
                  const durationSec = b.end ? (new Date(b.end) - new Date(b.start)) / 1000 : null;
                  return (
                    <div key={i} className="flex items-center justify-between gap-3">
                      <span style={{ color: COLORS.textMuted }} className="font-mono text-xs">
                        {formatClock(b.start)} – {b.end ? formatClock(b.end) : "ongoing"}
                      </span>
                      <span style={{ color: COLORS.textFaint }} className="font-mono text-xs">
                        {durationSec !== null ? formatTime(durationSec) : "—"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="pt-4" style={{ borderTop: `1px solid ${COLORS.border}` }}>
            <div className="flex items-center justify-between gap-3">
              <p style={{ color: COLORS.textMuted }} className="text-sm">
                Logged {formatTime(taskSeconds)} on {videoCount} video{videoCount === 1 ? "" : "s"} against {formatTime(attendanceRecord.worked)} worked
              </p>
              {utilization !== null && (
                <p style={{ color: utilizationColor }} className="font-mono text-sm font-bold shrink-0">{utilization}%</p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function DayRunRow({ run: r, profiles, onUpdateRun }) {
  const [open, setOpen] = useState(false);
  const [ytInput, setYtInput] = useState("");
  const [ytTitleInput, setYtTitleInput] = useState("");
  const [ytErr, setYtErr] = useState("");
  const steps = (r.stepOrder || []).map((id) => ({
    id, label: (r.stepLabels || {})[id] || id, seconds: (r.stepTimes || {})[id] || 0,
  }));
  const isShort = r.contentType === "short";
  const isChecking = r.contentType === "checking";
  const thumb = youtubeThumbnailUrl(r.youtubeUrl);

  const saveYoutubeLink = () => {
    const thumbCheck = youtubeThumbnailUrl(ytInput.trim());
    if (!thumbCheck) { setYtErr("That doesn't look like a YouTube link."); return; }
    setYtErr("");
    onUpdateRun({ ...r, youtubeUrl: ytInput.trim(), youtubeTitle: ytTitleInput.trim() || null });
    setYtInput(""); setYtTitleInput("");
  };

  return (
    <div style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border }} className="rounded-lg border px-3 py-2">
      <div className="flex items-start gap-3">
        {thumb && (
          <a href={r.youtubeUrl} target="_blank" rel="noopener noreferrer" className="shrink-0 rounded-lg overflow-hidden" style={{ width: 106, height: 60 }}>
            <img src={thumb} alt="" className="w-full h-full object-cover" />
          </a>
        )}
        <button onClick={() => setOpen((o) => !o)} className="flex-1 min-w-0 text-left">
          {/* The real YouTube title once it's linked — falls back to the task/workflow title before then. */}
          <p style={{ color: COLORS.textPrimary }} className="text-sm font-semibold truncate">{r.youtubeTitle || r.taskTitle || r.workflowTitle || "Untitled"}</p>
          {r.youtubeTitle && (r.taskTitle || r.workflowTitle) && (
            <p style={{ color: COLORS.textFaint }} className="font-mono text-[10px] truncate">{r.taskTitle || r.workflowTitle}</p>
          )}
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span style={{ color: COLORS.violet }} className="font-mono text-xs font-bold shrink-0">{runCode(r.id)}</span>
            <span style={{ backgroundColor: isShort ? COLORS.orangeSoft : isChecking ? COLORS.violetSoft : COLORS.tealSoft, color: isShort ? COLORS.orange : isChecking ? COLORS.violet : COLORS.teal }}
              className="font-mono text-[9px] rounded-full px-1.5 py-0.5 shrink-0 uppercase">
              {isShort ? "Short" : isChecking ? "Checking" : "Long"}
            </span>
            <span style={{ color: COLORS.textFaint }} className="font-mono text-[11px] shrink-0">{displayNameFor(r.completedByUid, profiles, r.completedBy)} · {formatClock(r.completedAt)}</span>
            <span style={{ color: COLORS.textMuted }} className="font-mono text-[11px] font-semibold shrink-0">{formatTime(r.totalSeconds)}</span>
            <span style={{ color: COLORS.teal }} className="font-mono text-[10px] shrink-0">{open ? "Hide" : "Steps"}</span>
          </div>
        </button>
      </div>
      {open && steps.length > 0 && (
        <div className="mt-2 pt-2 flex flex-col gap-1" style={{ borderTop: `1px solid ${COLORS.border}` }}>
          {steps.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-3">
              <span style={{ color: COLORS.textMuted }} className="text-xs flex-1 truncate">{s.label}</span>
              <span style={{ color: COLORS.textFaint }} className="font-mono text-[11px] shrink-0">{formatTime(s.seconds)}</span>
            </div>
          ))}
        </div>
      )}
      {open && onUpdateRun && (
        <div className="mt-2 pt-2" style={{ borderTop: `1px solid ${COLORS.border}` }}>
          {r.youtubeUrl ? (
            <div className="flex items-center justify-between gap-2">
              <a href={r.youtubeUrl} target="_blank" rel="noopener noreferrer" style={{ color: COLORS.teal }} className="text-xs truncate hover:opacity-80">{r.youtubeUrl}</a>
              <button onClick={() => onUpdateRun({ ...r, youtubeUrl: null, youtubeTitle: null })} style={{ color: COLORS.textFaint }} className="font-mono text-[10px] shrink-0 hover:opacity-80">Remove</button>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <input value={ytInput} onChange={(e) => setYtInput(e.target.value)} placeholder="Paste the YouTube link once it's posted"
                style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border, color: COLORS.textPrimary }}
                className="rounded-lg border px-2.5 py-1.5 text-xs outline-none focus:ring-2" />
              <div className="flex items-center gap-2">
                <input value={ytTitleInput} onChange={(e) => setYtTitleInput(e.target.value)} placeholder="Paste the video's title too"
                  style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border, color: COLORS.textPrimary }}
                  className="flex-1 rounded-lg border px-2.5 py-1.5 text-xs outline-none focus:ring-2 min-w-0" />
                <button onClick={saveYoutubeLink} style={{ backgroundColor: COLORS.teal, color: "#04211D" }} className="rounded-lg px-3 py-1.5 text-xs font-semibold shrink-0 hover:brightness-105">Save</button>
              </div>
            </div>
          )}
          {ytErr && <p style={{ color: COLORS.danger }} className="text-[10px] mt-1">{ytErr}</p>}
        </div>
      )}
    </div>
  );
}

/* ------------------------- RUN MODE ------------------------- */


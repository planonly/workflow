// Everything the Tasks screen says ABOUT a task that isn't stored on the task
// itself: how close its due date is, whether someone is editing it this
// minute, whether Clip Studio has a package for it, what has been posted from
// it. Kept free of React so each rule can be checked on its own.

import { dayKey, displayNameFor } from "./core";

const DAY = 86400000;
const atMidnight = (dk) => new Date(dk + "T00:00:00").getTime();
export const shortDate = (dk) => {
  try { return new Date(dk + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" }); } catch (e) { return dk; }
};

// Due dates are plain local calendar days ("2026-11-14"), so they are compared
// with the viewer's own local day — never the UTC day, which is a day behind
// for the first 5½ hours of every day in India.
export function dueInfo(task, todayDk) {
  if (!task || !task.dueDate || task.status === "done") return null;
  const today = todayDk || dayKey(new Date().toISOString());
  const days = Math.round((atMidnight(task.dueDate) - atMidnight(today)) / DAY);
  if (days < 0) return { days, overdue: true, tone: "red", text: `Overdue by ${-days} day${days === -1 ? "" : "s"}` };
  if (days === 0) return { days, soon: true, tone: "orange", text: "Due today" };
  if (days === 1) return { days, soon: true, tone: "grey", text: "Due tomorrow" };
  return { days, tone: "grey", text: `Due ${shortDate(task.dueDate)}` };
}

const people = (v) => (Array.isArray(v) ? v : (v || "").split("\n")).map((x) => (x || "").trim()).filter(Boolean);

// The one line under a task's title: what kind of event it is and when.
export function eventLine(task) {
  if (!task) return "";
  if (task.taskType === "record") {
    const l = task.longFormCount || 0, s = task.shortsCount || 0;
    const bits = ["Script to record"];
    if (l + s > 0) bits.push([l ? `${l} long-form` : "", s ? `${s} short${s === 1 ? "" : "s"}` : ""].filter(Boolean).join(", "));
    return bits.join(" · ");
  }
  const ev = task.event;
  if (!ev) return "";
  const bits = [];
  if (ev.sourceType === "floor") { if (ev.chamber) bits.push(`${ev.chamber} floor`); if (ev.measure) bits.push(ev.measure); }
  else if (ev.sourceType === "briefing") { if (ev.organization || ev.title) { bits.push("Press briefing"); if (ev.organization) bits.push(ev.organization); } }
  else if (ev.sourceType === "other") { if (ev.otherEventType) bits.push(ev.otherEventType); }
  else if (ev.committee || ev.subcommittee) {
    bits.push(ev.hearingType === "nomination" ? "Nomination hearing" : ev.hearingType === "markup" ? "Markup" : "Hearing");
    bits.push(ev.subcommittee || ev.committee);
  }
  if (!bits.length) return "";
  if (ev.date) bits.push(shortDate(ev.date));
  return bits.join(" · ");
}

// Free-text search across everything a person might remember a task by.
export function matchesSearch(task, query, profiles) {
  const q = (query || "").trim().toLowerCase();
  if (!q) return true;
  const ev = task.event || {};
  const hay = [
    task.title, task.description, task.editorNote, task.script,
    ev.title, ev.committee, ev.subcommittee, ev.organization, ev.otherEventType, ev.measure, ev.chamber,
    ...people(ev.witnesses), ...people(ev.spokespeople), ...people(ev.participants),
    ...(task.links || []).map((l) => l.label),
    displayNameFor(task.assignedToUid, profiles),
  ].filter(Boolean).join(" \n ").toLowerCase();
  return q.split(/\s+/).every((word) => hay.includes(word));
}

// What is happening on a task right now and what has come out of it so far.
//   live      — someone has a workflow running (or paused) on it
//   pkg       — the newest Clip Studio package made for it
//   posted    — videos finished from it (checking runs counted separately)
export function taskActivity(task, { liveActivity, clipPackages, runs, workflows }) {
  const lives = (liveActivity || []).filter((a) => a.taskId === task.id);
  const live = lives.find((a) => !a.paused) || lives[0] || null;
  const pkgs = (clipPackages || []).filter((p) => p.taskId === task.id)
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  const newest = pkgs[0] || null;
  const wfType = {};
  (workflows || []).forEach((w) => { wfType[w.id] = w.contentType || "long"; });
  const mine = (runs || []).filter((r) => r.taskId === task.id);
  const isCheck = (r) => (r.contentType || wfType[r.workflowId]) === "checking";
  const posted = mine.filter((r) => !isCheck(r));
  const last = mine.reduce((a, b) => (!a || new Date(b.completedAt) > new Date(a.completedAt) ? b : a), null);
  return {
    live,
    pkg: newest ? {
      id: newest.id, runs: pkgs.length,
      videos: Array.isArray(newest.videos) ? newest.videos.length : 0,
      done: Array.isArray(newest.doneKeys) ? newest.doneKeys.length : 0,
    } : null,
    runs: mine, posted: posted.length, checks: mine.length - posted.length,
    seconds: mine.reduce((s, r) => s + (r.totalSeconds || 0), 0),
    last,
  };
}

// Which workflows make sense to start for a task: the ones in its channel
// that produce a video (never the checking workflow), narrowed to long or
// short when the task says which it is.
export function workflowsForTask(task, workflows) {
  let list = (workflows || []).filter((w) => (w.contentType || "long") !== "checking");
  if (task.channelId) {
    const inChannel = list.filter((w) => w.channelId === task.channelId);
    if (inChannel.length) list = inChannel;
  }
  if (task.contentType === "long" || task.contentType === "short") {
    const typed = list.filter((w) => (w.contentType || "long") === task.contentType);
    if (typed.length) list = typed;
  }
  return list;
}

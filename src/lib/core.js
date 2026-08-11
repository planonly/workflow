// Shared constants, storage helpers, and small pure utility functions
// used across the app.

export const COLORS = {
  bg: "#0A0B0E",
  bgElevated: "#121419",
  bgCard: "#161920",
  border: "#262B34",
  textPrimary: "#F4F5F7",
  textMuted: "#8B92A0",
  textFaint: "#565C68",
  teal: "#2DD4C4",
  tealSoft: "rgba(45,212,196,0.14)",
  orange: "#F2784B",
  orangeSoft: "rgba(242,120,75,0.14)",
  danger: "#E15A5A",
  violet: "#A78BFA",
  violetSoft: "rgba(167,139,250,0.14)",
};


export const DEFAULT_STEPS = [
  "Cut Video", "Transcribe", "Update Names", "Export As Text File",
  "Upload in Grok with prompt", "Headline Update", "Date Update",
  "Name Plate Update", "Pick Thumbnail Frames", "Export Video",
  "Create Thumbnail", "Upload Video", "Paste Metadata",
  "Check for Ad Suitability", "Submit Ad Rating",
];


export const K_WORKFLOWS = "wfc_workflows_v2";
export const K_ACTIVE = "wfc_active_v2";
export const K_PROGRESS = "wfc_progress_v2";
export const K_RUNS = "wfc_runs_v2";
export const K_PROFILES = "wfc_profiles_v2";
export const K_CHANNELS = "wfc_channels_v2";
export const K_ATTENDANCE = "wfc_attendance_v1";
export const K_TASKS = "wfc_tasks_v1";

export function lsGet(key) { try { return window.localStorage.getItem(key); } catch (e) { return null; } }
export function lsSet(key, value) { try { window.localStorage.setItem(key, value); } catch (e) {} }

export function uid() { return Math.random().toString(36).slice(2, 10); }

// A short, unique-enough handle for one completed run — the editor renames
// their exported file to this, and it's the same code shown everywhere that
// run appears (day view, performance stats), so a specific file and a
// specific entry in the system always refer to each other unambiguously.
// Same scheme already used for task codes, for visual consistency.
export function runCode(id) { return id ? id.slice(-6).toUpperCase() : ""; }

// Handles the common URL shapes: watch?v=, youtu.be/, shorts/, embed/.
export function extractYouTubeId(url) {
  if (!url) return null;
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtube\.com\/shorts\/|youtube\.com\/embed\/|youtu\.be\/)([A-Za-z0-9_-]{6,})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

// A static thumbnail image, deliberately not a playable embed — this can
// never generate a YouTube view or impression, since there's no player at
// all until someone actually clicks through to the real YouTube page.
export function youtubeThumbnailUrl(url) {
  const id = extractYouTubeId(url);
  return id ? `https://img.youtube.com/vi/${id}/hqdefault.jpg` : null;
}
export function progKey(workflowId, userId) { return `${workflowId}__${userId}`; }

export function makeDefaultWorkflow() {
  return { id: uid(), title: "Video Publishing Workflow", contentType: "long", steps: DEFAULT_STEPS.map((t) => ({ id: uid(), text: t, notes: "", substeps: [] })) };
}

export function formatTime(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

export function formatHours(totalSeconds) {
  const h = totalSeconds / 3600;
  return h >= 10 ? `${Math.round(h)}h` : `${h.toFixed(1)}h`;
}

export function formatDateShort(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " " +
      d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  } catch (e) { return ""; }
}

export function dayKey(iso) {
  try { return new Date(iso).toISOString().slice(0, 10); } catch (e) { return ""; }
}

export function attendanceWorkedSeconds(rec) {
  if (!rec || !rec.punchIn) return 0;
  const end = rec.punchOut ? new Date(rec.punchOut) : new Date();
  const start = new Date(rec.punchIn);
  let totalMs = end - start;
  (rec.breaks || []).forEach((b) => {
    const bStart = new Date(b.start);
    const bEnd = b.end ? new Date(b.end) : new Date();
    totalMs -= (bEnd - bStart);
  });
  return Math.max(0, totalMs / 1000);
}

export function formatClock(iso) {
  try { return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }); } catch (e) { return ""; }
}

export function displayNameFor(uidVal, profiles, fallbackEmail) {
  if (profiles && profiles[uidVal] && profiles[uidVal].displayName) return profiles[uidVal].displayName;
  if (fallbackEmail) return fallbackEmail.split("@")[0];
  return "Unknown";
}

export function normalizeSteps(steps) {
  return (steps || []).map((s) => {
    if (typeof s === "string") return { id: uid(), text: s, notes: "", substeps: [] };
    return {
      id: s.id || uid(),
      text: s.text,
      notes: s.notes || "",
      substeps: (s.substeps || []).map((sub) => (typeof sub === "string" ? { id: uid(), text: sub } : { id: sub.id || uid(), text: sub.text })),
    };
  });
}

export function migrateLegacy() {
  const legacyWf = lsGet("wfc_workflow");
  if (!legacyWf) return null;
  try {
    const parsed = JSON.parse(legacyWf);
    const steps = normalizeSteps(parsed.steps);
    const wf = { id: uid(), title: parsed.title || "My Workflow", steps };
    const idx = parseInt(lsGet("wfc_currentStepIndex") || "0", 10) || 0;
    const done = lsGet("wfc_isComplete") === "true";
    let times = {};
    try { times = JSON.parse(lsGet("wfc_stepTimes") || "{}"); } catch (e) {}
    return { workflow: wf, stepIndex: idx, isComplete: done, stepTimes: times };
  } catch (e) { return null; }
}

/* ============================ AUTH ============================ */


export function formatFullDate(key) {
  try {
    const d = new Date(key + "T00:00:00");
    return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  } catch (e) { return key; }
}

// Turns a flat list of { videoTitle, anchorScript, watchAlongText } entries
// into one continuous script to read and record — shared between App.jsx
// (building a single task's inline script text) and PartnerDashboard.jsx
// (combining several pending tasks into one download), so both places
// produce identically-formatted output rather than two separate, possibly
// drifting implementations of the same thing. The break between videos
// exists because reading several scripts back to back with no pause isn't
// how anyone actually records — there needs to be a moment to reset, know
// what's coming, and a countdown for a clean take.
export function formatScriptsForRecording(entries) {
  if (!entries || entries.length === 0) return "";
  return entries.map((s, idx) => {
    const a = s.anchorScript || {};
    const parts = [
      `VIDEO ${idx + 1} of ${entries.length} — ${s.videoTitle || "Untitled"}`,
      "",
      "[READ ALOUD]",
      a.intro || "",
    ];
    // The "acting" beat — read/watch the clip's own words silently, as if
    // actually seeing it play, before delivering the line that would
    // really interrupt it. Gated on whether the anchor script actually
    // calls for a mid-clip insertion at all (midCommentaryInsertAfter
    // non-empty), not just on whether the exact watch-along text happened
    // to extract successfully — a transcript that wasn't loaded when this
    // task was built, or a quote that didn't match verbatim, must not
    // silently delete the acting instruction entirely. If there's
    // supposed to be a beat here, the cue stays even without the literal
    // preceding quote.
    if (a.midCommentaryInsertAfter) {
      if (s.watchAlongText) {
        parts.push("", "[CLIP PLAYS — watch and react as if seeing it live]", `"${s.watchAlongText}"`);
      } else {
        parts.push("", "[CLIP PLAYS — watch and react as if seeing it live, then read the line below at the natural moment]");
      }
    }
    parts.push("", "[READ ALOUD]", a.midCommentary || "", "", "[CLIP CONTINUES]", "", "[READ ALOUD]", a.postClip || "");
    if (idx < entries.length - 1) {
      const next = entries[idx + 1];
      parts.push(
        "",
        "— — — — — — — — — — — —",
        `Relax, reset. Next video is about ${next.videoTitle || "the next clip"}. Starting in 3... 2... 1...`,
        "— — — — — — — — — — — —"
      );
    }
    return parts.join("\n");
  }).join("\n\n");
}



// Revisions on finished videos — pure logic, no React or Firebase.
//
// A revision is a fix an admin asks for on a video that's already done. It
// lives on that video's run record, in a map keyed by revision id, and moves
// through three states:
//
//   pending — asked for, the editor hasn't dealt with it yet
//   fixed   — the editor says it's fixed; waiting for the admin to check
//   done    — the admin has checked and closed it
//
// An admin can send a "fixed" one back to pending (with a reason) or reopen
// a "done" one. Only an admin closes a revision — an editor can only say
// they've fixed it.

export const REVISION_STATUS = { PENDING: "pending", FIXED: "fixed", DONE: "done" };

export const STATUS_META = {
  pending: { label: "Pending", short: "pending" },
  fixed: { label: "Fixed — awaiting check", short: "to check" },
  done: { label: "Done", short: "done" },
};

// Screenshots are stored inline on the run record, which has a hard size cap
// per document, so there's a budget rather than "as many as you like".
export const MAX_IMAGES_PER_REVISION = 2;
export const MAX_IMAGE_CHARS_PER_RUN = 700000;

const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export function revisionList(run) {
  const map = (run && run.revisions) || {};
  return Object.keys(map)
    .map((id) => ({ ...map[id], id: map[id].id || id }))
    .sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
}

export function summarize(run) {
  const out = { pending: 0, fixed: 0, done: 0, open: 0, total: 0 };
  revisionList(run).forEach((r) => {
    if (out[r.status] != null) out[r.status] += 1;
    out.total += 1;
  });
  out.open = out.pending + out.fixed;
  return out;
}

export function imageCharsOnRun(run) {
  return revisionList(run).reduce((n, r) => n + (r.images || []).reduce((m, s) => m + (s ? s.length : 0), 0), 0);
}

// Who may do what. Admin here means supervisor-or-above, as everywhere else
// in the app. The assigned editor can only report a fix; they can't close,
// reopen, send back, or delete.
export function canAct(rev, action, { uid, isSupervisor }) {
  if (!rev) return false;
  if (action === "fix") return rev.status === "pending" && (isSupervisor || rev.assignedToUid === uid);
  if (!isSupervisor) return false;
  if (action === "approve") return rev.status === "fixed" || rev.status === "pending";
  if (action === "sendBack") return rev.status === "fixed";
  if (action === "reopen") return rev.status === "done";
  if (action === "delete") return true;
  return false;
}

export function createRevision({ text, images, assignedToUid, byUid, now = new Date().toISOString(), id = newId() }) {
  const clean = (text || "").trim();
  if (!clean) return null;
  return {
    id,
    text: clean,
    images: (images || []).filter(Boolean).slice(0, MAX_IMAGES_PER_REVISION),
    status: REVISION_STATUS.PENDING,
    assignedToUid: assignedToUid || null,
    createdAt: now,
    createdBy: byUid || null,
  };
}

// Returns the revision as it should be after the action, or null if the
// action isn't allowed (wrong state or wrong person) so the caller can
// refuse instead of writing something inconsistent.
export function applyAction(rev, action, { uid, isSupervisor, note, now = new Date().toISOString() }) {
  if (!canAct(rev, action, { uid, isSupervisor })) return null;
  const next = { ...rev };
  if (action === "fix") {
    next.status = REVISION_STATUS.FIXED; next.fixedAt = now; next.fixedBy = uid;
    delete next.sendBackNote; delete next.sendBackAt;
  } else if (action === "approve") {
    next.status = REVISION_STATUS.DONE; next.doneAt = now; next.doneBy = uid;
    next.fixedAt = next.fixedAt || null; next.fixedBy = next.fixedBy || null; // never leave undefined — Firestore rejects it
  } else if (action === "sendBack") {
    next.status = REVISION_STATUS.PENDING;
    next.sendBackNote = (note || "").trim() || null; next.sendBackAt = now;
    next.fixedAt = null; next.fixedBy = null;
  } else if (action === "reopen") {
    next.status = REVISION_STATUS.PENDING;
    next.doneAt = null; next.doneBy = null; next.fixedAt = null; next.fixedBy = null;
  } else {
    return null;
  }
  return next;
}

// A copy of the run with one revision set (or removed when rev is null).
export function withRevision(run, revId, rev) {
  const revisions = { ...((run && run.revisions) || {}) };
  if (rev) revisions[revId] = rev; else delete revisions[revId];
  return { ...run, revisions };
}

// ---- Queues -------------------------------------------------------------
// Everything below flattens runs into { run, rev } pairs, oldest first, so
// whoever has been waiting longest is at the top.

const flat = (runs, pred, key = "createdAt") => {
  const out = [];
  (runs || []).forEach((run) => revisionList(run).forEach((rev) => { if (pred(rev, run)) out.push({ run, rev }); }));
  return out.sort((a, b) => new Date(a.rev[key] || 0) - new Date(b.rev[key] || 0));
};

// An editor's own work: revisions assigned to them that still need fixing.
export const toFixFor = (runs, uid) => flat(runs, (r) => r.status === "pending" && r.assignedToUid === uid);
// What an editor has handed back and is waiting on — longest-waiting first.
export const waitingOnCheckFor = (runs, uid) => flat(runs, (r) => r.status === "fixed" && r.assignedToUid === uid, "fixedAt");
// An admin's inbox: fixes waiting for their check, longest-waiting first…
export const awaitingCheck = (runs) => flat(runs, (r) => r.status === "fixed", "fixedAt");
// …and everything still sitting with editors, oldest request first.
export const outstanding = (runs) => flat(runs, (r) => r.status === "pending");

// The editor who should get a revision by default: whoever made the video.
export const defaultAssignee = (run) => (run && run.completedByUid) || null;

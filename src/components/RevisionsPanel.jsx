import React, { useState } from "react";
import { COLORS, displayNameFor, formatDateShort, dayKey } from "../lib/core";
import { Plus, X } from "./Icon";
import { shrinkToBudget } from "../lib/image";
import {
  revisionList, summarize, canAct, imageCharsOnRun, defaultAssignee,
  toFixFor, waitingOnCheckFor, awaitingCheck, outstanding,
  MAX_IMAGES_PER_REVISION, MAX_IMAGE_CHARS_PER_RUN,
} from "../lib/revisions";

// Revisions on finished videos: the panel that lives inside a video's row
// (Day view, Insights), the small badge shown on the collapsed row, and the
// dashboard card that gathers everything waiting on you in one place.
//
// `api` is { uid, isSupervisor, teamEditors, onAdd(run, data), onAction(run, rev, action, payload) }.
// The same object is handed to all three so the rules (who can do what) are
// decided once, in lib/revisions, not re-decided per screen.

const STATUS_STYLE = {
  pending: { bg: COLORS.orangeSoft, fg: COLORS.orange, label: "Pending" },
  fixed: { bg: COLORS.violetSoft, fg: COLORS.violet, label: "Fixed — awaiting check" },
  done: { bg: COLORS.tealSoft, fg: COLORS.teal, label: "Done" },
};

const videoTitle = (run) => run.youtubeTitle || run.taskTitle || run.workflowTitle || "Untitled";

const ImageIcon = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" />
  </svg>
);

function Lightbox({ src, onClose }) {
  if (!src) return null;
  return (
    <div onClick={onClose} style={{ backgroundColor: "rgba(0,0,0,0.85)" }} data-testid="rev-lightbox"
      className="fixed inset-0 z-50 flex items-center justify-center p-6 cursor-zoom-out">
      <img src={src} alt="Screenshot" className="max-w-full max-h-full rounded-xl" />
    </div>
  );
}

export function RevisionBadge({ run }) {
  const s = summarize(run);
  if (!s.open) return null;
  return (
    <span className="inline-flex items-center gap-1 shrink-0" data-testid="rev-badge">
      {s.pending > 0 && (
        <span style={{ backgroundColor: COLORS.orangeSoft, color: COLORS.orange }} className="font-mono text-[9px] rounded-full px-1.5 py-0.5">
          {s.pending} pending
        </span>
      )}
      {s.fixed > 0 && (
        <span style={{ backgroundColor: COLORS.violetSoft, color: COLORS.violet }} className="font-mono text-[9px] rounded-full px-1.5 py-0.5">
          {s.fixed} to check
        </span>
      )}
    </span>
  );
}

function btn(kind) {
  if (kind === "primary") return { backgroundColor: COLORS.teal, color: "#04211D" };
  if (kind === "soft") return { backgroundColor: COLORS.tealSoft, color: COLORS.teal };
  return { backgroundColor: "transparent", color: COLORS.textMuted, border: `1px solid ${COLORS.border}` };
}

function RevisionItem({ run, rev, profiles, api, onImage, showVideo, onOpenDay }) {
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState("");
  const st = STATUS_STYLE[rev.status] || STATUS_STYLE.pending;
  const who = (u) => displayNameFor(u, profiles);
  const me = { uid: api.uid, isSupervisor: api.isSupervisor };
  const can = (a) => canAct(rev, a, me);
  const act = (a, payload) => api.onAction(run, rev, a, payload);

  return (
    <div style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border }} className="rounded-xl border p-3" data-testid="rev-item" data-status={rev.status}>
      {showVideo && (
        <div className="flex items-center justify-between gap-2 mb-2">
          <p style={{ color: COLORS.textPrimary }} className="text-xs font-semibold truncate">{videoTitle(run)}</p>
          <div className="flex items-center gap-2 shrink-0">
            {run.youtubeUrl && (
              <a href={run.youtubeUrl} target="_blank" rel="noopener noreferrer" style={{ color: COLORS.teal }} className="font-mono text-[10px] hover:opacity-80">Watch</a>
            )}
            {onOpenDay && run.completedAt && (
              <button onClick={() => onOpenDay(dayKey(run.completedAt))} style={{ color: COLORS.textMuted }} className="font-mono text-[10px] hover:opacity-80">Open day</button>
            )}
          </div>
        </div>
      )}
      <div className="flex items-center gap-2 flex-wrap mb-1.5">
        <span style={{ backgroundColor: st.bg, color: st.fg }} className="font-mono text-[10px] rounded-full px-2 py-0.5" data-testid="rev-status">{st.label}</span>
        <span style={{ color: COLORS.textFaint }} className="font-mono text-[10px]">
          {who(rev.createdBy)} · {formatDateShort(rev.createdAt)}{rev.assignedToUid ? ` · for ${who(rev.assignedToUid)}` : ""}
        </span>
      </div>
      <p style={{ color: COLORS.textPrimary }} className="text-sm whitespace-pre-wrap leading-relaxed">{rev.text}</p>

      {(rev.images || []).length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {rev.images.map((src, i) => (
            <button key={i} type="button" onClick={() => onImage(src)} aria-label="View screenshot full size" data-testid="rev-thumb">
              <img src={src} alt="Screenshot" style={{ borderColor: COLORS.border }} className="w-14 h-14 rounded-lg object-cover border hover:opacity-80 transition-opacity" />
            </button>
          ))}
        </div>
      )}

      {rev.status === "pending" && rev.sendBackNote && (
        <p style={{ color: COLORS.orange }} className="text-xs mt-2 leading-relaxed" data-testid="rev-sendback-note">Sent back: {rev.sendBackNote}</p>
      )}
      {rev.status !== "pending" && rev.fixedAt && (
        <p style={{ color: COLORS.textFaint }} className="font-mono text-[10px] mt-2">Marked fixed by {who(rev.fixedBy)} · {formatDateShort(rev.fixedAt)}</p>
      )}
      {rev.status === "done" && rev.doneAt && (
        <p style={{ color: COLORS.textFaint }} className="font-mono text-[10px] mt-0.5">Closed by {who(rev.doneBy)} · {formatDateShort(rev.doneAt)}</p>
      )}

      <div className="flex items-center gap-2 flex-wrap mt-3">
        {/* An admin can technically report a fix on someone's behalf, but
            offering it next to Close just invites the wrong click — the button
            is for whoever the revision is actually assigned to. */}
        {can("fix") && rev.assignedToUid === api.uid && (
          <button onClick={() => act("fix")} style={btn("primary")} data-testid="rev-fix" className="rounded-lg px-3 py-1.5 text-xs font-semibold hover:brightness-105">Mark fixed</button>
        )}
        {can("approve") && (
          <button onClick={() => act("approve")} style={btn(rev.status === "fixed" ? "primary" : "soft")} data-testid="rev-approve"
            className="rounded-lg px-3 py-1.5 text-xs font-semibold hover:brightness-105">{rev.status === "fixed" ? "Approve" : "Close"}</button>
        )}
        {can("sendBack") && !sending && (
          <button onClick={() => setSending(true)} style={btn("ghost")} data-testid="rev-sendback" className="rounded-lg px-3 py-1.5 text-xs font-semibold hover:opacity-80">Send back</button>
        )}
        {can("reopen") && (
          <button onClick={() => act("reopen")} style={btn("ghost")} data-testid="rev-reopen" className="rounded-lg px-3 py-1.5 text-xs font-semibold hover:opacity-80">Reopen</button>
        )}
        {can("delete") && (
          <button onClick={() => { if (window.confirm("Delete this revision? This can't be undone.")) act("delete"); }}
            style={{ color: COLORS.textFaint }} data-testid="rev-delete" className="font-mono text-[10px] ml-auto hover:opacity-80">Delete</button>
        )}
      </div>

      {sending && (
        <div className="flex items-center gap-2 mt-2">
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What's still wrong? (optional)" data-testid="rev-sendback-input"
            style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border, color: COLORS.textPrimary }}
            className="flex-1 min-w-0 rounded-lg border px-2.5 py-1.5 text-xs outline-none focus:ring-2" />
          <button onClick={() => { act("sendBack", { note }); setSending(false); setNote(""); }} style={btn("primary")} data-testid="rev-sendback-confirm"
            className="rounded-lg px-3 py-1.5 text-xs font-semibold shrink-0">Send</button>
          <button onClick={() => { setSending(false); setNote(""); }} style={{ color: COLORS.textFaint }} className="text-xs shrink-0">Cancel</button>
        </div>
      )}
    </div>
  );
}

function AddRevisionForm({ run, api, profiles, onDone }) {
  const [text, setText] = useState("");
  const [images, setImages] = useState([]);
  const [assignee, setAssignee] = useState(defaultAssignee(run) || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const editors = api.teamEditors || [];
  // Whoever made the video stays selectable even if they're no longer an editor.
  const options = editors.some((e) => e.uid === assignee) || !assignee
    ? editors
    : [...editors, { uid: assignee, name: displayNameFor(assignee, profiles) }];

  const pick = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length) return;
    setErr(""); setBusy(true);
    try {
      let used = imageCharsOnRun(run) + images.reduce((n, s) => n + s.length, 0);
      const next = [...images];
      for (const f of files.slice(0, MAX_IMAGES_PER_REVISION - images.length)) {
        const url = await shrinkToBudget(f);
        if (used + url.length > MAX_IMAGE_CHARS_PER_RUN) throw new Error("This video already has a lot of screenshots attached. Remove one from an older revision first.");
        used += url.length; next.push(url);
      }
      setImages(next);
    } catch (ex) { setErr(ex.message || "Couldn't process that image."); }
    finally { setBusy(false); }
  };

  const submit = async () => {
    if (!text.trim() || !assignee || busy) return;
    setBusy(true);
    try { await api.onAdd(run, { text, images, assignedToUid: assignee }); onDone(); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, borderLeftColor: COLORS.orange, borderLeftWidth: 3 }}
      className="rounded-xl border p-3 flex flex-col gap-2" data-testid="rev-form">
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} data-testid="rev-text"
        placeholder={'What needs fixing? e.g. "Name plate is wrong at 0:42 — should read Sen. Jane Rivera"'}
        style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border, color: COLORS.textPrimary }}
        className="rounded-lg border px-3 py-2 text-xs outline-none focus:ring-2" />
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {images.map((src, i) => (
            <div key={i} className="relative">
              <img src={src} alt="" style={{ borderColor: COLORS.border }} className="w-14 h-14 rounded-lg object-cover border" />
              <button type="button" aria-label="Remove screenshot" onClick={() => setImages((a) => a.filter((_, j) => j !== i))}
                style={{ backgroundColor: COLORS.danger, color: "#fff" }} className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full flex items-center justify-center">
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center gap-3 flex-wrap">
        {images.length < MAX_IMAGES_PER_REVISION && (
          <label style={{ color: COLORS.orange }} className="inline-flex items-center gap-1.5 cursor-pointer">
            <ImageIcon size={13} />
            <span className="text-[11px] font-semibold">{busy ? "Processing…" : images.length ? "Add another screenshot" : "Attach a screenshot (optional)"}</span>
            <input type="file" accept="image/*" multiple className="hidden" disabled={busy} onChange={pick} data-testid="rev-file" />
          </label>
        )}
        <label className="inline-flex items-center gap-1.5 ml-auto">
          <span style={{ color: COLORS.textFaint }} className="font-mono text-[10px] uppercase tracking-[0.1em]">For</span>
          <select value={assignee} onChange={(e) => setAssignee(e.target.value)} data-testid="rev-assignee"
            style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border, color: COLORS.textPrimary }}
            className="rounded-lg border px-2 py-1 text-xs outline-none">
            {!assignee && <option value="">Choose editor…</option>}
            {options.map((e) => <option key={e.uid} value={e.uid}>{e.name}</option>)}
          </select>
        </label>
      </div>
      {err && <p style={{ color: COLORS.danger }} className="text-[10px]" data-testid="rev-error">{err}</p>}
      <div className="flex items-center gap-2">
        <button onClick={submit} disabled={!text.trim() || !assignee || busy} data-testid="rev-submit"
          style={{ ...btn("primary"), opacity: !text.trim() || !assignee || busy ? 0.45 : 1 }} className="rounded-lg px-4 py-1.5 text-xs font-semibold">Add revision</button>
        <button onClick={onDone} style={{ color: COLORS.textFaint }} className="text-xs">Cancel</button>
      </div>
    </div>
  );
}

// Inside a video's expanded row. Renders nothing for someone who can't add
// revisions on a video that has none.
export function RevisionsPanel({ run, profiles, api }) {
  const [adding, setAdding] = useState(false);
  const [lightbox, setLightbox] = useState(null);
  if (!api) return null;
  const list = revisionList(run);
  if (!list.length && !api.isSupervisor) return null;
  const s = summarize(run);
  return (
    <div className="mt-2 pt-2" style={{ borderTop: `1px solid ${COLORS.border}` }} data-testid="rev-panel">
      <div className="flex items-center justify-between gap-2 mb-2">
        <p style={{ color: COLORS.textFaint }} className="font-mono text-[10px] tracking-[0.15em] uppercase">
          Revisions{s.total ? ` · ${s.open} open` : ""}
        </p>
        {api.isSupervisor && !adding && (
          <button onClick={() => setAdding(true)} style={{ color: COLORS.orange }} data-testid="rev-add" className="inline-flex items-center gap-1 text-[11px] font-semibold hover:opacity-80">
            <Plus size={12} /> Add revision
          </button>
        )}
      </div>
      <div className="flex flex-col gap-2">
        {adding && <AddRevisionForm run={run} api={api} profiles={profiles} onDone={() => setAdding(false)} />}
        {/* Open ones first, closed ones after, so what still needs attention
            is at the top however long the history gets. */}
        {[...list.filter((r) => r.status !== "done"), ...list.filter((r) => r.status === "done")].map((rev) => (
          <RevisionItem key={rev.id} run={run} rev={rev} profiles={profiles} api={api} onImage={setLightbox} />
        ))}
      </div>
      <Lightbox src={lightbox} onClose={() => setLightbox(null)} />
    </div>
  );
}

// The dashboard card: everything waiting on this person, in one place.
export function RevisionsCard({ ctx }) {
  const [lightbox, setLightbox] = useState(null);
  const [showAllOut, setShowAllOut] = useState(false);
  if (!ctx) return null;
  const { uid: uidVal, isSupervisor, runs, profiles, api, onOpenDay } = ctx;
  const toFix = toFixFor(runs, uidVal);
  const mineWaiting = waitingOnCheckFor(runs, uidVal);
  const check = isSupervisor ? awaitingCheck(runs) : [];
  const out = isSupervisor ? outstanding(runs) : [];
  if (!toFix.length && !check.length && !out.length && !mineWaiting.length) return null;
  const outShown = showAllOut ? out : out.slice(0, 4);

  const Title = ({ children, count, color }) => (
    <div className="flex items-center gap-2 mb-2 mt-1">
      <p style={{ color: COLORS.textFaint }} className="font-mono text-[10px] tracking-[0.15em] uppercase">{children}</p>
      <span style={{ backgroundColor: color, color: "#0A0B0E" }} className="font-mono text-[10px] font-bold rounded-full px-1.5 leading-4">{count}</span>
    </div>
  );

  return (
    <div style={{ backgroundColor: COLORS.bgCard, borderColor: toFix.length || check.length ? COLORS.orange : COLORS.border }}
      className="rounded-2xl border px-4 py-4 mt-4" data-testid="rev-card">
      <p style={{ color: COLORS.textPrimary }} className="text-sm font-semibold mb-2">Revisions</p>

      {toFix.length > 0 && (
        <div className="mb-3" data-testid="rev-section-fix">
          <Title count={toFix.length} color={COLORS.orange}>To fix</Title>
          <div className="flex flex-col gap-2">
            {toFix.map(({ run, rev }) => <RevisionItem key={run.id + rev.id} run={run} rev={rev} profiles={profiles} api={api} onImage={setLightbox} showVideo />)}
          </div>
        </div>
      )}

      {check.length > 0 && (
        <div className="mb-3" data-testid="rev-section-check">
          <Title count={check.length} color={COLORS.violet}>Awaiting your check</Title>
          <div className="flex flex-col gap-2">
            {check.map(({ run, rev }) => <RevisionItem key={run.id + rev.id} run={run} rev={rev} profiles={profiles} api={api} onImage={setLightbox} showVideo onOpenDay={onOpenDay} />)}
          </div>
        </div>
      )}

      {mineWaiting.length > 0 && (
        <div className="mb-1" data-testid="rev-section-waiting">
          <Title count={mineWaiting.length} color={COLORS.violet}>Waiting on a check</Title>
          {mineWaiting.map(({ run, rev }) => (
            <p key={run.id + rev.id} style={{ color: COLORS.textMuted }} className="text-xs truncate py-0.5">{videoTitle(run)} — <span style={{ color: COLORS.textFaint }}>{rev.text}</span></p>
          ))}
        </div>
      )}

      {out.length > 0 && (
        <div data-testid="rev-section-out">
          <Title count={out.length} color={COLORS.orange}>With editors</Title>
          {outShown.map(({ run, rev }) => (
            <div key={run.id + rev.id} className="flex items-center justify-between gap-2 py-0.5">
              <p style={{ color: COLORS.textMuted }} className="text-xs truncate min-w-0">
                {videoTitle(run)} <span style={{ color: COLORS.textFaint }}>· {displayNameFor(rev.assignedToUid, profiles)}</span>
              </p>
              {onOpenDay && run.completedAt && (
                <button onClick={() => onOpenDay(dayKey(run.completedAt))} style={{ color: COLORS.teal }} className="font-mono text-[10px] shrink-0 hover:opacity-80">Open day</button>
              )}
            </div>
          ))}
          {out.length > 4 && (
            <button onClick={() => setShowAllOut((v) => !v)} style={{ color: COLORS.textFaint }} className="font-mono text-[10px] mt-1 hover:opacity-80">
              {showAllOut ? "Show fewer" : `+${out.length - 4} more`}
            </button>
          )}
        </div>
      )}
      <Lightbox src={lightbox} onClose={() => setLightbox(null)} />
    </div>
  );
}

import React, { useState, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { COLORS } from "../lib/core";

// The whole glass design system in one place — every screen that adopts it
// imports GlassStyles + GlassBackdrop from here instead of redefining the
// same ~90 lines of CSS locally. Extracted directly from Clip Studio's
// working implementation, not rewritten from memory, so nothing drifts
// between screens.
export const GLASS_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
  @keyframes cs-rise { from { opacity: 0; transform: translateY(10px) scale(.98) } to { opacity: 1; transform: none } }
  @keyframes cs-pulse { 0%,100% { opacity: .35 } 50% { opacity: 1 } }
  @keyframes cs-sweep { 0% { transform: translateX(-100%) } 100% { transform: translateX(300%) } }
  @keyframes cs-status-in { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: none } }
  @keyframes cs-pulse-ring { 0% { transform: scale(.85); opacity: .9 } 70% { transform: scale(1.35); opacity: 0 } 100% { opacity: 0 } }
  @keyframes cs-spin { to { transform: rotate(360deg) } }
  @keyframes cs-pool-drift { 0%,100% { transform: translate(0,0) scale(1) } 50% { transform: translate(2%,-3%) scale(1.05) } }
  @keyframes checkDraw { from { stroke-dashoffset: 32 } to { stroke-dashoffset: 0 } }
  /* Apple's own sheet-presentation curve (reverse-engineered from UIKit) for
     things that open or settle into place, and a slight-overshoot "spring"
     curve for anything meant to feel pressed or toggled — this is what
     actually reads as "iOS" rather than a generic ease. */
  .cs-rise { animation: cs-rise .5s cubic-bezier(.32,.72,0,1) both; }
  .cs-spring { transition: transform .35s cubic-bezier(.34,1.56,.64,1), background .2s cubic-bezier(.32,.72,0,1), border-color .2s cubic-bezier(.32,.72,0,1); }
  .cs-pulse { animation: cs-pulse 1.4s ease-in-out infinite; }
  .cs-sweep { animation: cs-sweep 1.6s ease-in-out infinite; }
  .cs-status-icon-in { animation: cs-status-in .4s cubic-bezier(.32,.72,0,1) both; }
  .cs-status-text-in { animation: cs-status-in .4s cubic-bezier(.32,.72,0,1) both .05s; }
  .cs-pulse-ring { animation: cs-pulse-ring 1.8s cubic-bezier(.2,.7,.3,1) infinite; }
  .cs-spin { animation: cs-spin .8s linear infinite; }
  .cs-field { transition: border-color .18s cubic-bezier(.32,.72,0,1), box-shadow .18s cubic-bezier(.32,.72,0,1), background .18s cubic-bezier(.32,.72,0,1); }
  .cs-field:focus { outline: none; border-color: rgba(255,255,255,0.5); box-shadow: 0 0 0 3px rgba(255,255,255,0.12); }
  .cs-copy { transition: color .15s cubic-bezier(.32,.72,0,1), opacity .15s ease; }
  .cs-copy:hover { color: #2DD4C4 !important; }
  .cs-brighten { transition: color .15s cubic-bezier(.32,.72,0,1); }
  .cs-brighten:hover { color: #fff !important; }
  .cs-toggle-row { transition: background .15s cubic-bezier(.32,.72,0,1); border-radius: 8px; margin-left: -8px; margin-right: -8px; padding-left: 8px; padding-right: 8px; }
  .cs-toggle-row:hover { background: rgba(255,255,255,0.06); }
  .cs-toggle-track:active { transform: scale(0.93); }
  .cs-tab { transition: background .15s cubic-bezier(.32,.72,0,1), border-color .15s cubic-bezier(.32,.72,0,1); }
  .cs-tab:hover { background: rgba(255,255,255,0.16) !important; border-color: rgba(255,255,255,0.4) !important; }
  .cs-glass-cta {
    backdrop-filter: blur(18px) saturate(160%); -webkit-backdrop-filter: blur(18px) saturate(160%);
    border-top: 0.5px solid rgba(255,255,255,0.5); color: #fff;
    transition: transform .2s cubic-bezier(.32,.72,0,1), background .2s cubic-bezier(.32,.72,0,1);
  }
  .cs-glass-cta:hover { transform: translateY(-1px); }
  .cs-glass-cta:active { transform: scale(.97) translateY(0); }
  .cs-glass-cta-violet { background: rgba(167,139,250,0.22); border: 0.5px solid rgba(167,139,250,0.5); }
  .cs-glass-cta-violet:hover { background: rgba(167,139,250,0.34) !important; }
  .cs-scroll-outer {
    border-radius: 20px; padding: 3px;
    background: rgba(255,255,255,0.03); border: 0.5px solid rgba(255,255,255,0.18);
  }
  .cs-scroll-inner {
    border-radius: 18px; padding: 12px;
    mask-image: linear-gradient(to bottom, transparent, black 20px, black calc(100% - 20px), transparent);
    -webkit-mask-image: linear-gradient(to bottom, transparent, black 20px, black calc(100% - 20px), transparent);
  }
  .cs-dropzone { transition: background .15s cubic-bezier(.32,.72,0,1), border-color .15s cubic-bezier(.32,.72,0,1); }
  .cs-dropzone:hover { background: rgba(255,255,255,0.06); border-color: rgba(255,255,255,0.4) !important; }

  /* The scene glass actually refracts — soft, blurred, related-hue pools.
     The drift keyframe (ambient, always running) lives on the pool itself;
     mouse-parallax (JS-driven) lives on its wrapper — two different nodes
     so the two transforms never fight over the same property. */
  .cs-backdrop { position: fixed; inset: 0; z-index: 0; overflow: hidden; background: #141213; pointer-events: none; }
  .cs-pool { position: absolute; inset: 0; border-radius: 50%; filter: blur(60px); animation: cs-pool-drift 14s ease-in-out infinite; }
  .cs-pool-wrap { position: absolute; transition: transform 0.6s cubic-bezier(.32,.72,0,1); }

  /* One glass surface, used everywhere — sections, cards, buttons, inputs,
     modals. Real translucency plus a bright top edge, which is the actual
     visual signature of light catching a glass rim. */
  .cs-glass {
    background: rgba(15,12,10,0.46);
    border: 0.5px solid rgba(255,255,255,0.2);
    border-top: 0.5px solid rgba(255,255,255,0.4);
    backdrop-filter: blur(18px) saturate(150%);
    -webkit-backdrop-filter: blur(18px) saturate(150%);
  }
  .cs-glass-hover:hover { background: rgba(15,12,10,0.36); border-top-color: rgba(255,255,255,0.62); transform: translateY(-1px); }
  .cs-glass-btn {
    background: rgba(255,255,255,0.1); border: 0.5px solid rgba(255,255,255,0.28);
    color: rgba(255,255,255,0.85); border-radius: 100px;
  }
  .cs-glass-btn:hover { background: rgba(255,255,255,0.92); color: #26211d; }
  .cs-glass-btn:active { transform: scale(.96); }
  .cs-glass-row { transition: background .15s cubic-bezier(.32,.72,0,1), border-color .15s cubic-bezier(.32,.72,0,1); border-radius: 6px; }
  .cs-glass-row:hover { background: rgba(255,255,255,0.08); border-color: rgba(255,255,255,0.28) !important; }
  .cs-glass-row:hover .cs-copy-reveal { opacity: 0.75 !important; }

  /* Dynamic Island — compact pill that morphs into an expanded card. Real
     iOS islands resize with a springy overshoot, not a linear width tween. */
  .cs-island { transition: width .45s cubic-bezier(.34,1.56,.64,1), height .45s cubic-bezier(.34,1.56,.64,1), border-radius .45s cubic-bezier(.34,1.56,.64,1); }

  @media (prefers-reduced-motion: reduce) { .cs-rise, .cs-pulse, .cs-sweep, .cs-status-icon-in, .cs-status-text-in, .cs-pulse-ring, .cs-spin, .cs-pool, .cs-island { animation: none !important; transition: none !important; } .cs-spring, .cs-glass-hover, .cs-glass-btn, .cs-pool-wrap { transition: none !important; } }
  /* Apple's own accessibility pattern for Liquid Glass: Reduced
     Transparency makes glass frostier and more opaque instead of removing
     the effect outright. */
  @media (prefers-reduced-transparency: reduce) { .cs-glass, .cs-island { background: rgba(10,8,7,0.92) !important; backdrop-filter: none !important; -webkit-backdrop-filter: none !important; } }
`;

export const APPLE_FONT_STACK = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Inter", "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

export function GlassStyles() {
  return <style>{GLASS_CSS}</style>;
}

const DEFAULT_POOLS = [
  { top: "-15%", left: "-10%", width: "55%", height: "70%", background: "#378ADD", opacity: 0.55, depth: 10 },
  { top: "10%", left: "55%", width: "50%", height: "60%", background: "#1D9E75", opacity: 0.5, depth: 16, delay: "-4s" },
  { top: "45%", left: "20%", width: "55%", height: "65%", background: "#7F77DD", opacity: 0.45, depth: 22, delay: "-9s" },
  { top: "55%", left: "60%", width: "40%", height: "50%", background: "#5DCAA5", opacity: 0.35, depth: 14, delay: "-6s" },
];

// The ambient bokeh backdrop, now with real depth: the pools drift slowly
// on their own (CSS), and the whole group also shifts subtly toward the
// cursor (JS) — the same "wallpaper parallax" feel as iOS's tilt-based
// depth effect, translated to mouse position since desktops don't tilt.
// Pools at greater "depth" move more, giving actual layered parallax
// rather than everything sliding as one flat sheet.
// Compact pill by default — a real iOS Dynamic Island only ever shows the
// island itself, expansion happens on tap, not automatically — morphs into
// a full card on click. Built around whatever shape of live-activity array
// the caller already has (uid, name, taskTitle, workflowTitle, stepIndex,
// stepCount, stepLabel, contentType, paused, stepTimes, lastActiveAt),
// matching what this app already tracks rather than inventing a new shape.
export function DynamicIsland({ activity, attendanceToday, formatTime }) {
  const [open, setOpen] = useState(false);
  const [boardOpen, setBoardOpen] = useState(false);
  const [featuredIndex, setFeaturedIndex] = useState(0);
  const tickRef = useRef(0);

  // One list, one shape, three real states — "working" (has a live step),
  // "break", and "idle" (punched in, nothing currently open). Without this,
  // someone clocked in but between tasks just vanishes from the picture,
  // which reads as them not being there at all rather than what's actually
  // true: they're here, just not on anything right now.
  const roster = useMemo(() => {
    const workingUids = new Set((activity || []).map((a) => a.uid));
    const working = (activity || []).map((a) => ({ ...a, status: a.paused ? "paused" : "working" }));
    const idle = (attendanceToday || [])
      .filter((t) => !workingUids.has(t.uid))
      .map((t) => ({ uid: t.uid, name: t.name, status: t.onBreak ? "break" : "idle" }));
    return [...working, ...idle];
  }, [activity, attendanceToday]);

  const activeCount = roster.filter((a) => a.status === "working").length;

  // A single 1s tick drives both the live timer AND, every 4th beat, moves
  // to the next person — one interval instead of two competing ones, so
  // there's no drift between "the timer that's ticking" and "who's shown."
  useEffect(() => {
    if (roster.length === 0) return;
    const id = setInterval(() => {
      tickRef.current += 1;
      setFeaturedIndex((i) => (tickRef.current % 4 === 0 ? (i + 1) % roster.length : i));
      forceTick((t) => t + 1);
    }, 1000);
    return () => clearInterval(id);
  }, [roster.length]);
  const [, forceTick] = useState(0);

  if (roster.length === 0) return null;

  const featured = roster[featuredIndex % roster.length];
  const stepElapsed = (a) => Math.max(0, (Date.now() - new Date(a.lastActiveAt).getTime()) / 1000);
  const statusColor = { working: COLORS.teal, paused: COLORS.orange, break: COLORS.orange, idle: "rgba(255,255,255,0.4)" };
  const statusLabel = { working: null, paused: "paused", break: "on break", idle: "idle" };
  const typeLabel = { short: "Short", checking: "Checking", long: "Long" };

  const island = (
    <div style={{ position: "fixed", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 150 }}>
      <div className="cs-island overflow-hidden"
        style={{
          width: open ? "min(440px, 92vw)" : 234,
          minHeight: open ? undefined : 36,
          borderRadius: open ? 22 : 100,
          // Solid, near-black, zero blur — this is the actual real-world
          // signature of a Dynamic Island: it reads as part of the device
          // hardware, not a floating glass panel. Blur here would be the
          // wrong visual language, not just a missing detail.
          background: "#000", border: "0.5px solid rgba(255,255,255,0.14)",
          boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
        }}>
        <button onClick={() => setOpen((o) => !o)} className="w-full text-left flex items-center gap-1.5 px-3" style={{ height: 36 }}>
          <span className="relative flex items-center justify-center shrink-0" style={{ width: 7, height: 7 }}>
            {activeCount > 0 && <span className="cs-pulse-ring absolute inset-0 rounded-full" style={{ backgroundColor: COLORS.teal }} />}
            <span className="rounded-full" style={{ width: 7, height: 7, backgroundColor: statusColor[featured.status] }} />
          </span>
          {!open && (
            <span key={featured.uid} style={{ color: "#fff" }} className="cs-status-text-in text-[11px] font-semibold flex-1 min-w-0 flex items-center gap-1.5">
              <span className="truncate">{featured.name}</span>
              {featured.status === "working" || featured.status === "paused" ? (
                <>
                  <span style={{ color: featured.contentType === "short" ? COLORS.orange : featured.contentType === "checking" ? COLORS.violet : COLORS.teal }}
                    className="font-mono text-[9px] uppercase tracking-wide shrink-0">
                    {typeLabel[featured.contentType] || "Long"}
                  </span>
                  <span style={{ color: COLORS.teal }} className="font-mono tabular-nums shrink-0">{formatTime(stepElapsed(featured))}</span>
                </>
              ) : (
                <span style={{ color: "rgba(255,255,255,0.4)" }} className="shrink-0">{statusLabel[featured.status]}</span>
              )}
            </span>
          )}
          {!open && roster.length > 1 && (
            <div className="flex -space-x-1.5 shrink-0">
              {roster.slice(0, 3).map((a) => (
                <div key={a.uid} className="rounded-full flex items-center justify-center font-bold shrink-0"
                  style={{ width: 15, height: 15, fontSize: 8, background: `${statusColor[a.status]}55`, color: statusColor[a.status], border: "1px solid #000" }}>
                  {a.name.slice(0, 1).toUpperCase()}
                </div>
              ))}
            </div>
          )}
        </button>
        {open && (
          <div className="cs-status-text-in flex flex-col gap-3 px-4 pb-4 pt-1">
            {roster.map((a) => (
              <div key={a.uid} className="flex items-center gap-3">
                <div style={{ background: `${statusColor[a.status]}22`, color: statusColor[a.status] }}
                  className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs shrink-0">
                  {a.name.slice(0, 1).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p style={{ color: "#fff" }} className="text-sm font-semibold truncate">
                    {a.name}
                    {a.taskTitle && <span style={{ color: "rgba(255,255,255,0.6)" }} className="font-normal"> · {a.taskTitle}</span>}
                  </p>
                  <p style={{ color: "rgba(255,255,255,0.4)" }} className="font-mono text-[11px] truncate">
                    {a.status === "working" || a.status === "paused"
                      ? `${a.workflowTitle} · step ${a.stepIndex}/${a.stepCount}${a.stepLabel ? ` — ${a.stepLabel}` : ""}`
                      : a.status === "break" ? "On a break" : "Punched in — idle"}
                  </p>
                </div>
                {(a.status === "working" || a.status === "paused") && (
                  <span style={{ background: a.contentType === "short" ? "rgba(242,120,75,0.2)" : a.contentType === "checking" ? "rgba(167,139,250,0.2)" : "rgba(45,212,196,0.2)", color: a.contentType === "short" ? COLORS.orange : a.contentType === "checking" ? COLORS.violet : COLORS.teal }}
                    className="font-mono text-[10px] rounded-full px-2 py-0.5 shrink-0">
                    {typeLabel[a.contentType] || "Long"}
                  </span>
                )}
                {a.status === "working" && formatTime && (
                  <span style={{ color: "rgba(255,255,255,0.4)" }} className="font-mono text-[10px] shrink-0 hidden sm:inline">
                    {formatTime(stepElapsed(a))} in
                  </span>
                )}
              </div>
            ))}
            <button onClick={() => setBoardOpen(true)}
              className="cs-glass-btn cs-spring rounded-lg py-2 text-xs font-semibold text-center mt-1">
              View all as a board
            </button>
          </div>
        )}
      </div>
    </div>
  );

  return typeof document !== "undefined" ? (
    <>
      {createPortal(island, document.body)}
      {boardOpen && createPortal(<LiveActivityBoard roster={roster} formatTime={formatTime} onClose={() => setBoardOpen(false)} />, document.body)}
    </>
  ) : null;
}

// The full board — for when several editors are on several different
// videos at once and a one-line-each list stops being enough to actually
// take in at a glance. One real card per person, not a denser version of
// the same list.
function LiveActivityBoard({ roster, formatTime, onClose }) {
  const stepElapsed = (a) => Math.max(0, (Date.now() - new Date(a.lastActiveAt).getTime()) / 1000);
  const statusColor = { working: COLORS.teal, paused: COLORS.orange, break: COLORS.orange, idle: "rgba(255,255,255,0.4)" };
  const typeLabel = { short: "Short", checking: "Checking", long: "Long" };
  return (
    <div onClick={onClose} className="cs-status-text-in" style={{ position: "fixed", inset: 0, zIndex: 250, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#000", border: "0.5px solid rgba(255,255,255,0.14)", borderRadius: 24, maxWidth: 900, width: "100%", maxHeight: "80vh" }}
        className="flex flex-col">
        <div className="flex items-center justify-between px-6 pt-5 pb-3 shrink-0">
          <p style={{ color: "#fff" }} className="font-semibold">Who's working right now</p>
          <button onClick={onClose} aria-label="Close" style={{ color: "rgba(255,255,255,0.6)" }} className="cs-brighten">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          </button>
        </div>
        <div className="grid sm:grid-cols-2 gap-3 px-6 pb-6 overflow-y-auto">
          {roster.map((a) => (
            <div key={a.uid} style={{ background: "rgba(255,255,255,0.05)", border: "0.5px solid rgba(255,255,255,0.1)" }} className="rounded-xl p-4">
              <div className="flex items-center gap-3 mb-2">
                <div style={{ background: `${statusColor[a.status]}22`, color: statusColor[a.status] }}
                  className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm shrink-0">
                  {a.name.slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p style={{ color: "#fff" }} className="font-semibold text-sm truncate">{a.name}</p>
                  {(a.status === "working" || a.status === "paused") && (
                    <span style={{ color: a.contentType === "short" ? COLORS.orange : a.contentType === "checking" ? COLORS.violet : COLORS.teal }}
                      className="font-mono text-[10px] uppercase tracking-wide">
                      {typeLabel[a.contentType] || "Long"}{a.status === "paused" ? " · paused" : ""}
                    </span>
                  )}
                  {a.status === "idle" && <span style={{ color: "rgba(255,255,255,0.4)" }} className="font-mono text-[10px] uppercase tracking-wide">Idle</span>}
                  {a.status === "break" && <span style={{ color: COLORS.orange }} className="font-mono text-[10px] uppercase tracking-wide">On a break</span>}
                </div>
                {a.status === "working" && formatTime && (
                  <span style={{ color: COLORS.teal }} className="font-mono text-xs tabular-nums shrink-0">{formatTime(stepElapsed(a))}</span>
                )}
              </div>
              {a.taskTitle && <p style={{ color: "rgba(255,255,255,0.6)" }} className="text-xs truncate">{a.taskTitle}</p>}
              {(a.status === "working" || a.status === "paused") && (
                <p style={{ color: "rgba(255,255,255,0.4)" }} className="font-mono text-[11px] truncate mt-0.5">
                  {a.workflowTitle} · step {a.stepIndex}/{a.stepCount}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}


// The ambient bokeh backdrop, now with real depth: the pools drift slowly
// on their own (CSS), and the whole group also shifts subtly toward the
// cursor (JS) — the same "wallpaper parallax" feel as iOS's tilt-based
// depth effect, translated to mouse position since desktops don't tilt.
// Pools at greater "depth" move more, giving actual layered parallax
// rather than everything sliding as one flat sheet.
export function GlassBackdrop({ pools = DEFAULT_POOLS }) {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  useEffect(() => {
    const onMove = (e) => {
      setOffset({
        x: (e.clientX / window.innerWidth - 0.5) * 2,
        y: (e.clientY / window.innerHeight - 0.5) * 2,
      });
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, []);
  return (
    <div className="cs-backdrop" aria-hidden="true">
      {pools.map((p, i) => (
        <div key={i} className="cs-pool-wrap"
          style={{ top: p.top, left: p.left, width: p.width, height: p.height, transform: `translate(${offset.x * p.depth}px, ${offset.y * p.depth}px)` }}>
          <div className="cs-pool" style={{ background: p.background, opacity: p.opacity, animationDelay: p.delay }} />
        </div>
      ))}
    </div>
  );
}

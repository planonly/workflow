import React, { useState, useEffect } from "react";
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
export function DynamicIsland({ activity, formatTime }) {
  const [open, setOpen] = useState(false);
  const activeCount = (activity || []).filter((a) => !a.paused).length;
  const totalCount = (activity || []).length;
  if (totalCount === 0) return null;

  return (
    <div className="flex justify-center mb-5">
      <button onClick={() => setOpen((o) => !o)}
        className="cs-glass cs-island overflow-hidden text-left"
        style={{
          width: open ? "min(560px, 100%)" : 220,
          borderRadius: open ? 24 : 100,
          background: "#0b0a09", border: "0.5px solid rgba(255,255,255,0.22)", borderTop: "0.5px solid rgba(255,255,255,0.45)",
        }}>
        <div className="flex items-center gap-2 px-4 py-2.5">
          <span className="relative flex items-center justify-center shrink-0" style={{ width: 8, height: 8 }}>
            {activeCount > 0 && <span className="cs-pulse-ring absolute inset-0 rounded-full" style={{ backgroundColor: COLORS.teal }} />}
            <span className="rounded-full" style={{ width: 8, height: 8, backgroundColor: activeCount > 0 ? COLORS.teal : "rgba(255,255,255,0.3)" }} />
          </span>
          <span style={{ color: "#fff" }} className="text-xs font-semibold flex-1 truncate">
            {activeCount > 0 ? `${activeCount} working` : "All paused"}{totalCount > activeCount && activeCount > 0 ? ` · ${totalCount - activeCount} paused` : ""}
          </span>
          {!open && totalCount > 0 && (
            <div className="flex -space-x-1.5 shrink-0">
              {activity.slice(0, 3).map((a) => (
                <div key={a.uid} className="rounded-full flex items-center justify-center font-bold shrink-0"
                  style={{ width: 18, height: 18, fontSize: 9, background: a.paused ? "rgba(242,120,75,0.3)" : "rgba(45,212,196,0.3)", color: a.paused ? COLORS.orange : COLORS.teal, border: "1.5px solid #0b0a09" }}>
                  {a.name.slice(0, 1).toUpperCase()}
                </div>
              ))}
            </div>
          )}
        </div>
        {open && (
          <div className="cs-status-text-in flex flex-col gap-3 px-4 pb-4 pt-1">
            {activity.map((a) => (
              <div key={a.uid} className="flex items-center gap-3">
                <div style={{ background: a.paused ? "rgba(242,120,75,0.2)" : "rgba(45,212,196,0.2)", color: a.paused ? COLORS.orange : COLORS.teal }}
                  className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs shrink-0">
                  {a.name.slice(0, 1).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p style={{ color: "#fff" }} className="text-sm font-semibold truncate">
                    {a.name}
                    {a.taskTitle && <span style={{ color: "rgba(255,255,255,0.6)" }} className="font-normal"> · {a.taskTitle}</span>}
                  </p>
                  <p style={{ color: "rgba(255,255,255,0.4)" }} className="font-mono text-[11px] truncate">
                    {a.workflowTitle} · step {a.stepIndex}/{a.stepCount}{a.stepLabel ? ` — ${a.stepLabel}` : ""}
                  </p>
                </div>
                <span style={{ background: a.contentType === "short" ? "rgba(242,120,75,0.2)" : a.contentType === "checking" ? "rgba(167,139,250,0.2)" : "rgba(45,212,196,0.2)", color: a.contentType === "short" ? COLORS.orange : a.contentType === "checking" ? COLORS.violet : COLORS.teal }}
                  className="font-mono text-[10px] rounded-full px-2 py-0.5 shrink-0">
                  {a.contentType === "short" ? "Short" : a.contentType === "checking" ? "Checking" : "Long"}
                </span>
                {formatTime && (
                  <span style={{ color: "rgba(255,255,255,0.4)" }} className="font-mono text-[10px] shrink-0 hidden sm:inline">
                    {formatTime(
                      Object.values(a.stepTimes || {}).reduce((s, t) => s + t, 0) +
                      (a.paused ? 0 : Math.max(0, (Date.now() - new Date(a.lastActiveAt).getTime()) / 1000))
                    )} in
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </button>
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

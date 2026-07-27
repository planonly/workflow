import React from "react";
import { COLORS } from "../lib/core";

// A crash anywhere in the tree unmounts the whole app and leaves a blank screen,
// which tells nobody anything. This catches it and shows what actually broke,
// so a problem can be reported without needing to open developer tools.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    this.setState({ info });
    // Still log it — DevTools remains the richer view when someone has it open.
    console.error("Caught by ErrorBoundary:", error, info);
  }

  render() {
    const { error, info } = this.state;
    if (!error) return this.props.children;

    const detail = [
      String(error && (error.stack || error.message || error)),
      info && info.componentStack ? "\nComponent stack:" + info.componentStack : "",
    ].join("\n");

    return (
      <div style={{ backgroundColor: COLORS.bg }} className="min-h-screen w-full flex items-center justify-center px-6 py-10">
        <div style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.danger }} className="w-full max-w-xl rounded-2xl border p-7">
          <p style={{ color: COLORS.danger }} className="font-mono text-[11px] tracking-[0.2em] uppercase mb-3">Something broke</p>
          <h1 style={{ color: COLORS.textPrimary }} className="text-xl font-bold mb-3">This screen hit an error</h1>
          <p style={{ color: COLORS.textMuted }} className="text-sm leading-relaxed mb-5">
            Your data is safe — nothing was lost. Go back to the dashboard, or copy the
            details below if you want this fixed.
          </p>

          <div className="flex gap-2 mb-5 flex-wrap">
            <button
              onClick={() => { window.location.hash = "#/dashboard"; window.location.reload(); }}
              style={{ backgroundColor: COLORS.teal, color: "#04211D" }}
              className="rounded-xl px-4 py-2.5 text-sm font-bold hover:brightness-105 transition-all">
              Back to dashboard
            </button>
            <button
              onClick={() => { navigator.clipboard && navigator.clipboard.writeText(detail); }}
              style={{ borderColor: COLORS.border, color: COLORS.textMuted }}
              className="rounded-xl border px-4 py-2.5 text-sm font-semibold hover:opacity-80 transition-opacity">
              Copy error details
            </button>
          </div>

          <details>
            <summary style={{ color: COLORS.textFaint }} className="font-mono text-[11px] cursor-pointer mb-2">
              Technical details
            </summary>
            <pre
              style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, color: COLORS.textMuted }}
              className="rounded-xl border p-3 text-[10px] leading-relaxed overflow-auto max-h-64 whitespace-pre-wrap">
              {detail}
            </pre>
          </details>
        </div>
      </div>
    );
  }
}

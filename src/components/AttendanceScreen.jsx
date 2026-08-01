import React, { useState, useMemo } from "react";
import { COLORS, formatTime, formatClock, formatFullDate, displayNameFor, attendanceWorkedSeconds } from "../lib/core";
import { HomeIcon, Plus } from "./Icon";

function toTimeInput(iso) {
  try {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  } catch (e) {
    return "09:00";
  }
}

export default function AttendanceScreen({ user, profiles, attendance, isSupervisor, onUpdateRecord, onValidate, onUnvalidate, onCreateManual, onDelete, onBack }) {
  const [filterUid, setFilterUid] = useState(isSupervisor ? "all" : user.uid);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualUid, setManualUid] = useState("");
  const [manualDate, setManualDate] = useState(new Date().toISOString().slice(0, 10));
  const [manualIn, setManualIn] = useState("09:00");
  const [manualOut, setManualOut] = useState("17:00");

  const teamMembers = Object.keys(profiles || {}).map((uidVal) => ({ uid: uidVal, name: displayNameFor(uidVal, profiles) }));

  const records = useMemo(() => {
    let list = Object.entries(attendance || {}).map(([key, rec]) => ({ key, ...rec }));
    if (!isSupervisor) list = list.filter((r) => r.uid === user.uid);
    else if (filterUid !== "all") list = list.filter((r) => r.uid === filterUid);
    return list.sort((a, b) => (b.date > a.date ? 1 : b.date < a.date ? -1 : new Date(b.punchIn) - new Date(a.punchIn)));
  }, [attendance, isSupervisor, filterUid, user.uid]);

  const pendingCount = isSupervisor ? records.filter((r) => !r.validated).length : 0;

  // Totals per person for whatever is currently listed — the number you'd
  // actually carry into payroll.
  const totals = useMemo(() => {
    const by = {};
    records.forEach((r) => {
      if (!by[r.uid]) by[r.uid] = { uid: r.uid, name: displayNameFor(r.uid, profiles), seconds: 0, days: 0, unvalidated: 0 };
      by[r.uid].seconds += attendanceWorkedSeconds(r);
      by[r.uid].days += 1;
      if (!r.validated) by[r.uid].unvalidated += 1;
    });
    return Object.values(by).sort((a, b) => b.seconds - a.seconds);
  }, [records, profiles]);

  const exportCsv = () => {
    const header = "Date,Name,Punch in,Punch out,Breaks,Hours,Validated\n";
    const rows = records.map((r) => {
      const hrs = (attendanceWorkedSeconds(r) / 3600).toFixed(2);
      return `"${r.date}","${displayNameFor(r.uid, profiles)}","${r.punchIn ? formatClock(r.punchIn) : ""}","${r.punchOut ? formatClock(r.punchOut) : ""}",${(r.breaks || []).length},${hrs},${r.validated ? "yes" : "no"}`;
    }).join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `attendance_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const submitManual = () => {
    if (!manualUid || !manualDate) return;
    onCreateManual(manualUid, manualDate, manualIn, manualOut);
    setManualUid("");
    setManualOpen(false);
  };

  return (
    <div className="flex-1 flex flex-col max-w-3xl w-full mx-auto px-6 py-8 sm:py-10 overflow-y-auto fade-in">
      <div className="flex items-center justify-between mb-2">
        <h2 style={{ color: COLORS.textPrimary }} className="text-2xl sm:text-3xl font-bold">Attendance</h2>
        <button onClick={onBack} aria-label="Home" style={{ borderColor: COLORS.border, color: COLORS.textMuted }} className="rounded-full border p-2 hover:opacity-80 transition-opacity"><HomeIcon size={18} /></button>
      </div>
      {isSupervisor && pendingCount > 0 && (
        <p style={{ color: COLORS.orange }} className="font-mono text-xs mb-4">{pendingCount} record{pendingCount === 1 ? "" : "s"} awaiting validation</p>
      )}
      {!isSupervisor && <div className="mb-4" />}

      {isSupervisor && (
        <div className="flex items-center gap-2 mb-5 flex-wrap">
          <select value={filterUid} onChange={(e) => setFilterUid(e.target.value)}
            style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, color: COLORS.textPrimary }}
            className="rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2">
            <option value="all">All team members</option>
            {teamMembers.map((m) => <option key={m.uid} value={m.uid}>{m.name}</option>)}
          </select>
          <button onClick={() => setManualOpen((o) => !o)} style={{ backgroundColor: manualOpen ? COLORS.tealSoft : COLORS.teal, color: manualOpen ? COLORS.teal : "#04211D", borderColor: COLORS.teal }}
            className="flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-bold hover:brightness-105 transition-all ml-auto">
            <Plus size={15} /> {manualOpen ? "Close" : "Add manual entry"}
          </button>
        </div>
      )}

      {manualOpen && isSupervisor && (
        <div style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border }} className="rounded-2xl border p-5 mb-5 flex flex-col gap-3">
          <p style={{ color: COLORS.textFaint }} className="font-mono text-[11px] tracking-[0.2em] uppercase">Log a missed punch or past correction</p>
          <select value={manualUid} onChange={(e) => setManualUid(e.target.value)}
            style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, color: COLORS.textPrimary }}
            className="rounded-xl border px-3 py-2.5 text-sm outline-none focus:ring-2">
            <option value="">Who is this for?</option>
            {teamMembers.map((m) => <option key={m.uid} value={m.uid}>{m.name}</option>)}
          </select>
          <input type="date" value={manualDate} onChange={(e) => setManualDate(e.target.value)}
            style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, color: COLORS.textPrimary }}
            className="rounded-xl border px-3 py-2.5 text-sm outline-none focus:ring-2" />
          <div className="flex gap-3">
            <div className="flex-1">
              <p style={{ color: COLORS.textFaint }} className="font-mono text-[10px] tracking-[0.15em] uppercase mb-1.5">Punch in</p>
              <input type="time" value={manualIn} onChange={(e) => setManualIn(e.target.value)}
                style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, color: COLORS.textPrimary }}
                className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none focus:ring-2" />
            </div>
            <div className="flex-1">
              <p style={{ color: COLORS.textFaint }} className="font-mono text-[10px] tracking-[0.15em] uppercase mb-1.5">Punch out</p>
              <input type="time" value={manualOut} onChange={(e) => setManualOut(e.target.value)}
                style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, color: COLORS.textPrimary }}
                className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none focus:ring-2" />
            </div>
          </div>
          <button onClick={submitManual} disabled={!manualUid} style={{ backgroundColor: COLORS.teal, color: "#04211D", opacity: manualUid ? 1 : 0.4 }}
            className="rounded-xl py-2.5 text-sm font-bold hover:brightness-105 transition-all disabled:cursor-not-allowed">
            Add entry
          </button>
        </div>
      )}

      {totals.length > 0 && (
        <div style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border }} className="rounded-2xl border p-5 mb-5">
          <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
            <p style={{ color: COLORS.textFaint }} className="font-mono text-[11px] tracking-[0.2em] uppercase">Totals shown</p>
            <button onClick={exportCsv} style={{ borderColor: COLORS.border, color: COLORS.textMuted }}
              className="rounded-lg border px-2.5 py-1.5 text-xs font-semibold hover:opacity-80 transition-opacity">
              Export CSV
            </button>
          </div>
          <div className="flex flex-col gap-2.5">
            {totals.map((t) => (
              <div key={t.uid} className="flex items-center gap-3">
                <p style={{ color: COLORS.textPrimary }} className="text-sm flex-1 truncate">{t.name}</p>
                <p style={{ color: COLORS.textFaint }} className="font-mono text-[11px] shrink-0">
                  {t.days} day{t.days === 1 ? "" : "s"}
                  {t.unvalidated > 0 ? ` · ${t.unvalidated} pending` : ""}
                </p>
                <p style={{ color: COLORS.orange }} className="font-mono text-sm font-bold shrink-0 w-20 text-right">
                  {(t.seconds / 3600).toFixed(1)}h
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-3">
        {records.length === 0 && (
          <p style={{ color: COLORS.textFaint }} className="text-sm italic text-center py-10">No attendance records yet.</p>
        )}
        {records.map((rec) => (
          <AttendanceRecordCard key={rec.key} record={rec} profiles={profiles} isSupervisor={isSupervisor} isMine={rec.uid === user.uid}
            onUpdate={(fields) => onUpdateRecord(rec.key, fields)}
            onValidate={() => onValidate(rec.key)}
            onUnvalidate={() => onUnvalidate(rec.key)}
            onDelete={() => { if (window.confirm("Delete this attendance record? This can't be undone.")) onDelete(rec.key); }} />
        ))}
      </div>
    </div>
  );
}

function AttendanceRecordCard({ record, profiles, isSupervisor, isMine, onUpdate, onValidate, onUnvalidate, onDelete }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [inTime, setInTime] = useState(toTimeInput(record.punchIn));
  const [outTime, setOutTime] = useState(record.punchOut ? toTimeInput(record.punchOut) : "");

  const canEdit = isSupervisor || (isMine && !record.validated);
  const worked = attendanceWorkedSeconds(record);
  const name = displayNameFor(record.uid, profiles);

  const startEdit = () => {
    setInTime(toTimeInput(record.punchIn));
    setOutTime(record.punchOut ? toTimeInput(record.punchOut) : "");
    setEditing(true);
  };

  const commit = () => {
    const fields = {
      punchIn: new Date(`${record.date}T${inTime}`).toISOString(),
      punchOut: outTime ? new Date(`${record.date}T${outTime}`).toISOString() : null,
    };
    onUpdate(fields);
    setEditing(false);
  };

  return (
    <div style={{ backgroundColor: COLORS.bgCard, borderColor: record.validated ? COLORS.teal : COLORS.border }} className="rounded-2xl border p-4">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between gap-3 text-left">
        <div className="min-w-0">
          {isSupervisor && <p style={{ color: COLORS.textPrimary }} className="text-sm font-semibold truncate">{name}</p>}
          <p style={{ color: COLORS.textFaint }} className="font-mono text-xs mt-0.5">
            {formatFullDate(record.date)} · {formatClock(record.punchIn)} – {record.punchOut ? formatClock(record.punchOut) : "still on the clock"}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span style={{ backgroundColor: record.validated ? COLORS.tealSoft : COLORS.orangeSoft, color: record.validated ? COLORS.teal : COLORS.orange }} className="font-mono text-[10px] rounded-full px-2 py-0.5">
            {record.validated ? "Validated" : "Pending review"}
          </span>
          <span style={{ color: COLORS.textPrimary }} className="font-mono text-sm font-bold">{formatTime(worked)}</span>
        </div>
      </button>

      {open && (
        <div style={{ borderColor: COLORS.border }} className="border-t mt-3 pt-3">
          {!editing ? (
            <div className="flex flex-col gap-2">
              {record.breaks && record.breaks.length > 0 && (
                <div className="mb-1">
                  <p style={{ color: COLORS.textFaint }} className="font-mono text-[10px] tracking-[0.15em] uppercase mb-1.5">Breaks</p>
                  {record.breaks.map((b, i) => (
                    <p key={i} style={{ color: COLORS.textMuted }} className="text-xs">
                      {formatClock(b.start)} – {b.end ? formatClock(b.end) : "ongoing"}
                    </p>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-3 flex-wrap">
                {canEdit && (
                  <button onClick={startEdit} style={{ color: COLORS.teal }} className="text-xs font-semibold hover:opacity-80">Edit times</button>
                )}
                {isSupervisor && (
                  record.validated
                    ? <button onClick={onUnvalidate} style={{ color: COLORS.textFaint }} className="text-xs hover:opacity-80">Unvalidate</button>
                    : record.punchOut
                    ? <button onClick={onValidate} style={{ color: COLORS.teal }} className="text-xs font-semibold hover:opacity-80">Validate</button>
                    : <span style={{ color: COLORS.textFaint }} className="text-xs italic">Still clocked in — can't validate yet</span>
                )}
                {isSupervisor && (
                  <button onClick={onDelete} style={{ color: COLORS.danger }} className="text-xs hover:opacity-80 ml-auto">Delete</button>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex gap-3">
                <div className="flex-1">
                  <p style={{ color: COLORS.textFaint }} className="font-mono text-[10px] tracking-[0.15em] uppercase mb-1">Punch in</p>
                  <input type="time" value={inTime} onChange={(e) => setInTime(e.target.value)}
                    style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, color: COLORS.textPrimary }}
                    className="w-full rounded-lg border px-2.5 py-1.5 text-sm outline-none focus:ring-2" />
                </div>
                <div className="flex-1">
                  <p style={{ color: COLORS.textFaint }} className="font-mono text-[10px] tracking-[0.15em] uppercase mb-1">Punch out</p>
                  <input type="time" value={outTime} onChange={(e) => setOutTime(e.target.value)}
                    style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, color: COLORS.textPrimary }}
                    className="w-full rounded-lg border px-2.5 py-1.5 text-sm outline-none focus:ring-2" />
                </div>
              </div>
              <p style={{ color: COLORS.textFaint }} className="text-[11px]">Leave punch out blank if still clocked in.</p>
              <div className="flex gap-2 mt-1">
                <button onClick={() => setEditing(false)} style={{ borderColor: COLORS.border, color: COLORS.textMuted }} className="flex-1 rounded-lg border py-2 text-xs font-semibold hover:opacity-80">Cancel</button>
                <button onClick={commit} style={{ backgroundColor: COLORS.tealSoft, color: COLORS.teal }} className="flex-1 rounded-lg py-2 text-xs font-semibold hover:brightness-110 transition-all">Save</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

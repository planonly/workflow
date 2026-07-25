import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import firebase from "./lib/firebase";
import {
  COLORS, uid, progKey, makeDefaultWorkflow, normalizeSteps, migrateLegacy,
  dayKey, lsGet, lsSet,
  K_WORKFLOWS, K_ACTIVE, K_PROGRESS, K_RUNS, K_PROFILES, K_CHANNELS, K_ATTENDANCE, K_TASKS,
} from "./lib/core";

import LoginScreen from "./components/LoginScreen";
import Dashboard from "./components/Dashboard";
import ChannelDashboard from "./components/ChannelDashboard";
import DayDetailScreen from "./components/DayDetailScreen";
import ProfileScreen from "./components/ProfileScreen";
import TasksScreen from "./components/TasksScreen";
import AttendanceScreen from "./components/AttendanceScreen";
import InsightsScreen from "./components/InsightsScreen";
import RunMode from "./components/RunMode";
import CompleteScreen from "./components/CompleteScreen";
import EditMode from "./components/EditMode";

function WorkflowController({ user }) {
  const [workflows, setWorkflows] = useState(null);
  const [activeId, setActiveId] = useState(null);
  const [progress, setProgress] = useState({});
  const [runs, setRuns] = useState([]);
  const [profiles, setProfiles] = useState({});
  const [channels, setChannels] = useState([]);
  const [attendance, setAttendance] = useState({});
  const [tasks, setTasks] = useState([]);
  const [mode, setMode] = useState("dashboard");
  const [activeChannelId, setActiveChannelId] = useState(null);
  const [selectedDayKey, setSelectedDayKey] = useState(() => new Date().toISOString().slice(0, 10));
  const [dayViewChannelId, setDayViewChannelId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [direction, setDirection] = useState("forward");
  const [animKey, setAnimKey] = useState(0);
  const [syncStatus, setSyncStatus] = useState("ok"); // ok | error
  const [, forceTick] = useState(0);
  const segmentStartRef = useRef(Date.now());
  const saveTimer = useRef(null);
  const isRemoteRef = useRef(false);
  const pendingWriteRef = useRef(false);

  useEffect(() => {
    let wfs = null, active = null, prog = {}, runHistory = [], prof = {}, chans = null;
    const rawWfs = lsGet(K_WORKFLOWS);
    if (rawWfs) { try { wfs = JSON.parse(rawWfs); } catch (e) {} }
    if (!wfs || !wfs.length) {
      const migrated = migrateLegacy();
      if (migrated) {
        wfs = [migrated.workflow];
        prog[progKey(migrated.workflow.id, user.uid)] = { stepIndex: migrated.stepIndex, isComplete: migrated.isComplete, stepTimes: migrated.stepTimes, checkedSubsteps: {}, paused: false };
      } else {
        wfs = [makeDefaultWorkflow()];
      }
    } else {
      wfs = wfs.map((w) => ({ ...w, contentType: w.contentType || "long", steps: normalizeSteps(w.steps) }));
    }
    active = lsGet(K_ACTIVE) || wfs[0].id;
    if (!wfs.find((w) => w.id === active)) active = wfs[0].id;

    const rawProg = lsGet(K_PROGRESS);
    if (rawProg) { try { prog = { ...prog, ...JSON.parse(rawProg) }; } catch (e) {} }
    const rawRuns = lsGet(K_RUNS);
    if (rawRuns) { try { runHistory = JSON.parse(rawRuns); } catch (e) {} }
    const rawProfiles = lsGet(K_PROFILES);
    if (rawProfiles) { try { prof = JSON.parse(rawProfiles); } catch (e) {} }

    const rawChannels = lsGet(K_CHANNELS);
    if (rawChannels) { try { chans = JSON.parse(rawChannels); } catch (e) {} }
    if (!chans) {
      chans = [{ id: uid(), name: "Founding Press", memberUids: [] }];
    }

    let attend = {};
    const rawAttend = lsGet(K_ATTENDANCE);
    if (rawAttend) { try { attend = JSON.parse(rawAttend); } catch (e) {} }
    let taskList = [];
    const rawTasks = lsGet(K_TASKS);
    if (rawTasks) { try { taskList = JSON.parse(rawTasks); } catch (e) {} }

    setWorkflows(wfs);
    setActiveId(active);
    setProgress(prog);
    setRuns(runHistory);
    setProfiles(prof);
    setChannels(chans);
    setAttendance(attend);
    setTasks(taskList);
    segmentStartRef.current = Date.now();
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const docRef = firebase.firestore().collection("sharedData").doc("workflowController");
    const unsub = docRef.onSnapshot(
      (snap) => {
        if (pendingWriteRef.current) return; // we have a newer local change in flight — never let a stale echo overwrite it
        const data = snap.exists ? snap.data() : null;
        if (data && data.workflows) {
          isRemoteRef.current = true;
          setWorkflows(data.workflows.map((w) => ({ ...w, contentType: w.contentType || "long", steps: normalizeSteps(w.steps) })));
          if (data.progress) setProgress(data.progress);
          if (data.runs) setRuns(data.runs);
          if (data.profiles) setProfiles(data.profiles);
          if (data.channels) setChannels(data.channels);
          if (data.attendance) setAttendance(data.attendance);
          if (data.tasks) setTasks(data.tasks);
        } else {
          docRef.set({
            workflows, progress, runs, channels, attendance, tasks,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedBy: user.email,
          }, { merge: true }).catch(() => {});
        }
      },
      () => {}
    );
    return unsub;
    // eslint-disable-next-line
  }, [loaded]);

  const persistNow = useCallback((wfs, active, prog, runHistory, prof, chans, attend, taskList) => {
    lsSet(K_WORKFLOWS, JSON.stringify(wfs));
    lsSet(K_ACTIVE, active);
    lsSet(K_PROGRESS, JSON.stringify(prog));
    lsSet(K_RUNS, JSON.stringify(runHistory));
    lsSet(K_PROFILES, JSON.stringify(prof));
    lsSet(K_CHANNELS, JSON.stringify(chans));
    lsSet(K_ATTENDANCE, JSON.stringify(attend));
    lsSet(K_TASKS, JSON.stringify(taskList));
    if (isRemoteRef.current) { isRemoteRef.current = false; pendingWriteRef.current = false; return; }
    pendingWriteRef.current = true;
    firebase.firestore().collection("sharedData").doc("workflowController").set({
      workflows: wfs, progress: prog, runs: runHistory, profiles: prof, channels: chans, attendance: attend, tasks: taskList,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedBy: user.email,
    }, { merge: true })
      .then(() => { setSyncStatus("ok"); pendingWriteRef.current = false; })
      .catch(() => { setSyncStatus("error"); pendingWriteRef.current = false; });
  }, [user]);

  const persist = useCallback((wfs, active, prog, runHistory, prof, chans, attend, taskList) => {
    pendingWriteRef.current = true;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => persistNow(wfs, active, prog, runHistory, prof, chans, attend, taskList), 200);
  }, [persistNow]);

  useEffect(() => {
    if (!loaded) return;
    persist(workflows, activeId, progress, runs, profiles, channels, attendance, tasks);
  }, [workflows, activeId, progress, runs, profiles, channels, attendance, tasks, loaded, persist]);

  useEffect(() => {
    if (!loaded) return;
    const id = setInterval(() => persistNow(workflows, activeId, progress, runs, profiles, channels, attendance, tasks), 5000);
    return () => clearInterval(id);
  }, [loaded, workflows, activeId, progress, runs, profiles, channels, attendance, tasks, persistNow]);

  // Make sure this user has a profile entry even if they signed up before this feature, or signed in on a new device.
  useEffect(() => {
    if (!loaded) return;
    if (!profiles[user.uid]) {
      setProfiles((p) => ({ ...p, [user.uid]: { displayName: user.displayName || user.email.split("@")[0], email: user.email } }));
    }
  }, [loaded, profiles, user]);

  const myRole = (profiles[user.uid] && profiles[user.uid].role) || "supervisor";
  const isRestricted = myRole !== "supervisor";
  const canManage = myRole !== "partner";

  const scopedChannels = useMemo(() => {
    if (!isRestricted || !channels) return channels || [];
    return channels.filter((c) => (c.memberUids || []).includes(user.uid));
  }, [channels, isRestricted, user.uid]);

  const scopedWorkflows = useMemo(() => {
    if (!isRestricted || !workflows) return workflows || [];
    const chIds = new Set(scopedChannels.map((c) => c.id));
    return workflows.filter((w) => w.channelId && chIds.has(w.channelId));
  }, [workflows, isRestricted, scopedChannels]);

  const scopedRuns = useMemo(() => {
    if (!isRestricted || !runs) return runs || [];
    const wfIds = new Set(scopedWorkflows.map((w) => w.id));
    return runs.filter((r) => wfIds.has(r.workflowId));
  }, [runs, isRestricted, scopedWorkflows]);

  const activeWorkflow = useMemo(() => {
    if (!workflows) return null;
    return workflows.find((w) => w.id === activeId) || workflows[0];
  }, [workflows, activeId]);

  // Safety: if a restricted user somehow has an activeId outside their scope, send them home.
  useEffect(() => {
    if (!loaded || !isRestricted || !activeWorkflow) return;
    const allowed = scopedWorkflows.some((w) => w.id === activeWorkflow.id);
    if (!allowed && mode !== "dashboard") setMode("dashboard");
  }, [loaded, isRestricted, activeWorkflow, scopedWorkflows, mode]);

  const activeProgress = (activeWorkflow && progress[progKey(activeWorkflow.id, user.uid)]) || { stepIndex: 0, isComplete: false, stepTimes: {}, checkedSubsteps: {}, paused: false };
  const stepIndex = activeProgress.stepIndex || 0;
  const isComplete = !!activeProgress.isComplete;
  const stepTimes = activeProgress.stepTimes || {};
  const checkedSubsteps = activeProgress.checkedSubsteps || {};
  const paused = !!activeProgress.paused;

  const updateActiveProgress = (updater) => {
    setProgress((prev) => {
      const key = progKey(activeWorkflow.id, user.uid);
      const cur = prev[key] || { stepIndex: 0, isComplete: false, stepTimes: {}, checkedSubsteps: {}, paused: false };
      const next = updater(cur);
      return { ...prev, [key]: next };
    });
  };

  useEffect(() => {
    if (!loaded || mode !== "run" || isComplete || paused || !activeWorkflow) return;
    const id = setInterval(() => forceTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [loaded, mode, isComplete, paused, activeWorkflow]);

  const currentStepId = activeWorkflow && activeWorkflow.steps[stepIndex] ? activeWorkflow.steps[stepIndex].id : null;

  const liveSecondsForCurrent = () => {
    if (!currentStepId) return 0;
    const base = stepTimes[currentStepId] || 0;
    if (paused || isComplete) return base;
    return base + (Date.now() - segmentStartRef.current) / 1000;
  };

  const finalizeCurrentSegment = (times) => {
    if (!currentStepId || paused) return times;
    const elapsed = (Date.now() - segmentStartRef.current) / 1000;
    return { ...times, [currentStepId]: (times[currentStepId] || 0) + elapsed };
  };

  const totalSecondsNow = () => {
    if (!activeWorkflow) return 0;
    let sum = 0;
    for (const s of activeWorkflow.steps) sum += s.id === currentStepId ? 0 : (stepTimes[s.id] || 0);
    return sum + liveSecondsForCurrent();
  };

  const recordRun = (finalTimes) => {
    if (!activeWorkflow) return;
    const total = activeWorkflow.steps.reduce((sum, s) => sum + (finalTimes[s.id] || 0), 0);
    const stepLabels = {};
    activeWorkflow.steps.forEach((s) => { stepLabels[s.id] = s.text; });
    const run = {
      id: uid(),
      workflowId: activeWorkflow.id,
      workflowTitle: activeWorkflow.title,
      completedAt: new Date().toISOString(),
      completedBy: user.email,
      completedByUid: user.uid,
      totalSeconds: total,
      stepTimes: finalTimes,
      stepLabels,
      stepOrder: activeWorkflow.steps.map((s) => s.id),
    };
    setRuns((r) => [...r, run]);
  };

  const goNext = () => {
    if (!activeWorkflow) return;
    updateActiveProgress((cur) => {
      const updatedTimes = finalizeCurrentSegment(cur.stepTimes || {});
      segmentStartRef.current = Date.now();
      if ((cur.stepIndex || 0) >= activeWorkflow.steps.length - 1) {
        recordRun(updatedTimes);
        return { ...cur, stepTimes: updatedTimes, isComplete: true };
      }
      setDirection("forward"); setAnimKey((k) => k + 1);
      return { ...cur, stepTimes: updatedTimes, stepIndex: Math.min((cur.stepIndex || 0) + 1, activeWorkflow.steps.length - 1) };
    });
  };

  const goBack = () => {
    updateActiveProgress((cur) => {
      const updatedTimes = finalizeCurrentSegment(cur.stepTimes || {});
      segmentStartRef.current = Date.now();
      setDirection("backward"); setAnimKey((k) => k + 1);
      return { ...cur, stepTimes: updatedTimes, stepIndex: Math.max((cur.stepIndex || 0) - 1, 0) };
    });
  };

  const togglePause = () => {
    updateActiveProgress((cur) => {
      if (!cur.paused) {
        const updatedTimes = finalizeCurrentSegment(cur.stepTimes || {});
        return { ...cur, stepTimes: updatedTimes, paused: true };
      } else {
        segmentStartRef.current = Date.now();
        return { ...cur, paused: false };
      }
    });
  };

  const toggleSubstep = (substepId) => {
    updateActiveProgress((cur) => {
      const cs = { ...(cur.checkedSubsteps || {}) };
      const arr = new Set(cs[currentStepId] || []);
      if (arr.has(substepId)) arr.delete(substepId); else arr.add(substepId);
      cs[currentStepId] = Array.from(arr);
      return { ...cur, checkedSubsteps: cs };
    });
  };

  const restart = () => {
    setDirection("forward"); setAnimKey((k) => k + 1);
    segmentStartRef.current = Date.now();
    updateActiveProgress(() => ({ stepIndex: 0, isComplete: false, stepTimes: {}, checkedSubsteps: {}, paused: false }));
  };

  const openWorkflow = (id) => {
    setActiveId(id);
    segmentStartRef.current = Date.now();
    setMode("run");
  };

  const newIdRef = useRef(null);
  const createWorkflow = () => { newIdRef.current = uid(); setEditingId("new"); setMode("edit"); };
  const editWorkflow = (id) => { setEditingId(id); setMode("edit"); };

  const deleteWorkflow = (id) => {
    setWorkflows((wfs) => {
      const next = wfs.filter((w) => w.id !== id);
      const finalList = next.length ? next : [makeDefaultWorkflow()];
      if (activeId === id) setActiveId(finalList[0].id);
      return finalList;
    });
    setProgress((p) => {
      const c = {};
      Object.keys(p).forEach((k) => { if (!k.startsWith(id + "__")) c[k] = p[k]; });
      return c;
    });
  };

  const duplicateWorkflow = (id) => {
    const src = workflows.find((w) => w.id === id);
    if (!src) return;
    const clone = {
      id: uid(),
      title: src.title + " (copy)",
      channelId: src.channelId || null,
      contentType: src.contentType || "long",
      steps: src.steps.map((s) => ({ id: uid(), text: s.text, substeps: (s.substeps || []).map((sub) => ({ id: uid(), text: sub.text })) })),
    };
    setWorkflows((wfs) => [...wfs, clone]);
  };

  const saveWorkflow = (wfData) => {
    setWorkflows((wfs) => {
      const exists = wfs.find((w) => w.id === wfData.id);
      if (exists) return wfs.map((w) => (w.id === wfData.id ? wfData : w));
      return [...wfs, wfData];
    });
    if (editingId === "new") {
      setActiveId(wfData.id);
      setMode("run");
    } else {
      setMode("dashboard");
    }
    setEditingId(null);
  };

  const createChannel = (name) => {
    const ch = { id: uid(), name: name.trim() || "Untitled Channel", memberUids: [] };
    setChannels((c) => [...c, ch]);
    return ch.id;
  };
  const renameChannel = (id, name) => {
    setChannels((c) => c.map((ch) => (ch.id === id ? { ...ch, name: name.trim() || ch.name } : ch)));
  };
  const deleteChannel = (id) => {
    setChannels((c) => c.filter((ch) => ch.id !== id));
    setWorkflows((wfs) => wfs.map((w) => (w.channelId === id ? { ...w, channelId: null } : w)));
    if (activeChannelId === id) { setActiveChannelId(null); setMode("dashboard"); }
  };
  const toggleChannelMember = (channelId, memberUid) => {
    setChannels((c) => c.map((ch) => {
      if (ch.id !== channelId) return ch;
      const members = ch.memberUids || [];
      const has = members.includes(memberUid);
      return { ...ch, memberUids: has ? members.filter((m) => m !== memberUid) : [...members, memberUid] };
    }));
  };
  const openChannel = (id) => { setActiveChannelId(id); setMode("channel"); };
  const openDay = (dk) => { setSelectedDayKey(dk); setDayViewChannelId(null); setMode("day"); };

  const restartWorkflowById = (id) => {
    setProgress((p) => ({ ...p, [progKey(id, user.uid)]: { stepIndex: 0, isComplete: false, stepTimes: {}, checkedSubsteps: {}, paused: false } }));
  };

  const deleteRun = (runId) => setRuns((r) => r.filter((x) => x.id !== runId));
  const updateRun = (updatedRun) => setRuns((r) => r.map((x) => (x.id === updatedRun.id ? updatedRun : x)));

  // ---- Attendance ----
  const todayKey = () => new Date().toISOString().slice(0, 10);
  const myAttendanceKey = todayKey() ? `${user.uid}_${todayKey()}` : null;
  const myAttendance = attendance[myAttendanceKey] || null;

  const punchIn = () => {
    setAttendance((a) => ({ ...a, [myAttendanceKey]: { uid: user.uid, date: todayKey(), punchIn: new Date().toISOString(), punchOut: null, breaks: [], onBreak: false } }));
  };
  const startBreak = () => {
    setAttendance((a) => {
      const rec = a[myAttendanceKey];
      if (!rec || rec.onBreak || rec.punchOut) return a;
      return { ...a, [myAttendanceKey]: { ...rec, breaks: [...rec.breaks, { start: new Date().toISOString(), end: null }], onBreak: true } };
    });
  };
  const endBreak = () => {
    setAttendance((a) => {
      const rec = a[myAttendanceKey];
      if (!rec || !rec.onBreak) return a;
      const breaks = [...rec.breaks];
      breaks[breaks.length - 1] = { ...breaks[breaks.length - 1], end: new Date().toISOString() };
      return { ...a, [myAttendanceKey]: { ...rec, breaks, onBreak: false } };
    });
  };
  const punchOut = () => {
    setAttendance((a) => {
      const rec = a[myAttendanceKey];
      if (!rec || rec.punchOut) return a;
      let breaks = rec.breaks;
      if (rec.onBreak) {
        breaks = [...breaks];
        breaks[breaks.length - 1] = { ...breaks[breaks.length - 1], end: new Date().toISOString() };
      }
      return { ...a, [myAttendanceKey]: { ...rec, breaks, onBreak: false, punchOut: new Date().toISOString() } };
    });
  };

  // Edit an existing record's times/breaks (used by the Attendance screen).
  const updateAttendanceRecord = (key, fields) => {
    setAttendance((a) => {
      const rec = a[key];
      if (!rec) return a;
      return { ...a, [key]: { ...rec, ...fields } };
    });
  };
  // Supervisor sign-off that a record's hours are correct.
  const validateAttendanceRecord = (key) => {
    setAttendance((a) => {
      const rec = a[key];
      if (!rec) return a;
      return { ...a, [key]: { ...rec, validated: true, validatedBy: user.uid, validatedAt: new Date().toISOString() } };
    });
  };
  const unvalidateAttendanceRecord = (key) => {
    setAttendance((a) => {
      const rec = a[key];
      if (!rec) return a;
      return { ...a, [key]: { ...rec, validated: false, validatedBy: null, validatedAt: null } };
    });
  };
  // Supervisor logging a day someone forgot to punch in for, or a past correction.
  const createManualAttendanceRecord = (targetUid, date, punchInTime, punchOutTime) => {
    const key = `${targetUid}_${date}`;
    setAttendance((a) => ({
      ...a,
      [key]: {
        uid: targetUid,
        date,
        punchIn: punchInTime ? new Date(`${date}T${punchInTime}`).toISOString() : new Date(`${date}T09:00`).toISOString(),
        punchOut: punchOutTime ? new Date(`${date}T${punchOutTime}`).toISOString() : null,
        breaks: [],
        onBreak: false,
        validated: false,
        validatedBy: null,
        validatedAt: null,
        addedManuallyBy: user.uid,
      },
    }));
  };
  const deleteAttendanceRecord = (key) => {
    setAttendance((a) => {
      const copy = { ...a };
      delete copy[key];
      return copy;
    });
  };

  // ---- Tasks ----
  const createTask = (taskData) => {
    const task = {
      id: uid(),
      title: taskData.title,
      description: taskData.description || "",
      links: taskData.links || [],
      assignedToUid: taskData.assignedToUid,
      assignedByUid: user.uid,
      channelId: taskData.channelId || null,
      dueDate: taskData.dueDate || null,
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    setTasks((t) => [...t, task]);
  };
  const updateTaskStatus = (taskId, status) => {
    setTasks((t) => t.map((x) => (x.id === taskId ? { ...x, status } : x)));
  };
  // Full edit of a task's content (title/description/links/assignee/channel/due date), not just its status.
  const updateTask = (taskId, fields) => {
    setTasks((t) => t.map((x) => (x.id === taskId ? { ...x, ...fields } : x)));
  };
  const deleteTask = (taskId) => {
    setTasks((t) => t.filter((x) => x.id !== taskId));
  };

  const updateDisplayName = async (newName) => {
    const name = newName.trim();
    if (!name) return;
    try { await user.updateProfile({ displayName: name }); } catch (e) {}
    setProfiles((p) => ({ ...p, [user.uid]: { ...(p[user.uid] || {}), displayName: name, email: user.email } }));
  };

  const updateRole = (newRole) => {
    setProfiles((p) => ({ ...p, [user.uid]: { ...(p[user.uid] || {}), email: user.email, role: newRole } }));
  };

  useEffect(() => {
    if (mode !== "run" || !loaded) return;
    const onKey = (e) => {
      if (isComplete) return;
      const tag = (e.target && e.target.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.code === "Space") { e.preventDefault(); togglePause(); }
      else if (e.code === "ArrowRight") { e.preventDefault(); if (!paused) goNext(); }
      else if (e.code === "ArrowLeft") { e.preventDefault(); if (!paused) goBack(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line
  }, [mode, loaded, isComplete, paused, stepIndex, activeWorkflow]);

  if (!loaded || !workflows || !activeWorkflow) {
    return (
      <div style={{ backgroundColor: COLORS.bg, color: COLORS.textMuted }} className="min-h-screen w-full flex items-center justify-center font-mono text-sm tracking-widest">
        LOADING…
      </div>
    );
  }

  const total = activeWorkflow.steps.length;
  const goHome = () => setMode("dashboard");
  const signOut = () => { if (window.confirm("Sign out?")) firebase.auth().signOut(); };

  return (
    <div style={{ backgroundColor: COLORS.bg, color: COLORS.textPrimary }} className="min-h-screen w-full flex flex-col font-sans">
      {mode === "edit" ? (
        <EditMode
          workflow={editingId === "new" ? { id: newIdRef.current, title: "", steps: [], channelId: null } : workflows.find((w) => w.id === editingId)}
          isNew={editingId === "new"}
          stepTimes={editingId === "new" ? {} : (progress[progKey(editingId, user.uid)] && progress[progKey(editingId, user.uid)].stepTimes) || {}}
          channels={channels}
          onSave={saveWorkflow}
          onCancel={() => { setMode("dashboard"); setEditingId(null); }}
        />
      ) : mode === "channel" ? (
        <ChannelDashboard
          channel={scopedChannels.find((c) => c.id === activeChannelId)}
          channels={scopedChannels}
          workflows={scopedWorkflows}
          runs={scopedRuns}
          profiles={profiles}
          canManage={canManage}
          onRename={renameChannel}
          onDelete={deleteChannel}
          onToggleMember={toggleChannelMember}
          onOpenWorkflow={openWorkflow}
          onOpenDay={(dk) => { setSelectedDayKey(dk); setDayViewChannelId(activeChannelId); setMode("day"); }}
          onBack={goHome}
        />
      ) : mode === "day" ? (
        <DayDetailScreen
          dateKey={selectedDayKey}
          workflows={workflows}
          runs={runs}
          profiles={profiles}
          channels={channels}
          channelId={dayViewChannelId}
          attendance={attendance}
          onChangeDate={setSelectedDayKey}
          onBack={() => setMode(dayViewChannelId ? "channel" : "dashboard")}
        />
      ) : mode === "profile" ? (
        <ProfileScreen user={user} profiles={profiles} myRole={myRole} onUpdateName={updateDisplayName} onUpdateRole={updateRole} onBack={goHome} onSignOut={signOut} />
      ) : mode === "tasks" ? (
        <TasksScreen
          user={user}
          profiles={profiles}
          channels={scopedChannels}
          tasks={tasks}
          isSupervisor={myRole === "supervisor"}
          onCreate={createTask}
          onUpdateStatus={updateTaskStatus}
          onUpdateTask={updateTask}
          onDelete={deleteTask}
          onBack={goHome}
        />
      ) : mode === "attendance" ? (
        <AttendanceScreen
          user={user}
          profiles={profiles}
          attendance={attendance}
          isSupervisor={myRole === "supervisor"}
          onUpdateRecord={updateAttendanceRecord}
          onValidate={validateAttendanceRecord}
          onUnvalidate={unvalidateAttendanceRecord}
          onCreateManual={createManualAttendanceRecord}
          onDelete={deleteAttendanceRecord}
          onBack={goHome}
        />
      ) : mode === "insights" ? (
        <InsightsScreen workflows={scopedWorkflows} activeId={activeId} runs={scopedRuns} profiles={profiles} onSelectWorkflow={setActiveId} onClose={goHome} onDeleteRun={deleteRun} onUpdateRun={updateRun} />
      ) : mode === "run" ? (
        isComplete ? (
          <CompleteScreen workflow={activeWorkflow} stepTimes={stepTimes} totalSeconds={totalSecondsNow()} onRestart={restart} onEdit={() => editWorkflow(activeWorkflow.id)} onInsights={() => setMode("insights")} onGoHome={goHome} />
        ) : (
          <RunMode
            workflow={activeWorkflow} stepIndex={stepIndex} total={total} direction={direction} animKey={animKey}
            paused={paused} currentSeconds={liveSecondsForCurrent()} totalSeconds={totalSecondsNow()}
            checkedSubsteps={checkedSubsteps[currentStepId] || []}
            onToggleSubstep={toggleSubstep}
            onNext={goNext} onBack={goBack} onTogglePause={togglePause}
            onEdit={() => editWorkflow(activeWorkflow.id)}
            onGoHome={goHome}
            onOpenInsights={() => setMode("insights")}
            onRestart={restart}
          />
        )
      ) : (
        <Dashboard
          user={user}
          profiles={profiles}
          workflows={scopedWorkflows}
          runs={scopedRuns}
          progress={progress}
          channels={scopedChannels}
          syncStatus={syncStatus}
          canManage={canManage}
          myAttendance={myAttendance}
          onPunchIn={punchIn}
          onStartBreak={startBreak}
          onEndBreak={endBreak}
          onPunchOut={punchOut}
          myPendingTaskCount={tasks.filter((t) => t.assignedToUid === user.uid && t.status !== "done").length}
          onOpenTasks={() => setMode("tasks")}
          pendingAttendanceCount={myRole === "supervisor" ? Object.values(attendance).filter((r) => !r.validated).length : 0}
          onOpenAttendance={() => setMode("attendance")}
          onOpenWorkflow={openWorkflow}
          onCreate={createWorkflow}
          onEditWorkflow={editWorkflow}
          onDeleteWorkflow={deleteWorkflow}
          onDuplicateWorkflow={duplicateWorkflow}
          onRestartWorkflow={restartWorkflowById}
          onOpenInsights={() => setMode("insights")}
          onSignOut={signOut}
          onCreateChannel={createChannel}
          onOpenChannel={openChannel}
          onOpenProfile={() => setMode("profile")}
          onOpenDay={openDay}
        />
      )}
    </div>
  );
}



function Root() {
  const [authUser, setAuthUser] = useState(undefined);

  useEffect(() => {
    const unsub = firebase.auth().onAuthStateChanged((u) => setAuthUser(u || null));
    return unsub;
  }, []);

  if (authUser === undefined) {
    return (
      <div style={{ backgroundColor: COLORS.bg, color: COLORS.textMuted }} className="min-h-screen w-full flex items-center justify-center font-mono text-sm tracking-widest">
        LOADING…
      </div>
    );
  }
  if (!authUser) return <LoginScreen />;
  return <WorkflowController user={authUser} />;
}

/* ======================= MAIN APP ======================= */



export default Root;

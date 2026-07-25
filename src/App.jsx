import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import firebase, { provisioningAuth } from "./lib/firebase";
import {
  COLORS, uid, progKey, makeDefaultWorkflow, normalizeSteps, migrateLegacy,
  dayKey, displayNameFor, lsGet, lsSet,
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

  // One-time migration: move workflows/channels/tasks/profiles out of the old single
  // shared document into their own collections, where real per-collection security
  // rules can actually apply. Gated by an explicit marker doc (not "is the collection
  // empty?") and run inside a transaction, so it can't race against the separate
  // per-user profile bootstrap effect below or against another client's session.
  useEffect(() => {
    if (!loaded) return;
    const db = firebase.firestore();
    (async () => {
      try {
        await db.runTransaction(async (tx) => {
          const markerRef = db.collection("meta").doc("migration");
          const markerSnap = await tx.get(markerRef);
          if (markerSnap.exists) return; // already migrated — nothing to do
          const legacyRef = db.collection("sharedData").doc("workflowController");
          const legacySnap = await tx.get(legacyRef);
          const legacy = legacySnap.exists ? legacySnap.data() : null;
          const seedWfs = (legacy && legacy.workflows && legacy.workflows.length) ? legacy.workflows : [makeDefaultWorkflow()];
          seedWfs.forEach((w) => tx.set(db.collection("workflows").doc(w.id), w));
          const seedChans = (legacy && legacy.channels && legacy.channels.length) ? legacy.channels : [{ id: uid(), name: "Founding Press", memberUids: [] }];
          seedChans.forEach((c) => tx.set(db.collection("channels").doc(c.id), c));
          const seedTasks = (legacy && legacy.tasks) || [];
          seedTasks.forEach((t) => tx.set(db.collection("tasks").doc(t.id), t));
          const seedProfiles = (legacy && legacy.profiles) || {};
          Object.keys(seedProfiles).forEach((uidKey) => tx.set(db.collection("profiles").doc(uidKey), seedProfiles[uidKey]));
          if (!seedProfiles[user.uid]) {
            // First-ever run seeds the person doing the migration as admin — there is
            // no one else yet who could grant it. Everyone after that is provisioned.
            tx.set(db.collection("profiles").doc(user.uid), { displayName: user.displayName || user.email.split("@")[0], email: user.email, role: "admin" });
          }
          tx.set(markerRef, { migratedAt: firebase.firestore.FieldValue.serverTimestamp(), migratedBy: user.email });
        });
      } catch (e) { /* best-effort — local state still works from cache either way */ }
    })();
  }, [loaded]);

  // Move historical runs out of the shared document. Runs are the only
  // unbounded collection here, so they're the one that would eventually hit
  // Firestore's 1MB per-document limit.
  useEffect(() => {
    if (!loaded) return;
    const db = firebase.firestore();
    (async () => {
      try {
        await db.runTransaction(async (tx) => {
          const marker = db.collection("meta").doc("runsMigration");
          const mSnap = await tx.get(marker);
          if (mSnap.exists) return;
          const legacySnap = await tx.get(db.collection("sharedData").doc("workflowController"));
          const legacyRuns = (legacySnap.exists && legacySnap.data().runs) || [];
          legacyRuns.forEach((r) => { if (r && r.id) tx.set(db.collection("runs").doc(r.id), r); });
          tx.set(marker, { migratedAt: firebase.firestore.FieldValue.serverTimestamp(), count: legacyRuns.length });
        });
      } catch (e) { /* legacy runs stay readable either way */ }
    })();
  }, [loaded]);

  // Workflows/channels/tasks/profiles: each lives in its own collection now, so
  // Firestore's security rules can actually restrict them independently (e.g. a
  // Partner's client is denied read access to `workflows` at the database level,
  // not just hidden by the UI).
  useEffect(() => {
    if (!loaded) return;
    const db = firebase.firestore();
    const unsubs = [
      db.collection("workflows").onSnapshot((snap) => {
        const wfs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        if (wfs.length) setWorkflows(wfs.map((w) => ({ ...w, contentType: w.contentType || "long", steps: normalizeSteps(w.steps) })));
      }, () => {}),
      db.collection("channels").onSnapshot((snap) => {
        setChannels(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      }, () => {}),
      db.collection("tasks").onSnapshot((snap) => {
        setTasks(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      }, () => {}),
      db.collection("runs").onSnapshot((snap) => {
        const fromCol = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        // Merge with anything still living in the old shared document rather than
        // switching over blind — nothing disappears even if migration never ran.
        setRuns((prev) => {
          const legacy = prev.filter((r) => r.__legacy);
          const seen = new Set(fromCol.map((r) => r.id));
          return [...fromCol, ...legacy.filter((r) => !seen.has(r.id))];
        });
      }, () => {}),
      db.collection("profiles").onSnapshot((snap) => {
        const p = {};
        snap.docs.forEach((d) => { p[d.id] = d.data(); });
        setProfiles(p);
      }, () => {}),
    ];
    return () => unsubs.forEach((u) => u());
  }, [loaded]);

  // Local cache mirror only (no network) — keeps the instant-load-from-cache behavior.
  useEffect(() => { if (loaded) lsSet(K_ACTIVE, activeId); }, [activeId, loaded]);
  useEffect(() => { if (loaded) lsSet(K_WORKFLOWS, JSON.stringify(workflows)); }, [workflows, loaded]);
  useEffect(() => { if (loaded) lsSet(K_CHANNELS, JSON.stringify(channels)); }, [channels, loaded]);
  useEffect(() => { if (loaded) lsSet(K_TASKS, JSON.stringify(tasks)); }, [tasks, loaded]);
  useEffect(() => { if (loaded) lsSet(K_PROFILES, JSON.stringify(profiles)); }, [profiles, loaded]);

  const workflowsCol = () => firebase.firestore().collection("workflows");
  const channelsCol = () => firebase.firestore().collection("channels");
  const tasksCol = () => firebase.firestore().collection("tasks");
  const profilesCol = () => firebase.firestore().collection("profiles");
  const runsCol = () => firebase.firestore().collection("runs");

  // Progress, run history, and attendance stay in the shared document — every
  // role needs broad read access to these for the dashboards to work, so
  // there's no real access-control benefit to splitting them out too.
  useEffect(() => {
    if (!loaded) return;
    const docRef = firebase.firestore().collection("sharedData").doc("workflowController");
    const unsub = docRef.onSnapshot(
      (snap) => {
        if (pendingWriteRef.current) return; // we have a newer local change in flight — never let a stale echo overwrite it
        const data = snap.exists ? snap.data() : null;
        if (data) {
          isRemoteRef.current = true;
          if (data.progress) setProgress(data.progress);
          if (data.runs) {
            const legacy = data.runs.map((r) => ({ ...r, __legacy: true }));
            setRuns((prev) => {
              const fromCol = prev.filter((r) => !r.__legacy);
              const seen = new Set(fromCol.map((r) => r.id));
              return [...fromCol, ...legacy.filter((r) => !seen.has(r.id))];
            });
          }
          if (data.attendance) setAttendance(data.attendance);
        } else {
          docRef.set({
            progress, runs, attendance,
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

  const persistNow = useCallback((prog, runHistory, attend) => {
    lsSet(K_PROGRESS, JSON.stringify(prog));
    lsSet(K_RUNS, JSON.stringify(runHistory));
    lsSet(K_ATTENDANCE, JSON.stringify(attend));
    if (isRemoteRef.current) { isRemoteRef.current = false; pendingWriteRef.current = false; return; }
    pendingWriteRef.current = true;
    firebase.firestore().collection("sharedData").doc("workflowController").set({
      progress: prog, attendance: attend,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedBy: user.email,
    }, { merge: true })
      .then(() => { setSyncStatus("ok"); pendingWriteRef.current = false; })
      .catch(() => { setSyncStatus("error"); pendingWriteRef.current = false; });
  }, [user]);

  const persist = useCallback((prog, runHistory, attend) => {
    pendingWriteRef.current = true;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => persistNow(prog, runHistory, attend), 200);
  }, [persistNow]);

  useEffect(() => {
    if (!loaded) return;
    persist(progress, runs, attendance);
  }, [progress, runs, attendance, loaded, persist]);

  useEffect(() => {
    if (!loaded) return;
    const id = setInterval(() => persistNow(progress, runs, attendance), 5000);
    return () => clearInterval(id);
  }, [loaded, progress, runs, attendance, persistNow]);

  // Create a profile record only for an account that genuinely has none yet.
  // This deliberately checks the database rather than local state: local
  // `profiles` starts empty on every load, so trusting it here would clobber
  // the signed-in user's real role before the listener had delivered it.
  // Runs at most once per session, and never touches an existing profile.
  const bootstrappedRef = useRef(false);
  useEffect(() => {
    if (!loaded || bootstrappedRef.current) return;
    bootstrappedRef.current = true;
    const ref = profilesCol().doc(user.uid);
    ref.get()
      .then((snap) => {
        if (snap.exists) return; // existing account — leave its role alone
        return ref.set({
          displayName: user.displayName || user.email.split("@")[0],
          email: user.email,
          role: "none", // an admin grants the real role; no self-elevation
        });
      })
      .catch(() => {});
  }, [loaded, user]);

  // Four roles, with account authority (admin) deliberately separated from
  // operational authority (supervisor):
  //   admin      — creates accounts, assigns roles, creates/deletes channels. Plus everything below.
  //   supervisor — runs the work: tasks, attendance validation, workflow editing, all channels.
  //                Cannot create users or change anyone's role.
  //   editor     — their assigned channels, their tasks, their punch clock.
  //   partner    — read-only analytics for their assigned channels.
  // Unknown/missing role means no access, not full access — with accounts now
  // provisioned by an admin, a missing role is a broken account, not a legacy one.
  const myRole = (profiles[user.uid] && profiles[user.uid].role) || "none";
  const isAdmin = myRole === "admin";
  const isSupervisor = myRole === "supervisor" || isAdmin;   // supervisor-or-above
  const isRestricted = !isSupervisor;                        // scoped to assigned channels only
  const canManage = myRole === "editor" || isSupervisor;     // may see workflow steps / tasks at all
  const canManageUsers = isAdmin;                            // create accounts, set roles
  const canManageChannels = isAdmin;                         // create/delete channels
  const canManageChannelMembers = isSupervisor;              // add/remove editors within a channel

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

  // Safety: partners can't see workflow content, tasks, or insights, no matter how the app got here.
  useEffect(() => {
    if (!loaded || canManage) return;
    if (["run", "edit", "insights", "tasks", "attendance"].includes(mode)) setMode("dashboard");
  }, [loaded, canManage, mode]);

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
      // lastActiveAt is what makes the "working on right now" view meaningful —
      // without it there's no way to tell someone mid-task from someone who
      // left a workflow open days ago.
      const next = { ...updater(cur), lastActiveAt: new Date().toISOString(), uid: user.uid, workflowId: activeWorkflow.id };
      return { ...prev, [key]: next };
    });
  };

  // Link the run to the task it's for — the task is the video, so this is what
  // turns "on step 7" into "on step 7 of the Tuesday interview".
  const setRunTask = (taskId) => {
    updateActiveProgress((cur) => ({ ...cur, taskId: taskId || null }));
    if (taskId) {
      const t = tasks.find((x) => x.id === taskId);
      if (t && t.status === "pending") updateTaskStatus(taskId, "in_progress");
    }
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
    if (!activeWorkflow) return 0;
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
      taskId: activeProgress.taskId || null,
      taskTitle: activeProgress.taskId
        ? ((tasks.find((t) => t.id === activeProgress.taskId) || {}).title || null)
        : null,
      totalSeconds: total,
      stepTimes: finalTimes,
      stepLabels,
      stepOrder: activeWorkflow.steps.map((s) => s.id),
    };
    setRuns((r) => [...r, run]);
    runsCol().doc(run.id).set(run).catch(() => {});
    const linkedTaskId = activeProgress.taskId;
    if (linkedTaskId) {
      const t = tasks.find((x) => x.id === linkedTaskId);
      if (t && t.status !== "done") updateTaskStatus(linkedTaskId, "done");
    }
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
    if (!canManage) return; // partners can't view step content
    setActiveId(id);
    segmentStartRef.current = Date.now();
    setMode("run");
  };

  const newIdRef = useRef(null);
  const createWorkflow = () => { if (!canManage) return; newIdRef.current = uid(); setEditingId("new"); setMode("edit"); };
  const editWorkflow = (id) => { if (!canManage) return; setEditingId(id); setMode("edit"); };

  const deleteWorkflow = (id) => {
    workflowsCol().doc(id).delete().catch(() => {});
    setWorkflows((wfs) => {
      const next = wfs.filter((w) => w.id !== id);
      if (next.length === 0) {
        const def = makeDefaultWorkflow();
        workflowsCol().doc(def.id).set(def).catch(() => {});
        setActiveId(def.id);
        return [def];
      }
      if (activeId === id) setActiveId(next[0].id);
      return next;
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
    workflowsCol().doc(clone.id).set(clone).catch(() => {});
  };

  const saveWorkflow = (wfData) => {
    const clash = workflows.find((w) => w.id !== wfData.id && (w.title || "").trim().toLowerCase() === wfData.title.trim().toLowerCase());
    if (clash && !window.confirm(`A workflow called "${clash.title}" already exists. Save this one anyway?`)) return;
    setWorkflows((wfs) => {
      const exists = wfs.find((w) => w.id === wfData.id);
      if (exists) return wfs.map((w) => (w.id === wfData.id ? wfData : w));
      return [...wfs, wfData];
    });
    workflowsCol().doc(wfData.id).set(wfData).catch(() => {});
    if (editingId === "new") {
      setActiveId(wfData.id);
      setMode("run");
    } else {
      setMode("dashboard");
    }
    setEditingId(null);
  };

  const createChannel = (name) => {
    const clash = channels.find((c) => (c.name || "").trim().toLowerCase() === name.trim().toLowerCase());
    if (clash && !window.confirm(`A channel called "${clash.name}" already exists. Create another one anyway?`)) return null;
    const ch = { id: uid(), name: name.trim() || "Untitled Channel", memberUids: [] };
    setChannels((c) => [...c, ch]);
    channelsCol().doc(ch.id).set(ch).catch(() => {});
    return ch.id;
  };
  const renameChannel = (id, name) => {
    const trimmed = name.trim();
    setChannels((c) => c.map((ch) => (ch.id === id ? { ...ch, name: trimmed || ch.name } : ch)));
    if (trimmed) channelsCol().doc(id).update({ name: trimmed }).catch(() => {});
  };
  const deleteChannel = (id) => {
    // Unassign any workflows first so they aren't left pointing at a dead channel.
    workflows.filter((w) => w.channelId === id).forEach((w) => {
      workflowsCol().doc(w.id).update({ channelId: null }).catch(() => {});
    });
    channelsCol().doc(id).delete()
      .then(() => {
        setChannels((c) => c.filter((ch) => ch.id !== id));
        setWorkflows((wfs) => wfs.map((w) => (w.channelId === id ? { ...w, channelId: null } : w)));
        if (activeChannelId === id) { setActiveChannelId(null); setMode("dashboard"); }
      })
      .catch((err) => {
        // Don't fake success: if the database refused, say so rather than
        // removing it locally and letting it silently reappear on next sync.
        window.alert("Couldn't delete that channel: " + ((err && err.message) || "unknown error"));
      });
  };
  // Channel details beyond the name — the things you'd actually want at a glance
  // when deciding where work should go.
  const updateChannelMeta = (channelId, fields) => {
    if (!canManageChannels) return;
    setChannels((c) => c.map((ch) => (ch.id === channelId ? { ...ch, ...fields } : ch)));
    channelsCol().doc(channelId).update(fields)
      .catch((err) => window.alert("Couldn't save channel details: " + ((err && err.message) || "unknown error")));
  };

  const toggleChannelMember = (channelId, memberUid) => {
    setChannels((c) => c.map((ch) => {
      if (ch.id !== channelId) return ch;
      const members = ch.memberUids || [];
      const has = members.includes(memberUid);
      const newMembers = has ? members.filter((m) => m !== memberUid) : [...members, memberUid];
      channelsCol().doc(channelId).update({ memberUids: newMembers }).catch(() => {});
      return { ...ch, memberUids: newMembers };
    }));
  };
  const openChannel = (id) => { setActiveChannelId(id); setMode("channel"); };
  const openDay = (dk) => { setSelectedDayKey(dk); setDayViewChannelId(null); setMode("day"); };

  const restartWorkflowById = (id) => {
    setProgress((p) => ({ ...p, [progKey(id, user.uid)]: { stepIndex: 0, isComplete: false, stepTimes: {}, checkedSubsteps: {}, paused: false } }));
  };

  const deleteRun = (runId) => {
    setRuns((r) => r.filter((x) => x.id !== runId));
    runsCol().doc(runId).delete().catch(() => {});
  };
  const updateRun = (updatedRun) => {
    setRuns((r) => r.map((x) => (x.id === updatedRun.id ? updatedRun : x)));
    const { __legacy, ...clean } = updatedRun;
    runsCol().doc(updatedRun.id).set(clean).catch(() => {});
  };

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
    tasksCol().doc(task.id).set(task).catch(() => {});
  };
  const updateTaskStatus = (taskId, status) => {
    setTasks((t) => t.map((x) => (x.id === taskId ? { ...x, status } : x)));
    tasksCol().doc(taskId).update({ status }).catch(() => {});
  };
  // Full edit of a task's content (title/description/links/assignee/channel/due date), not just its status.
  const updateTask = (taskId, fields) => {
    setTasks((t) => t.map((x) => (x.id === taskId ? { ...x, ...fields } : x)));
    tasksCol().doc(taskId).update(fields).catch(() => {});
  };
  const deleteTask = (taskId) => {
    setTasks((t) => t.filter((x) => x.id !== taskId));
    tasksCol().doc(taskId).delete().catch(() => {});
  };

  const updateDisplayName = async (newName) => {
    const name = newName.trim();
    if (!name) return;
    try { await user.updateProfile({ displayName: name }); } catch (e) {}
    setProfiles((p) => ({ ...p, [user.uid]: { ...(p[user.uid] || {}), displayName: name, email: user.email } }));
    profilesCol().doc(user.uid).set({ displayName: name, email: user.email }, { merge: true }).catch(() => {});
  };

  // Only supervisors are allowed to change roles, and never their own — that combination
  // is what caused an accidental self-lockout once already, so it's blocked here as well
  // as hidden in the UI, and enforced again server-side by the Firestore rules.
  // Admin-only: create a teammate's account outright — auth user, profile with
  // their role, and channel memberships — instead of letting people sign
  // themselves up. Returns an error string on failure, or null on success.
  const createUserAccount = async ({ email, password, displayName, role, channelIds }) => {
    if (!canManageUsers) return "Only an admin can create accounts.";
    try {
      const cred = await provisioningAuth().createUserWithEmailAndPassword(email.trim(), password);
      const newUid = cred.user.uid;
      try { await cred.user.updateProfile({ displayName: displayName.trim() }); } catch (e) {}
      await profilesCol().doc(newUid).set({
        displayName: displayName.trim() || email.split("@")[0],
        email: email.trim(),
        role,
      });
      // Add them to whichever channels they were assigned at creation time.
      await Promise.all((channelIds || []).map((chId) => {
        const ch = channels.find((c) => c.id === chId);
        if (!ch) return Promise.resolve();
        const members = ch.memberUids || [];
        if (members.includes(newUid)) return Promise.resolve();
        return channelsCol().doc(chId).update({ memberUids: [...members, newUid] });
      }));
      await provisioningAuth().signOut(); // leave the isolated session clean
      return null;
    } catch (err) {
      return (err && err.message ? err.message : "Couldn't create the account").replace("Firebase: ", "");
    }
  };

  // Admin: rename a teammate. (Their sign-in email can't be changed from here —
  // Firebase only lets a signed-in user change their own email, so that needs
  // to be done by them, or reset from the Firebase console.)
  const updateUserName = (targetUid, newName) => {
    if (!canManageUsers) return;
    const name = (newName || "").trim();
    if (!name) return;
    setProfiles((p) => ({ ...p, [targetUid]: { ...(p[targetUid] || {}), displayName: name } }));
    profilesCol().doc(targetUid).set({ displayName: name }, { merge: true })
      .catch((err) => window.alert("Couldn't save that name: " + ((err && err.message) || "unknown error")));
  };

  // Admin: set exactly which channels a teammate belongs to, in one action.
  const setUserChannels = (targetUid, channelIds) => {
    if (!canManageUsers) return;
    const wanted = new Set(channelIds || []);
    channels.forEach((ch) => {
      const members = ch.memberUids || [];
      const has = members.includes(targetUid);
      const shouldHave = wanted.has(ch.id);
      if (has === shouldHave) return;
      const next = shouldHave ? [...members, targetUid] : members.filter((m) => m !== targetUid);
      channelsCol().doc(ch.id).update({ memberUids: next })
        .catch((err) => window.alert("Couldn't update channel membership: " + ((err && err.message) || "unknown error")));
    });
  };

  const updateUserRole = (targetUid, newRole) => {
    if (!canManageUsers) return;
    if (targetUid === user.uid) return;
    setProfiles((p) => ({ ...p, [targetUid]: { ...(p[targetUid] || {}), role: newRole } }));
    profilesCol().doc(targetUid).set({ role: newRole }, { merge: true }).catch(() => {});
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

  // Give every screen its own URL (#/dashboard, #/tasks, ...) so the browser's
  // back button moves between screens instead of leaving the app entirely.
  const firstNavRef = useRef(true);
  useEffect(() => {
    const applyHash = () => {
      const h = (window.location.hash || "").replace(/^#\/?/, "");
      // Channels carry their id in the URL so a specific channel is linkable
      // and the back button returns to the right one.
      const [screen, param] = h.split("/");
      if (screen === "channel" && param) setActiveChannelId(param);
      setMode(screen || "dashboard");
    };
    applyHash();
    window.addEventListener("popstate", applyHash);
    window.addEventListener("hashchange", applyHash);
    return () => {
      window.removeEventListener("popstate", applyHash);
      window.removeEventListener("hashchange", applyHash);
    };
  }, []);

  useEffect(() => {
    const target = mode === "channel" && activeChannelId ? `#/channel/${activeChannelId}` : `#/${mode}`;
    if (window.location.hash === target) return;
    if (firstNavRef.current) {
      window.history.replaceState(null, "", target);
      firstNavRef.current = false;
    } else {
      window.history.pushState(null, "", target);
    }
  }, [mode]);

  if (!loaded || !workflows) {
    return (
      <div style={{ backgroundColor: COLORS.bg, color: COLORS.textMuted }} className="min-h-screen w-full flex items-center justify-center font-mono text-sm tracking-widest">
        LOADING…
      </div>
    );
  }

  const total = activeWorkflow ? activeWorkflow.steps.length : 0;
  const pauseActiveRun = () => {
    if (!activeWorkflow) return;
    const key = progKey(activeWorkflow.id, user.uid);
    const cur = progress[key];
    if (!cur || cur.isComplete || cur.paused) return;
    const elapsed = (Date.now() - segmentStartRef.current) / 1000;
    const sid = activeWorkflow.steps[cur.stepIndex || 0] && activeWorkflow.steps[cur.stepIndex || 0].id;
    const times = { ...(cur.stepTimes || {}) };
    if (sid) times[sid] = (times[sid] || 0) + elapsed;
    setProgress((prev) => ({
      ...prev,
      [key]: { ...cur, stepTimes: times, paused: true, lastActiveAt: new Date().toISOString(), uid: user.uid, workflowId: activeWorkflow.id },
    }));
  };

  // Navigating away from a run stops its clock. Leaving it running would quietly
  // bill whatever you do next to the step you walked away from.
  const goHome = () => { if (mode === "run") pauseActiveRun(); setMode("dashboard"); };
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
          canManageChannels={canManageChannels}
          canManageMembers={canManageChannelMembers}
          onRename={renameChannel}
          onUpdateMeta={updateChannelMeta}
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
        <ProfileScreen user={user} profiles={profiles} myRole={myRole} isAdmin={isAdmin} channels={channels} onUpdateName={updateDisplayName} onUpdateUserRole={updateUserRole} onUpdateUserName={updateUserName} onSetUserChannels={setUserChannels} onCreateUser={createUserAccount} onBack={goHome} onSignOut={signOut} />
      ) : mode === "tasks" ? (
        <TasksScreen
          user={user}
          profiles={profiles}
          channels={scopedChannels}
          tasks={tasks}
          runs={runs}
          isSupervisor={isSupervisor}
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
          isSupervisor={isSupervisor}
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
        !activeWorkflow ? (
          <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
            <p style={{ color: COLORS.textMuted }} className="mb-4">No workflow available to run.</p>
            <button onClick={goHome} style={{ backgroundColor: COLORS.teal, color: "#04211D" }} className="rounded-xl px-5 py-2.5 text-sm font-bold">Back to Home</button>
          </div>
        ) : isComplete ? (
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
            myTasks={tasks.filter((t) => t.assignedToUid === user.uid && t.status !== "done")}
            workflowChannelId={activeWorkflow ? (activeWorkflow.channelId || null) : null}
            activeTaskId={activeProgress.taskId || ""}
            onSetTask={setRunTask}
            isClockedIn={!!myAttendance && !myAttendance.punchOut}
            onPunchIn={punchIn}
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
          canManageChannels={canManageChannels}
          myAttendance={myAttendance}
          onPunchIn={punchIn}
          onStartBreak={startBreak}
          onEndBreak={endBreak}
          onPunchOut={punchOut}
          myPendingTaskCount={tasks.filter((t) => t.assignedToUid === user.uid && t.status !== "done").length}
          onOpenTasks={() => setMode("tasks")}
          pendingAttendanceCount={isSupervisor ? Object.values(attendance).filter((r) => !r.validated).length : 0}
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
          onDeleteChannel={deleteChannel}
          liveActivity={Object.values(progress)
            .filter((pr) => pr && pr.uid && pr.lastActiveAt && !pr.isComplete)
            .map((pr) => {
              const wf = workflows.find((w) => w.id === pr.workflowId);
              const tk = pr.taskId ? tasks.find((t) => t.id === pr.taskId) : null;
              return {
                uid: pr.uid,
                name: displayNameFor(pr.uid, profiles),
                workflowTitle: wf ? wf.title : "a workflow",
                stepLabel: wf && wf.steps[pr.stepIndex || 0] ? wf.steps[pr.stepIndex || 0].text : "",
                stepIndex: (pr.stepIndex || 0) + 1,
                stepCount: wf ? wf.steps.length : 0,
                taskTitle: tk ? tk.title : null,
                contentType: wf ? (wf.contentType || "long") : "long",
                paused: !!pr.paused,
                lastActiveAt: pr.lastActiveAt,
              };
            })
            .sort((a, b) => new Date(b.lastActiveAt) - new Date(a.lastActiveAt))}
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

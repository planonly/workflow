import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import firebase, { provisioningAuth } from "./lib/firebase";
import {
  COLORS, uid, progKey, makeDefaultWorkflow, normalizeSteps, migrateLegacy,
  dayKey, displayNameFor, lsGet, lsSet,
  K_WORKFLOWS, K_ACTIVE, K_PROGRESS, K_RUNS, K_PROFILES, K_CHANNELS, K_ATTENDANCE, K_TASKS,
} from "./lib/core";
import { channelRoomId, dmRoomId } from "./lib/messaging";

import LoginScreen from "./components/LoginScreen";
import Dashboard from "./components/Dashboard";
import ChannelDashboard from "./components/ChannelDashboard";
import DayDetailScreen from "./components/DayDetailScreen";
import ProfileScreen from "./components/ProfileScreen";
import TasksScreen from "./components/TasksScreen";
import AttendanceScreen from "./components/AttendanceScreen";
import MessagesScreen from "./components/MessagesScreen";
import PartnerDashboard from "./components/PartnerDashboard";
import StudioScreen from "./components/StudioScreen";
import ErrorBoundary from "./components/ErrorBoundary";
import InsightsScreen from "./components/InsightsScreen";
import RunMode from "./components/RunMode";
import CompleteScreen from "./components/CompleteScreen";
import EditMode from "./components/EditMode";

function WorkflowController({ user }) {
  const [workflows, setWorkflows] = useState(null);
  const [activeId, setActiveId] = useState(null);
  const [progress, setProgress] = useState({});
  const [runs, setRuns] = useState([]);
  const [lastRunId, setLastRunId] = useState(null);
  const [profiles, setProfiles] = useState({});
  const [channels, setChannels] = useState([]);
  const [attendance, setAttendance] = useState({});
  const [tasks, setTasks] = useState([]);
  // The API key lives here rather than in the bundle: a static site publishes
  // everything it contains, so a key in the code is a key on the open web.
  // Behind Firestore auth it stays with the team.
  const [aiConfig, setAiConfig] = useState({ anthropicKey: "", model: "claude-sonnet-5", adOptions: "" });
  // Every package the studio has ever generated — this is the history/yield
  // data. Kept lightweight: the model's narration text isn't stored, only the
  // structured result, so a busy day of generations doesn't bloat Firestore.
  const [clipPackages, setClipPackages] = useState([]);
  // Messages for whichever room is currently open, plus this person's
  // last-read timestamp per room (for unread badges). Not a single giant
  // listener for every message ever sent — each room's messages are only
  // fetched while that room is actually open, both for cost and because a
  // narrowly-scoped query is what lets the stricter Firestore rules work.
  const [openRoomMessages, setOpenRoomMessages] = useState([]);
  const [myRoomReads, setMyRoomReads] = useState({});
  // One small doc per room — last message preview + timestamp. This is what
  // drives the room list, previews, and unread badges without syncing every
  // room's full message history just to know what's new.
  const [roomMeta, setRoomMeta] = useState({});
  const [activeRoom, setActiveRoom] = useState(null);
  // Rooms with something new since this person last opened them — a
  // per-conversation badge, not a total message count, matching how most
  // chat UIs actually communicate "you have unread things" at a glance.
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
  // Backup reset for any path that changes activeId without going through
  // the hash handler directly (which now resets the timer itself, since
  // relying solely on activeId's value changing had a real gap — see the
  // hash handler below for what that gap was).
  useEffect(() => { segmentStartRef.current = Date.now(); }, [activeId]);
  const saveTimer = useRef(null);
  const isRemoteRef = useRef(false);
  // Workflow IDs created/edited locally but not yet confirmed saved by
  // Firestore. The sync listener above uses this to avoid wiping a workflow
  // that's still in flight just because one particular snapshot doesn't have
  // it yet.
  const pendingWorkflowIdsRef = useRef(new Set());
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
        // A plain read, no transaction, before ever touching the expensive
        // path below. Migration has almost certainly already succeeded on
        // any normal load — this confirms that with a single cheap read
        // instead of entering a transaction (and its automatic internal
        // retries) every single time, for every person, on every load.
        // That retry behavior compounding across everyone's sessions is
        // exactly what turned into a sustained quota-exhaustion storm.
        const markerRef = db.collection("meta").doc("migration");
        const cheapCheck = await markerRef.get();
        if (cheapCheck.exists) return;
        await db.runTransaction(async (tx) => {
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
        const marker = db.collection("meta").doc("runsMigration");
        const cheapCheck = await marker.get();
        if (cheapCheck.exists) return;
        await db.runTransaction(async (tx) => {
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
        const incoming = wfs.map((w) => ({ ...w, contentType: w.contentType || "long", steps: normalizeSteps(w.steps) }));
        // A workflow this device created or edited but hasn't yet had
        // confirmed by Firestore must not be silently dropped just because
        // this particular snapshot doesn't include it — that absence can
        // mean "hasn't landed yet" or "the write failed," not "was deleted."
        // This is exactly the gap that let a workflow disappear from its own
        // creator's browser after existing there successfully for a while.
        setWorkflows((prev) => {
          const incomingIds = new Set(incoming.map((w) => w.id));
          const stillPendingLocal = prev.filter(
            (w) => pendingWorkflowIdsRef.current.has(w.id) && !incomingIds.has(w.id)
          );
          return [...incoming, ...stillPendingLocal];
        });
      }, () => {}),
      db.collection("channels").onSnapshot((snap) => {
        setChannels(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      }, () => {}),
      db.collection("tasks").onSnapshot((snap) => {
        setTasks(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      }, () => {}),
      aiConfigRef().onSnapshot((snap) => {
        if (snap.exists) setAiConfig((c) => ({ ...c, ...snap.data() }));
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
      db.collection("clipPackages").orderBy("createdAt", "desc").limit(200).onSnapshot((snap) => {
        setClipPackages(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      }, () => {}),
      // Only this person's own read-markers — one small doc per room they've
      // opened, never the messages themselves. Drives unread badges without
      // needing to sync every room's content just to know what's unread.
      db.collection("roomReads").where("uid", "==", user.uid).onSnapshot((snap) => {
        const reads = {};
        snap.docs.forEach((d) => { reads[d.data().roomId] = d.data().lastReadAt; });
        setMyRoomReads(reads);
      }, (err) => console.error("roomReads sync failed:", err)),
      // No where-clause here on purpose — Firestore filters list results
      // per-document against the security rules, so this naturally returns
      // only the rooms this person is actually allowed to see, with zero
      // app-side filtering needed for privacy.
      db.collection("roomMeta").onSnapshot((snap) => {
        const meta = {};
        snap.docs.forEach((d) => { meta[d.id] = d.data(); });
        setRoomMeta(meta);
      }, (err) => console.error("roomMeta sync failed:", err)),
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
  const clipPackagesCol = () => firebase.firestore().collection("clipPackages");
  const messagesCol = () => firebase.firestore().collection("messages");
  const roomReadsCol = () => firebase.firestore().collection("roomReads");
  const roomMetaCol = () => firebase.firestore().collection("roomMeta");
  const aiConfigRef = () => firebase.firestore().collection("meta").doc("aiConfig");

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
          if (data.progress) {
            // Merge per key rather than replacing wholesale, and never let an
            // incoming value roll a key backward — only accept it if its rev
            // is strictly newer than what's already showing. This is the
            // actual guarantee against steps reverting: it holds regardless
            // of exact network timing, unlike the pendingWriteRef flag alone,
            // which only covers the common case.
            setProgress((prevProgress) => {
              const merged = { ...prevProgress };
              for (const key of Object.keys(data.progress)) {
                const incoming = data.progress[key];
                const local = prevProgress[key];
                if (!local || (incoming.rev || 0) > (local.rev || 0)) {
                  merged[key] = incoming;
                }
              }
              return merged;
            });
          }
          if (data.runs) {
            const legacy = data.runs.map((r) => ({ ...r, __legacy: true }));
            setRuns((prev) => {
              const fromCol = prev.filter((r) => !r.__legacy);
              const seen = new Set(fromCol.map((r) => r.id));
              return [...fromCol, ...legacy.filter((r) => !seen.has(r.id))];
            });
          }
          if (data.attendance) {
            // The actual fix for records reverting on their own: this used to
            // be a wholesale replace, with none of the protection progress
            // already had. Any write to this shared document — even from a
            // stale, forgotten tab doing something unrelated — carries
            // whatever attendance state that tab last had in memory. Without
            // a per-key, rev-guarded merge, that stale snapshot could overwrite
            // a fresh punch-in with an old already-punched-out state, which is
            // exactly what "clocked out without doing anything" looks like
            // from the outside — it's a real, traceable race, not a mystery.
            setAttendance((prevAttendance) => {
              const merged = { ...prevAttendance };
              for (const key of Object.keys(data.attendance)) {
                const incoming = data.attendance[key];
                const local = prevAttendance[key];
                if (!local || (incoming.rev || 0) > (local.rev || 0)) {
                  merged[key] = incoming;
                }
              }
              return merged;
            });
          }
        } else {
          docRef.set({
            progress, attendance,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedBy: user.email,
          }, { merge: true }).catch(() => setSyncStatus("error"));
        }
      },
      () => {}
    );
    return unsub;
    // eslint-disable-next-line
  }, [loaded]);

  const persistNow = useCallback((prog, attend) => {
    lsSet(K_PROGRESS, JSON.stringify(prog));
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

  const persist = useCallback((prog, attend) => {
    pendingWriteRef.current = true;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => persistNow(prog, attend), 200);
  }, [persistNow]);

  useEffect(() => {
    if (!loaded) return;
    persist(progress, attendance);
  }, [progress, attendance, loaded, persist]);

  useEffect(() => {
    if (!loaded) return;
    const id = setInterval(() => persistNow(progress, attendance), 5000);
    return () => clearInterval(id);
  }, [loaded, progress, attendance, persistNow]);

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
      .catch(() => setSyncStatus("error"));
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

  // One team room per channel this person is on — everyone linked to a
  // channel is a separate team, so the room list follows that exactly.
  const myChannelRooms = useMemo(() => {
    return scopedChannels.map((c) => ({
      roomId: channelRoomId(c.id), roomType: "channel", channelId: c.id, name: c.name,
    }));
  }, [scopedChannels]);

  // Who this person can start a DM with: colleagues sharing at least one of
  // their channels, plus admins/supervisors always reachable regardless of
  // channel membership (you can always message your boss). Admin can reach
  // everyone, matching their broader visibility elsewhere in the app.
  const myDmTargets = useMemo(() => {
    if (!profiles) return [];
    const others = Object.entries(profiles).filter(([uid]) => uid !== user.uid);
    if (isSupervisor) return others.map(([uid, p]) => ({ uid, name: p.displayName || p.email }));
    const myChannelUids = new Set(scopedChannels.flatMap((c) => c.memberUids || []));
    return others
      .filter(([uid, p]) => myChannelUids.has(uid) || p.role === "admin" || p.role === "supervisor")
      .map(([uid, p]) => ({ uid, name: p.displayName || p.email }));
  }, [profiles, scopedChannels, isSupervisor, user.uid]);

  // roomMeta currently syncs every room in the whole system, not just this
  // person's own (the Firestore rules protecting that were rolled back to the
  // permissive default after the messaging saga). Without cross-referencing
  // against this person's actual room list here, the unread badge would count
  // activity from conversations they were never part of — which is exactly
  // what happened: a badge showing unread messages that were never sent to
  // that person at all.
  const myRoomIds = useMemo(() => {
    const ids = new Set(myChannelRooms.map((r) => r.roomId));
    myDmTargets.forEach((t) => ids.add(dmRoomId(user.uid, t.uid)));
    return ids;
  }, [myChannelRooms, myDmTargets, user.uid]);

  const unreadRoomCount = useMemo(() => {
    return Object.values(roomMeta).filter((m) => {
      if (!myRoomIds.has(m.roomId)) return false;
      if (!m.lastMessageAt || m.lastMessageSenderUid === user.uid) return false;
      const lastRead = myRoomReads[m.roomId];
      return !lastRead || m.lastMessageAt > lastRead;
    }).length;
  }, [roomMeta, myRoomReads, myRoomIds, user.uid]);

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
    // Default to something this person is actually allowed to open, otherwise an
    // editor's "active" workflow is one they can't see, which trips guards elsewhere.
    const pool = isRestricted ? scopedWorkflows : workflows;
    return pool.find((w) => w.id === activeId) || pool[0] || null;
  }, [workflows, scopedWorkflows, isRestricted, activeId]);

  // Safety: if a restricted user has an activeId outside their scope, keep them
  // out of that workflow. Only the workflow screens care — bouncing them off
  // Tasks or Attendance for an unrelated activeWorkflow was a bug.
  useEffect(() => {
    if (!loaded || !isRestricted || !activeWorkflow) return;
    if (mode !== "run" && mode !== "edit") return;
    const allowed = scopedWorkflows.some((w) => w.id === activeWorkflow.id);
    if (!allowed) setMode("dashboard");
  }, [loaded, isRestricted, activeWorkflow, scopedWorkflows, mode]);

  // Safety: partners can't see workflow content, tasks, or insights, no matter how the app got here.
  useEffect(() => {
    if (!loaded || canManage) return;
    if (["run", "edit", "insights", "tasks", "attendance", "studio"].includes(mode)) setMode("dashboard");
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
      const cur = prev[key] || { stepIndex: 0, isComplete: false, stepTimes: {}, checkedSubsteps: {}, paused: false, rev: 0 };
      // lastActiveAt is what makes the "working on right now" view meaningful —
      // without it there's no way to tell someone mid-task from someone who
      // left a workflow open days ago.
      // rev is a monotonically increasing counter per workflow+user. It's the
      // real fix for steps reverting: rather than trusting a single boolean
      // flag and exact timing to keep a stale Firestore echo from winning, the
      // sync listener below refuses any incoming value whose rev isn't
      // strictly newer than what's already showing — so a race can no longer
      // silently roll the step back, regardless of network timing.
      // rev used to be a per-client counter starting at 0 — which meant a
      // brand-new tab (now the norm, since every workflow opens in its own
      // tab) could write a "low" rev before it had even loaded the real
      // progress, making a fresh click look OLDER than history everyone else
      // already had and getting silently rejected forever after. A timestamp
      // has no such reset: a fresh tab's very first click is still correctly
      // newer than anything that happened before it, no hydration race possible.
      const next = { ...updater(cur), lastActiveAt: new Date().toISOString(), uid: user.uid, workflowId: activeWorkflow.id, rev: Date.now() };
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
      contentType: activeWorkflow.contentType || "long",
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
    runsCol().doc(run.id).set(run).catch(() => {
      setSyncStatus("error");
      // This run's completed time never reached the shared database — the
      // small sync-status dot alone isn't enough warning for something this
      // costly to lose silently. It stays in this device's local state and
      // will be included next time a save succeeds, but the person doing the
      // work needs to know NOW that this run's time may not be recorded.
      window.alert(
        `This run ("${run.workflowTitle}") finished, but its time couldn't be saved to the shared database. ` +
        "It's kept on this device — check your connection and try another action to trigger a retry, or tell your admin if this keeps happening."
      );
    });
    // Finishing a linked workflow no longer auto-marks the task done — only
    // an explicit click on the task itself should ever change its status.
    // The task still moves to "in progress" when it's first linked (in
    // setRunTask below), that part stays.
    return run.id;
  };

  const goNext = () => {
    if (!activeWorkflow) return;
    const isLastStep = (activeProgress.stepIndex || 0) >= activeWorkflow.steps.length - 1;
    const updatedTimes = finalizeCurrentSegment(activeProgress.stepTimes || {});
    segmentStartRef.current = Date.now();

    // The updater passed to setProgress must be pure — no other setState calls
    // and no side effects inside it. Calling setDirection/setAnimKey/recordRun
    // from inside this callback was the actual cause of steps silently
    // reverting: React can end up processing an impure updater more than once,
    // which re-fires those side effects and lets a stale value win the race.
    if (isLastStep) {
      updateActiveProgress((cur) => ({ ...cur, stepTimes: updatedTimes, isComplete: true }));
      setLastRunId(recordRun(updatedTimes));
    } else {
      setDirection("forward"); setAnimKey((k) => k + 1);
      updateActiveProgress((cur) => ({
        ...cur, stepTimes: updatedTimes,
        stepIndex: Math.min((cur.stepIndex || 0) + 1, activeWorkflow.steps.length - 1),
      }));
    }
  };

  const goBack = () => {
    if (!activeWorkflow) return;
    const updatedTimes = finalizeCurrentSegment(activeProgress.stepTimes || {});
    segmentStartRef.current = Date.now();
    setDirection("backward"); setAnimKey((k) => k + 1);
    updateActiveProgress((cur) => ({
      ...cur, stepTimes: updatedTimes,
      stepIndex: Math.max((cur.stepIndex || 0) - 1, 0),
    }));
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

  const newIdRef = useRef(null);
  const createWorkflow = () => { if (!canManage) return; newIdRef.current = uid(); setEditingId("new"); setMode("edit"); };
  const editWorkflow = (id) => { if (!canManage) return; setEditingId(id); setMode("edit"); };

  const deleteWorkflow = (id) => {
    pendingWorkflowIdsRef.current.delete(id); // an explicit delete must actually take effect, not be protected
    workflowsCol().doc(id).delete().catch(() => setSyncStatus("error"));
    setWorkflows((wfs) => {
      const next = wfs.filter((w) => w.id !== id);
      if (next.length === 0) {
        const def = makeDefaultWorkflow();
        workflowsCol().doc(def.id).set(def).catch(() => setSyncStatus("error"));
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
    workflowsCol().doc(clone.id).set(clone).catch(() => setSyncStatus("error"));
  };

  const saveWorkflow = async (wfData) => {
    const clash = workflows.find((w) => w.id !== wfData.id && (w.title || "").trim().toLowerCase() === wfData.title.trim().toLowerCase());
    if (clash && !window.confirm(`A workflow called "${clash.title}" already exists. Save this one anyway?`)) return;
    setWorkflows((wfs) => {
      const exists = wfs.find((w) => w.id === wfData.id);
      if (exists) return wfs.map((w) => (w.id === wfData.id ? wfData : w));
      return [...wfs, wfData];
    });
    // Pending until Firestore actually confirms it — the sync listener uses
    // this so an in-flight or failed save doesn't get wiped out from under
    // this device the next time any workflow snapshot fires.
    pendingWorkflowIdsRef.current.add(wfData.id);
    // The local state update above is optimistic — it makes the workflow feel
    // instant, but it isn't real until Firestore confirms it. Proceeding to
    // "run" before that confirmation used to mean a failed save was
    // completely invisible: the workflow worked fine on this one device,
    // could be run and even completed, and simply never existed anywhere
    // else — no error, no warning, nothing to notice until someone else went
    // looking for it and it wasn't there.
    try {
      await workflowsCol().doc(wfData.id).set(wfData);
      pendingWorkflowIdsRef.current.delete(wfData.id); // confirmed — no longer needs protecting
      setSyncStatus("ok");
    } catch (err) {
      // Deliberately left in pendingWorkflowIdsRef — it stays protected
      // locally until a retry succeeds or the person gives up on it.
      setSyncStatus("error");
      window.alert(
        "This workflow couldn't be saved to the shared database — right now it only exists on this device. " +
        "Check your connection and try saving again before running it, or the work put into it may be lost."
      );
      setEditingId(null);
      return;
    }
    // Saving — even a brand-new workflow — should never itself start a run.
    // Not clocked in, not linked to a task, nothing chosen yet: none of that
    // should be decided implicitly by the act of saving.
    setMode("dashboard");
    setEditingId(null);
  };

  const createChannel = (name) => {
    const clash = channels.find((c) => (c.name || "").trim().toLowerCase() === name.trim().toLowerCase());
    if (clash && !window.confirm(`A channel called "${clash.name}" already exists. Create another one anyway?`)) return null;
    const ch = { id: uid(), name: name.trim() || "Untitled Channel", memberUids: [] };
    setChannels((c) => [...c, ch]);
    channelsCol().doc(ch.id).set(ch).catch(() => setSyncStatus("error"));
    return ch.id;
  };
  const renameChannel = (id, name) => {
    const trimmed = name.trim();
    setChannels((c) => c.map((ch) => (ch.id === id ? { ...ch, name: trimmed || ch.name } : ch)));
    if (trimmed) channelsCol().doc(id).update({ name: trimmed }).catch(() => setSyncStatus("error"));
  };
  const deleteChannel = (id) => {
    // Unassign any workflows first so they aren't left pointing at a dead channel.
    workflows.filter((w) => w.channelId === id).forEach((w) => {
      workflowsCol().doc(w.id).update({ channelId: null }).catch(() => setSyncStatus("error"));
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
      channelsCol().doc(channelId).update({ memberUids: newMembers }).catch(() => setSyncStatus("error"));
      return { ...ch, memberUids: newMembers };
    }));
  };
  const openChannel = (id) => { setActiveChannelId(id); setMode("channel"); };
  const openDay = (dk) => { setSelectedDayKey(dk); setDayViewChannelId(null); setMode("day"); };

  const restartWorkflowById = (id) => {
    // Clear lastActiveAt too — a reset run shouldn't read as active work.
    // rev must be stamped here too, same as every other progress write — a
    // reset with no rev looks OLDER than the in-progress state it's meant to
    // replace and gets silently rejected by the sync guard, which is exactly
    // why a restart could appear to do nothing and leave the live tracker stuck.
    setProgress((p) => ({
      ...p,
      [progKey(id, user.uid)]: {
        stepIndex: 0, isComplete: false, stepTimes: {}, checkedSubsteps: {},
        paused: false, lastActiveAt: null, uid: user.uid, workflowId: id, rev: Date.now(),
      },
    }));
  };

  const deleteRun = (runId) => {
    setRuns((r) => r.filter((x) => x.id !== runId));
    runsCol().doc(runId).delete().catch(() => setSyncStatus("error"));
  };
  const updateRun = (updatedRun) => {
    setRuns((r) => r.map((x) => (x.id === updatedRun.id ? updatedRun : x)));
    const { __legacy, ...clean } = updatedRun;
    runsCol().doc(updatedRun.id).set(clean).catch(() => setSyncStatus("error"));
  };

  // ---- Attendance ----
  const todayKey = () => new Date().toISOString().slice(0, 10);
  const myAttendanceKey = todayKey() ? `${user.uid}_${todayKey()}` : null;
  const myAttendance = attendance[myAttendanceKey] || null;

  // Safety: being "on break" in attendance and "actively working a step" in
  // the tracker at the same moment directly contradicts what attendance is
  // recording. This only blocks a FRESH start (step one, nothing logged yet)
  // — someone already mid-run when a break starts elsewhere isn't yanked out
  // mid-step, only stopped from starting something new while on break.
  // Runs regardless of how the run screen was reached (link, direct URL,
  // reused tab), since that's the only way this is actually enforced.
  useEffect(() => {
    if (!loaded || mode !== "run" || !activeWorkflow || !myAttendance || !myAttendance.onBreak) return;
    const freshStart = !activeProgress.isComplete && (activeProgress.stepIndex || 0) === 0
      && !Object.values(activeProgress.stepTimes || {}).some((t) => t > 0);
    if (freshStart) {
      window.alert("You're on a break — end it before starting a workflow.");
      setMode("dashboard");
    }
  }, [loaded, mode, activeWorkflow, myAttendance, activeProgress]);

  const punchIn = () => {
    // Catches this at the source: someone forgetting to punch out, then
    // punching in again the next day, is exactly what left Sue stuck on
    // both the 4th and 5th at once with no way to validate the 4th. A
    // warning right here, for the person themselves, is a much earlier
    // catch than a supervisor noticing it later during review.
    const stuckDays = Object.values(attendance).filter(
      (rec) => rec.uid === user.uid && !rec.punchOut && rec.date !== todayKey()
    );
    if (stuckDays.length > 0) {
      const proceed = window.confirm(
        `You still have an open punch from ${stuckDays.map((r) => r.date).join(", ")} with no punch-out recorded. ` +
        "Ask your supervisor to fix that day's hours so it can be validated. Punch in for today anyway?"
      );
      if (!proceed) return;
    }
    setAttendance((a) => ({ ...a, [myAttendanceKey]: { uid: user.uid, date: todayKey(), punchIn: new Date().toISOString(), punchOut: null, breaks: [], onBreak: false, rev: Date.now() } }));
  };
  const startBreak = () => {
    setAttendance((a) => {
      const rec = a[myAttendanceKey];
      if (!rec || rec.onBreak || rec.punchOut) return a;
      return { ...a, [myAttendanceKey]: { ...rec, breaks: [...rec.breaks, { start: new Date().toISOString(), end: null }], onBreak: true, rev: Date.now() } };
    });
  };
  const endBreak = () => {
    setAttendance((a) => {
      const rec = a[myAttendanceKey];
      if (!rec || !rec.onBreak) return a;
      const breaks = [...rec.breaks];
      breaks[breaks.length - 1] = { ...breaks[breaks.length - 1], end: new Date().toISOString() };
      return { ...a, [myAttendanceKey]: { ...rec, breaks, onBreak: false, rev: Date.now() } };
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
      return { ...a, [myAttendanceKey]: { ...rec, breaks, onBreak: false, punchOut: new Date().toISOString(), rev: Date.now() } };
    });
  };
  // A mistaken punch-out shouldn't be a dead end for the rest of the day —
  // this restores the original punch-in time rather than starting a fresh
  // session, so the actual hours worked stay accurate.
  const undoPunchOut = () => {
    setAttendance((a) => {
      const rec = a[myAttendanceKey];
      if (!rec || !rec.punchOut) return a;
      return { ...a, [myAttendanceKey]: { ...rec, punchOut: null, rev: Date.now() } };
    });
  };

  // Edit an existing record's times/breaks (used by the Attendance screen).
  const updateAttendanceRecord = (key, fields) => {
    setAttendance((a) => {
      const rec = a[key];
      if (!rec) return a;
      return { ...a, [key]: { ...rec, ...fields, rev: Date.now() } };
    });
  };
  // Supervisor sign-off that a record's hours are correct.
  const validateAttendanceRecord = (key) => {
    setAttendance((a) => {
      const rec = a[key];
      if (!rec || !rec.punchOut) return a; // hours aren't final until they've actually clocked out
      return { ...a, [key]: { ...rec, validated: true, validatedBy: user.uid, validatedAt: new Date().toISOString(), rev: Date.now() } };
    });
  };
  const unvalidateAttendanceRecord = (key) => {
    setAttendance((a) => {
      const rec = a[key];
      if (!rec) return a;
      return { ...a, [key]: { ...rec, validated: false, validatedBy: null, validatedAt: null, rev: Date.now() } };
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
        rev: Date.now(),
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
      // Whatever the form actually sent comes through as-is, first — this is
      // the real fix. The old version named every field individually, which
      // meant any NEW field a form started sending (event, then separately
      // aiContext) needed someone to remember to also add it here, or it
      // vanished with no error at all. That's not a one-off typo risk, it's
      // a structural one, and it already bit two different fields on two
      // separate days. Spreading first means a future field is included
      // automatically; only things below that genuinely need a default,
      // a computed value, or to be forced rather than trusted from the
      // client need to be named explicitly — a much shorter, more stable list.
      ...taskData,
      description: taskData.description || "",
      aiContext: taskData.aiContext || "",
      links: taskData.links || [],
      event: taskData.event || null,
      taskType: taskData.taskType || "edit", // "edit" (normal) or "record" (script -> recording -> handoff)
      script: taskData.script || "",
      recordingLink: taskData.recordingLink || null,
      longFormCount: taskData.longFormCount || 0,   // expected pieces, stated up front — only meaningful on a "record" task
      shortsCount: taskData.shortsCount || 0,
      editorUid: taskData.editorUid || null,          // who the finished recording hands off to — chosen at request time, not left for later
      contentType: taskData.contentType || null,       // "long" or "short" — only set on a piece spawned from a completed recording
      sourceRecordingId: taskData.sourceRecordingId || null, // links a spawned editing task back to the recording it came from, for yield tracking
      channelId: taskData.channelId || null,
      dueDate: taskData.dueDate || null,
      // A new task starts at the end of the line by default — supervisors
      // move it up from there if it should jump the queue. This is the one
      // and only thing that decides display order; nothing gets silently
      // reshuffled by due date or status underneath someone's own ordering.
      order: taskData.order != null ? taskData.order : (Math.max(0, ...tasks.filter((t) => t.assignedToUid === taskData.assignedToUid).map((t) => t.order || 0)) + 1),
      // Server-controlled — never trust these from client input even if a
      // caller's taskData happened to include something under these names.
      id: uid(),
      assignedByUid: user.uid,
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    setTasks((t) => [...t, task]);
    tasksCol().doc(task.id).set(task).catch(() => setSyncStatus("error"));
    return task;
  };
  const updateTaskStatus = (taskId, status) => {
    setTasks((t) => t.map((x) => (x.id === taskId ? { ...x, status } : x)));
    tasksCol().doc(taskId).update({ status }).catch(() => setSyncStatus("error"));
  };
  // Full edit of a task's content (title/description/links/assignee/channel/due date), not just its status.
  const updateTask = (taskId, fields) => {
    setTasks((t) => t.map((x) => (x.id === taskId ? { ...x, ...fields } : x)));
    tasksCol().doc(taskId).update(fields).catch(() => setSyncStatus("error"));
  };
  // Closes the script -> record -> edit loop precisely: rather than one vague
  // editing task, this spawns exactly as many pieces as were expected when
  // the recording was requested — one per long-form video, one per short —
  // each going straight to whichever editor was chosen up front, each
  // carrying the recording link already attached. Tagging every spawned
  // piece with sourceRecordingId is what makes real yield tracking possible:
  // the partner can see exactly how many of the expected pieces actually
  // got made, not just "a task exists somewhere."
  const markRecorded = (taskId, link) => {
    const t = tasks.find((x) => x.id === taskId);
    if (!t) return;
    updateTask(taskId, { recordingLink: link, status: "done" });
    const longCount = t.longFormCount || 0;
    const shortCount = t.shortsCount || 0;
    const spawnOne = (contentType, index, total) => createTask({
      title: total > 1 ? `${t.title} (${contentType === "long" ? "Long-form" : "Short"} ${index + 1} of ${total})` : t.title,
      description: t.description || "",
      links: [{ url: link, label: "Recorded video (Dropbox)" }],
      assignedToUid: t.editorUid || null,
      channelId: t.channelId,
      dueDate: null,
      contentType,
      sourceRecordingId: t.id,
    });
    for (let i = 0; i < longCount; i++) spawnOne("long", i, longCount);
    for (let i = 0; i < shortCount; i++) spawnOne("short", i, shortCount);
    // A recording sent with nothing specified still needs somewhere to go —
    // fall back to one unassigned piece rather than silently producing nothing.
    if (longCount === 0 && shortCount === 0) {
      createTask({
        title: t.title, description: t.description || "",
        links: [{ url: link, label: "Recorded video (Dropbox)" }],
        assignedToUid: t.editorUid || null, channelId: t.channelId, dueDate: null,
        sourceRecordingId: t.id,
      });
    }
  };
  const deleteTask = (taskId) => {
    setTasks((t) => t.filter((x) => x.id !== taskId));
    tasksCol().doc(taskId).delete().catch(() => setSyncStatus("error"));
  };

  const updateDisplayName = async (newName) => {
    const name = newName.trim();
    if (!name) return;
    try { await user.updateProfile({ displayName: name }); } catch (e) {}
    setProfiles((p) => ({ ...p, [user.uid]: { ...(p[user.uid] || {}), displayName: name, email: user.email } }));
    profilesCol().doc(user.uid).set({ displayName: name, email: user.email }, { merge: true }).catch(() => setSyncStatus("error"));
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

  const saveAiConfig = (cfg) => {
    if (!canManageUsers) return;
    setAiConfig(cfg);
    aiConfigRef().set(cfg, { merge: true })
      .catch((err) => window.alert("Couldn't save that: " + ((err && err.message) || "unknown error")));
  };

  // Record of a generated package, for history and yield-per-task. Not
  // gated by role beyond having studio access at all — anyone who can
  // generate can see what's already been generated for a task.
  const saveClipPackage = (taskId, result) => {
    // Spread first, same fix as createTask earlier — this used to list
    // every field out by hand, which is exactly the pattern that silently
    // drops data the moment the shape changes. It just would have: result
    // is now { videos: [...], caution } instead of flat fields, and the old
    // version here would have saved every clip package as blank from now on.
    const doc = {
      ...result,
      taskId: taskId || null,
      createdBy: user.uid,
      createdAt: new Date().toISOString(),
    };
    clipPackagesCol().add(doc).catch(() => {});
  };

  // --- Messaging ---
  const openMessageRoomUnsubRef = useRef(null);

  // Fetches one room's messages on demand — never a firehose of every
  // message ever sent. Sorted client-side rather than via orderBy: combining
  // an equality filter with orderBy on a different field needs a composite
  // Firestore index created manually in the console, which is exactly the
  // kind of one-time setup step that's easy to miss and then fails silently
  // forever after. Sorting locally avoids that dependency entirely — the
  // per-room message count is bounded (capped at 500), so this is cheap.
  const openMessageRoom = (room) => {
    if (openMessageRoomUnsubRef.current) { openMessageRoomUnsubRef.current(); openMessageRoomUnsubRef.current = null; }
    setOpenRoomMessages([]);
    const q = messagesCol().where("roomId", "==", room.roomId).limit(500);
    openMessageRoomUnsubRef.current = q.onSnapshot((snap) => {
      const msgs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      msgs.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      setOpenRoomMessages(msgs);
    }, (err) => {
      console.error("Messages failed to load:", err);
      setSyncStatus("error");
    });
    markRoomRead(room.roomId);
  };

  const closeMessageRoom = () => {
    if (openMessageRoomUnsubRef.current) { openMessageRoomUnsubRef.current(); openMessageRoomUnsubRef.current = null; }
    setOpenRoomMessages([]);
  };

  const sendMessage = (room, text) => {
    const trimmed = (text || "").trim();
    if (!trimmed) return;
    const now = new Date().toISOString();
    const senderName = displayNameFor(user.uid, profiles, user.email);
    // Who can read this is decided once, here, rather than re-derived by a
    // security rule doing a live cross-document lookup on every single read.
    // That earlier design (checking channel membership via nested get()/
    // exists() calls inside the rule) turned out to be fragile and hard to
    // debug — this is simpler and has nothing left to fail silently.
    const readableByUids = room.roomType === "dm"
      ? [user.uid, room.otherUid]
      : ((channels.find((c) => c.id === room.channelId) || {}).memberUids || []);
    const doc = {
      roomId: room.roomId,
      roomType: room.roomType,
      channelId: room.roomType === "channel" ? room.channelId : null,
      participantUids: room.roomType === "dm" ? [user.uid, room.otherUid].sort() : null,
      readableByUids,
      senderUid: user.uid,
      senderName,
      text: trimmed,
      createdAt: now,
    };
    messagesCol().add(doc).catch((err) => { console.error("Sending message failed:", err); setSyncStatus("error"); });
    roomMetaCol().doc(room.roomId).set({
      roomId: room.roomId,
      roomType: room.roomType,
      channelId: doc.channelId,
      participantUids: doc.participantUids,
      readableByUids,
      lastMessageAt: now,
      lastMessageText: trimmed,
      lastMessageSenderName: senderName,
      lastMessageSenderUid: user.uid,
    }, { merge: true }).catch(() => {});
    markRoomRead(room.roomId);
  };

  const markRoomRead = (roomId) => {
    const now = new Date().toISOString();
    setMyRoomReads((r) => ({ ...r, [roomId]: now }));
    roomReadsCol().doc(`${user.uid}_${roomId}`).set({ uid: user.uid, roomId, lastReadAt: now }, { merge: true }).catch(() => {});
  };

  const selectRoom = (room) => {
    if (!room) { closeMessageRoom(); setActiveRoom(null); return; } // mobile "back to list"
    setActiveRoom(room);
    openMessageRoom(room);
  };

  const updateUserRole = (targetUid, newRole) => {
    if (!canManageUsers) return;
    if (targetUid === user.uid) return;
    setProfiles((p) => ({ ...p, [targetUid]: { ...(p[targetUid] || {}), role: newRole } }));
    profilesCol().doc(targetUid).set({ role: newRole }, { merge: true }).catch(() => setSyncStatus("error"));
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
      // A tab opened straight to a run URL needs to know which workflow —
      // it starts with none of the in-app navigation state a normal click carries.
      // The timer reset used to rely solely on activeId CHANGING value (a
      // separate effect keyed on it) — but if this same workflow was just
      // being viewed in Insights (which shares this same activeId), setting
      // it to the same value again is a no-op to React, so that effect never
      // fires and the run starts already carrying however long it had been
      // since that Insights visit. Resetting it directly, right here, no
      // longer depends on the value actually changing.
      if (screen === "run" && param) { setActiveId(param); segmentStartRef.current = Date.now(); }
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
    const target = mode === "channel" && activeChannelId ? `#/channel/${activeChannelId}`
      : mode === "run" && activeId ? `#/run/${activeId}`
      : `#/${mode}`;
    if (window.location.hash === target) return;
    if (firstNavRef.current) {
      window.history.replaceState(null, "", target);
      firstNavRef.current = false;
    } else {
      window.history.pushState(null, "", target);
    }
  }, [mode, activeId, activeChannelId]);

  const [idlePrompt, setIdlePrompt] = useState(false);

  const autoPauseIdle = (cutoffMs) => {
    if (!activeWorkflow) return;
    const key = progKey(activeWorkflow.id, user.uid);
    const cur = progress[key];
    if (!cur || cur.paused || cur.isComplete) return;
    const elapsed = Math.max(0, (cutoffMs - segmentStartRef.current) / 1000);
    const step = activeWorkflow.steps[cur.stepIndex || 0];
    const times = { ...(cur.stepTimes || {}) };
    if (step) times[step.id] = (times[step.id] || 0) + elapsed;
    // lastActiveAt deliberately left stale so this drops off the live tracker.
    setProgress((prev) => ({ ...prev, [key]: { ...cur, stepTimes: times, paused: true, autoPaused: true, rev: Date.now() } }));
  };

  useEffect(() => {
    if (mode !== "run" || !activeWorkflow || isComplete || paused) { setIdlePrompt(false); return; }
    const last = activeProgress.lastActiveAt;
    if (!last) return;
    const check = () => {
      const mins = (Date.now() - new Date(last).getTime()) / 60000;
      if (mins >= 60) {
        autoPauseIdle(new Date(last).getTime() + 15 * 60000);
        setIdlePrompt(false);
      } else if (mins >= 15) {
        setIdlePrompt(true);
      }
    };
    check();
    const id = setInterval(check, 30000);
    return () => clearInterval(id);
    // eslint-disable-next-line
  }, [mode, activeWorkflow, isComplete, paused, activeProgress.lastActiveAt]);

  if (!loaded || !workflows) {
    return (
      <div style={{ backgroundColor: COLORS.bg, color: COLORS.textMuted }} className="min-h-screen w-full flex items-center justify-center font-mono text-sm tracking-widest">
        LOADING…
      </div>
    );
  }

  const total = activeWorkflow ? activeWorkflow.steps.length : 0;
  // Idle handling: prompt at 15 minutes, give up at 60. Time is banked only up
  // to the moment we first asked — beyond that there's no evidence anyone was
  // at the desk, and silently billing an hour of absence corrupts the numbers.



  const confirmStillWorking = () => {
    setIdlePrompt(false);
    updateActiveProgress((cur) => ({ ...cur })); // refreshes lastActiveAt
  };

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
      [key]: { ...cur, stepTimes: times, paused: true, lastActiveAt: new Date().toISOString(), uid: user.uid, workflowId: activeWorkflow.id, rev: Date.now() },
    }));
  };

  // Navigating away from a run stops its clock. Leaving it running would quietly
  // bill whatever you do next to the step you walked away from.
  const goHome = () => setMode("dashboard");
  const signOut = () => { if (window.confirm("Sign out?")) firebase.auth().signOut(); };

  // An account with no role shouldn't just silently lose half the interface —
  // that's impossible for the person, or the admin, to diagnose. Say it plainly.
  if (myRole === "none") {
    return (
      <div style={{ backgroundColor: COLORS.bg }} className="min-h-screen w-full flex items-center justify-center px-6">
        <div style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border }} className="w-full max-w-sm rounded-2xl border p-8 text-center">
          <p style={{ color: COLORS.textFaint }} className="font-mono text-[11px] tracking-[0.2em] uppercase mb-3">Workflow Controller</p>
          <h1 style={{ color: COLORS.textPrimary }} className="text-xl font-bold mb-3">No access yet</h1>
          <p style={{ color: COLORS.textMuted }} className="text-sm leading-relaxed mb-2">
            Your account doesn't have a role assigned, so there's nothing to show you.
          </p>
          <p style={{ color: COLORS.textFaint }} className="text-xs leading-relaxed mb-6">
            Ask an admin to set your role from their Profile screen. Signed in as {user.email}.
          </p>
          <button onClick={signOut} style={{ borderColor: COLORS.border, color: COLORS.textMuted }}
            className="w-full rounded-xl border py-2.5 text-sm font-semibold hover:opacity-80 transition-opacity">
            Sign out
          </button>
        </div>
      </div>
    );
  }


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
          isSupervisor={isSupervisor}
          canManageChannels={canManageChannels}
          canManageMembers={canManageChannelMembers}
          onRename={renameChannel}
          onUpdateMeta={updateChannelMeta}
          onDelete={deleteChannel}
          onToggleMember={toggleChannelMember}
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
        <ProfileScreen user={user} profiles={profiles} myRole={myRole} isAdmin={isAdmin} channels={channels} onUpdateName={updateDisplayName} onUpdateUserRole={updateUserRole} onUpdateUserName={updateUserName} onSetUserChannels={setUserChannels} onCreateUser={createUserAccount} aiConfig={aiConfig} onSaveAiConfig={saveAiConfig} onBack={goHome} onSignOut={signOut} />
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
      ) : mode === "studio" ? (
        <StudioScreen
          tasks={isSupervisor ? tasks : tasks.filter((t) => t.assignedToUid === user.uid)}
          channels={scopedChannels} workflows={scopedWorkflows} aiConfig={aiConfig}
          clipPackages={clipPackages} onSavePackage={saveClipPackage} onBack={goHome}
        />
      ) : mode === "messages" ? (
        <MessagesScreen
          user={user} profiles={profiles}
          channelRooms={myChannelRooms} dmTargets={myDmTargets}
          activeRoom={activeRoom} onSelectRoom={selectRoom}
          messages={openRoomMessages} roomMeta={roomMeta} myRoomReads={myRoomReads}
          onSendMessage={sendMessage}
          onBack={() => { closeMessageRoom(); setActiveRoom(null); goHome(); }}
        />
      ) : mode === "attendance" ? (
        <AttendanceScreen
          user={user}
          profiles={profiles}
          attendance={attendance}
          runs={scopedRuns}
          isSupervisor={isSupervisor}
          onUpdateRecord={updateAttendanceRecord}
          onValidate={validateAttendanceRecord}
          onUnvalidate={unvalidateAttendanceRecord}
          onCreateManual={createManualAttendanceRecord}
          onDelete={deleteAttendanceRecord}
          onBack={goHome}
        />
      ) : mode === "insights" ? (
        <InsightsScreen workflows={scopedWorkflows} activeId={activeId} runs={scopedRuns} profiles={profiles} channels={scopedChannels} onSelectWorkflow={setActiveId} onClose={goHome} onDeleteRun={deleteRun} onUpdateRun={updateRun} />
      ) : mode === "run" ? (
        !activeWorkflow ? (
          <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
            <p style={{ color: COLORS.textMuted }} className="mb-4">No workflow available to run.</p>
            <button onClick={goHome} style={{ backgroundColor: COLORS.teal, color: "#04211D" }} className="rounded-xl px-5 py-2.5 text-sm font-bold">Back to Home</button>
          </div>
        ) : isComplete ? (
          <CompleteScreen workflow={activeWorkflow} stepTimes={stepTimes} totalSeconds={totalSecondsNow()} runId={lastRunId} onRestart={restart} onEdit={() => editWorkflow(activeWorkflow.id)} onInsights={() => setMode("insights")} onGoHome={goHome} />
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
            onCancelRun={() => { restartWorkflowById(activeWorkflow.id); setMode("dashboard"); }}
            myTasks={(isSupervisor ? tasks : tasks.filter((t) => t.assignedToUid === user.uid)).filter((t) => t.status !== "done")}
            workflowChannelId={activeWorkflow ? (activeWorkflow.channelId || null) : null}
            activeTaskId={activeProgress.taskId || ""}
            onSetTask={setRunTask}
            idlePrompt={idlePrompt}
            onConfirmActive={confirmStillWorking}
            onPauseFromIdle={() => { setIdlePrompt(false); togglePause(); }}
            isClockedIn={!!myAttendance && !myAttendance.punchOut}
            onPunchIn={punchIn}
          />
        )
      ) : myRole === "partner" ? (
        <PartnerDashboard
          user={user} profiles={profiles}
          channel={scopedChannels[0] || null}
          workflows={scopedWorkflows} runs={scopedRuns} progress={progress}
          attendance={attendance} tasks={tasks}
          onMarkRecorded={markRecorded}
          onOpenDay={openDay}
          onOpenMessages={() => setMode("messages")}
          unreadRoomCount={unreadRoomCount}
          onOpenProfile={() => setMode("profile")}
          onSignOut={signOut}
        />
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
          isSupervisor={isSupervisor}
          canManageChannels={canManageChannels}
          myAttendance={myAttendance}
          onPunchIn={punchIn}
          onStartBreak={startBreak}
          onEndBreak={endBreak}
          onPunchOut={punchOut}
          onUndoPunchOut={undoPunchOut}
          myPendingTaskCount={tasks.filter((t) => t.assignedToUid === user.uid && t.status !== "done").length}
          onOpenTasks={() => setMode("tasks")}
          pendingAttendanceCount={isSupervisor ? Object.values(attendance).filter((r) => !r.validated).length : 0}
          onOpenAttendance={() => setMode("attendance")}
          onOpenMessages={() => setMode("messages")}
          unreadRoomCount={unreadRoomCount}
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
          liveActivity={(isSupervisor ? Object.values(progress) : [])
            .filter((pr) => {
              if (!pr || !pr.uid || !pr.lastActiveAt || pr.isComplete) return false;
              // A workflow that's been opened or restarted but not actually worked
              // on isn't "in progress" — require a completed step or logged time.
              const anyTime = Object.values(pr.stepTimes || {}).some((t) => t > 0);
              if (!((pr.stepIndex || 0) > 0 || anyTime)) return false;
              // Idle for over an hour with no response to the check-in prompt
              // means they've gone — a full workflow doesn't take that long.
              const ageMins = (Date.now() - new Date(pr.lastActiveAt).getTime()) / 60000;
              return ageMins <= 60;
            })
            // Oversight tool: supervisors and admins only. Editors don't need to
            // watch colleagues, and partners must never see step or task names.
            .filter((pr) => scopedWorkflows.some((w) => w.id === pr.workflowId))
            .map((pr) => {
              const wf = scopedWorkflows.find((w) => w.id === pr.workflowId);
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
                stepTimes: pr.stepTimes || {},
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

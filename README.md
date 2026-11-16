# Workflow Controller

The internal production tool for a video editing team: who is working on what,
how long each video takes, what is due, and where each person's day went.
It is a single-page web app (installable as a PWA) built with React, Vite and
Firebase.

## What it does

| Area | What it covers |
| --- | --- |
| **Dashboard** | Punch in, breaks and punch out. Admins see "Team right now": every editor's current state, the video and step they are on, and how their clock time splits up. Editors see their own day and go straight to their workflows. |
| **Workflows** | Step-by-step checklists with a timer per step. Each finished run records total time and time per step. |
| **Tasks** | Work assigned to editors. Admins get a queue (one line per task, grouped by editor) and a board (one column per editor, drag to reorder or reassign). Editors get their next task shown large, with the download, Clip Studio and workflow steps in order. |
| **Clip Studio** | Turns a transcript into titles, descriptions, thumbnail text and optional scripts, split into one package per video. Has a classic view and a three-pane workspace view. |
| **Targets** | Daily goals per editor (long-form, shorts, tasks), streaks and history. A small widget stays in the corner of every screen. |
| **Time accounting** | Splits each person's clock time into workflows, downloading, Clip Studio, explained and unexplained. Asks about gaps of 20 minutes or more, nudges after 15 idle minutes, shows a day summary before punch-out, and gives admins a weekly view. |
| **Attendance** | Punch records, breaks and timesheets, with corrections by an admin. |
| **Day view and Insights** | What was posted on a given day, and run history with step timings. |
| **Revisions** | Videos sent back for changes, tracked until resolved. |
| **Messages** | Team chat rooms. |
| **Channels** | Groups workflows, tasks and editors by YouTube channel. |

## Roles

| Role | Can do |
| --- | --- |
| **Admin** | Everything, including users, roles, channels and the Clip Studio settings. |
| **Supervisor** | Everything an admin sees for the team (tracker, tasks, targets, attendance, weekly time view). |
| **Editor** | Their own tasks, workflows, targets and day. Limited to the channels they are assigned to. |
| **Partner** | A reduced dashboard with no workflow steps or tasks. |

These limits are enforced in the app, not in the database. The Firestore rules
allow any signed-in user to read and write every collection, so a field hidden
from editors in the app (for example a task's "original link") is still
readable in the database by anyone with an account.

## Project structure

```
src/
  App.jsx            Root, auth state, data sync, routing and all write functions
  main.jsx           Entry point
  lib/
    core.js          Colours, formatting and date helpers, attendance maths
    firebase.js      Firebase init (compat API)
    ai.js            Clip Studio: prompt, streaming call, activity log, cost estimate
    hls.js           Stream download and yt-dlp command building
    taskOrder.js     Queue order, queue numbers, moving and reassigning tasks
    taskInfo.js      Due dates, event line, search, per-task activity
    targets.js       Daily targets, counts, history and streaks
    dayLog.js        Time accounting: where a day's clock time went
    revisions.js     Revision records
    messaging.js     Chat rooms
    image.js         Image resizing for task reference photos
  components/
    Dashboard.jsx        Home screen, navigation, "Team right now"
    TasksScreen.jsx      Queue, board, editor view, task form, downloads
    StudioScreen.jsx     Clip Studio (classic and workspace layouts)
    DayTime.jsx          Day bars, gap question, idle nudge, day summary, weekly view
    TargetsScreen.jsx    Admin targets page and the editor's "My targets"
    TargetsWidget.jsx    Corner widget and targets card
    RunMode.jsx          Running a workflow
    EditMode.jsx         Building and editing a workflow
    AttendanceScreen.jsx, DayDetailScreen.jsx, InsightsScreen.jsx,
    MessagesScreen.jsx, RevisionsPanel.jsx, ChannelDashboard.jsx,
    PartnerDashboard.jsx, ProfileScreen.jsx, LoginScreen.jsx
    shared.jsx           StatCard, DailyBars, AttendanceWidget and other small pieces
    Icon.jsx             Icons used across the app
    ErrorBoundary.jsx    The "This screen hit an error" page
public/
  manifest.json, icons/, sw.js    PWA files, copied as-is into the build
```

The app uses hash routes: `#/dashboard`, `#/tasks`, `#/targets`, `#/studio`,
`#/run/<workflowId>` and `#/channel/<channelId>`. Clip Studio and workflow runs
open in their own browser tabs.

## Data

Everything lives in one Firebase project (Firestore plus email/password Auth).

| Where | What |
| --- | --- |
| `sharedData/workflowController` | Workflow progress and the attendance map. Each attendance record is keyed `<uid>_<day>` and also holds that day's time log. |
| `workflows`, `runs` | Workflow definitions and finished runs (with time per step). |
| `tasks` | Assigned tasks, their order within each editor's queue, links and notes. |
| `clipPackages`, `clipPackageTranscripts` | Clip Studio output and the transcripts it was generated from. |
| `profiles`, `channels` | Users with their roles, and channels with their members. |
| `meta` | Team-wide settings: targets, the expected time-accounting level, and the Clip Studio settings. |
| `messages`, `roomMeta`, `roomReads` | Chat. |

Firestore does not accept `undefined`, so every write uses real values or `null`.

## Clip Studio and the API key

Clip Studio calls the Anthropic Messages API directly from the browser. The key
and model are set by an admin on the profile screen and stored in
`meta/aiConfig`.

Because the call is made from the browser, that key is readable by any
signed-in user. Moving the call behind a small server-side proxy would fix
this; it has not been built.

## Local development

Requires [Node.js](https://nodejs.org) 20+.

```bash
npm install
npm run dev       # local dev server with hot reload
npm run build     # production build -> dist/
npm run preview   # preview the production build locally
npm run lint      # oxlint
```

There is no test suite in the repository. `App.jsx` cannot be started without
signing in to the real Firebase project, so a change to it should be checked in
the browser after deploying. One rule worth knowing before editing it: the main
component returns a loading screen early, and every React hook must sit above
that return.

## Deployment

Every push to `main` builds and deploys to GitHub Pages through GitHub Actions
(`.github/workflows/deploy.yml`). Nothing needs to be installed locally to
deploy.

One-time setup: in the repo's **Settings → Pages**, set "Build and deployment"
→ **Source** to **GitHub Actions** (not "Deploy from a branch").

## Firebase config

The config in `src/lib/firebase.js` is the public web config. It is not a
secret; access is controlled by Firebase Auth and the Firestore rules. The
Anthropic key described above is a different matter and is a real secret.

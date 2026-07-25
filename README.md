# Workflow Controller

A team workflow tracker: step-by-step checklists, time tracking, channels,
attendance, and task assignment. React + Vite + Firebase.

## Project structure

```
src/
  lib/
    core.js       — constants, storage helpers, formatting/date helpers
    firebase.js   — Firebase init (compat API)
  components/
    Icon.jsx      — all icons used across the app
    shared.jsx    — small reusable pieces (StatCard, DailyBars, AttendanceWidget, ...)
    LoginScreen.jsx, Dashboard.jsx, RunMode.jsx, EditMode.jsx, ...
  App.jsx         — Root + main app logic (auth state, data sync, routing)
  main.jsx        — entry point
public/
  manifest.json, icons/, sw.js  — PWA files, copied as-is into the build
```

## Local development

Requires [Node.js](https://nodejs.org) 20+.

```bash
npm install
npm run dev       # local dev server with hot reload
npm run build     # production build -> dist/
npm run preview   # preview the production build locally
```

## Deployment

This repo auto-deploys to GitHub Pages via GitHub Actions
(`.github/workflows/deploy.yml`) on every push to `main`. You don't need
Node.js installed locally to deploy — just push, and GitHub builds it.

One-time setup: in the repo's **Settings → Pages**, set "Build and
deployment" → **Source** to **GitHub Actions** (not "Deploy from a branch").

## Firebase

Uses Firestore (shared team data) and Firebase Auth (email/password).
Config lives in `src/lib/firebase.js` — the API key there is a public
web config key by design, not a secret; access is controlled by
Firestore security rules, not by hiding this file.

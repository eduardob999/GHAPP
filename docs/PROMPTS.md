# Prompts

A log of the tasks this codebase was built from, so the intent behind each layer
stays recoverable.

## Task 1: PWA shell + Google Auth + Firestore

**Goal.** Lay the foundation for the practice app: an installable, offline-capable
PWA shell, Google-only authentication, and Firestore with offline persistence.
No audio, drills, CAGED logic, or scheduling yet.

**What was built.**

- **Project setup** — Vite + React + TypeScript, strict mode, static output
  suitable for GitHub Pages. Relative `base` so the same build works from any
  sub-path.
- **PWA shell** — `public/manifest.webmanifest` (standalone, relative
  `start_url`, 192/512 plus maskable icons) and a hand-written
  `public/service-worker.js`. A small Vite plugin injects the fingerprinted
  bundle filenames into the worker's precache list at build time and derives a
  cache version from them, so deploys invalidate cleanly. Navigation requests
  are network-first with a cached-shell fallback; static assets are cache-first.
  Registered in production builds only.
- **Auth** — Google provider only. Popup first, falling back to redirect where
  popups are blocked (installed PWAs, some mobile browsers). `onAuthStateChanged`
  drives the top-level view: sign-in screen or dashboard.
- **Firestore** — persistence enabled through `initializeFirestore` with
  `persistentLocalCache` and `persistentMultipleTabManager`. This replaces the
  deprecated `enableIndexedDbPersistence`, and the multi-tab manager removes the
  `failed-precondition` conflict that call has when a second tab opens, rather
  than just reporting it. Falls back to an in-memory cache where IndexedDB is
  unavailable.
- **Data** — `/users/{uid}` written with `setDoc(..., { merge: true })` on every
  sign-in, carrying `uid`, `displayName`, `email`, `photoURL`, `createdAt`
  (write-once), and `lastLoginAt`. `firestore.rules` restricts every document to
  its owning uid.
- **Storage abstraction** — `src/storage/userState.ts` is the only module that
  knows the collection layout. Later milestones add `getSkillState` and friends
  there without touching components.
- **Evidence it works** — the dashboard subscribes with
  `includeMetadataChanges` and shows whether data came from cache or server,
  whether writes are still pending, and which cache mode is active. A test-ping
  button increments a counter so offline queueing and later sync are visible.

**Deliberate deviation.** The task specified `enableIndexedDbPersistence(db)`
with multi-tab error handling. That API is deprecated in the modular SDK and
documented for removal; `localCache` is its supported replacement and supports
multiple tabs properly. The friendly-degradation requirement is still met — see
the comment in `src/firebase.ts`.

**Not included, by design.** Audio, pitch detection, drills, CAGED logic, spaced
repetition, and any provider other than Google.

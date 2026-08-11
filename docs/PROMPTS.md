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

## Task 2: Audio engine + basic tuner view

**Goal.** Give the app ears. Add a reusable Web Audio capture and pitch
detection layer, surface it as a live tuner on the Dashboard, and fix the two
problems the first Pages deployment hit — a 404 from `deploy-pages` and Node 20
deprecation warnings. Detection only needs to be good enough for guitar
practice, so the design favours low latency and cheap CPU over laboratory
accuracy. Still no drills, scheduling, or Firestore writes from audio.

**Key components.**

- `src/audio/notes.ts` — frequency ↔ MIDI ↔ note-name maths, cents deviation,
  and an in-tune tolerance. Pure functions, no audio dependencies, so the
  interval and chord work in later milestones can reuse them.
- `src/audio/pitchDetection.ts` — the only module that imports `pitchy`. Exposes
  `createPitchDetector(inputLength, sampleRate)` returning
  `analyze(buffer) -> { frequency, clarity }`, with a clarity floor and a
  65–1400 Hz window that rejects rumble and octave-up errors.
- `src/audio/audioEngine.ts` — microphone capture, `AnalyserNode` reads inside
  `requestAnimationFrame` throttled to ~25 Hz, listener subscription, typed
  errors, and full teardown. Browser voice processing (AGC, noise suppression,
  echo cancellation) is explicitly disabled: it is tuned for speech and wrecks
  pitch detection.
- `src/hooks/usePitchDetector.ts` — React binding. Adds a 5-sample median filter
  (rejects the octave outliers a pick attack produces, where a mean would
  average them in), a 600 ms hold so the display does not blank between notes,
  and value rounding so an unchanged reading skips the re-render.
- `src/components/TunerPanel.tsx` — note, cents meter, frequency, clarity and
  input level. Starts only on an explicit click; no autostart on load or login.
- `.github/workflows/deploy.yml` — see below.

**Deliberate deviation.** The task specified pinning `actions/checkout@v4`,
`setup-node@v4`, `deploy-pages@v4` and `configure-pages@v5`. Those exact
versions declare `runs.using: node20` and are what emits the deprecation
warnings; the current majors (v7/v7/v5/v6) declare `node24`, so the workflow
pins those instead. `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24` is set as requested,
though it is now redundant.

`enablement: true` was also requested on `configure-pages`. It is left off and
documented instead: the input's own description requires "a token other than
GITHUB_TOKEN", so with the default token it cannot enable Pages. Setting
**Settings → Pages → Source: GitHub Actions** by hand is the fix for the 404;
the workflow cannot do it.

**How Task 2 was tested.** The note maths and detector wrapper were exercised
directly under Node against harmonic-rich synthetic tones — all six open strings
in standard tuning resolved to the correct note with sub-0.01 Hz error, a 445 Hz
input read as A4 +20 cents, and silence, white noise and out-of-range tones all
returned no pitch. The full UI was then driven in headless Chrome with a
generated WAV fed in through `--use-file-for-fake-audio-capture`: a 110 Hz tone
displayed "A2 / 0 cents / 110.0 Hz / In tune", a 112 Hz tone displayed "A2 / +31
cents / Sharp — tune down", and denying the microphone produced the friendly
error with the button reset rather than a stuck spinner.

## Task 3: Skill model + spaced-practice scheduler + Today's Session

**Goal.** Give the app a practice brain. Define what a micro-skill is, decide
when each one should come back, choose a handful to do right now, and let the
user grade them by hand. Grading is manual on purpose — audio-based scoring of
drills is a later milestone, so a practice item is a sentence to read, play, and
mark Easy/Good/Hard/Fail.

**Key components.**

- **Skill model** (`src/domain/skills.ts`) — `MicroSkillDefinition` as a union
  discriminated on `category`, so narrowing a definition also narrows its
  `family` and `metadata`. Ships a seed catalog of 41 skills: CAGED shapes, open
  chords, barre chords, power chords, scale patterns, single-string and
  string-set picking, fingerstyle, progressions, intervals and scale-over-chord
  tasks. Static and bundled — it costs no Firestore reads and works offline from
  first launch. Only per-user state crosses the network.
- **Firestore skills collection** (`src/storage/skillsState.ts`) —
  `/users/{uid}/skills/{skillId}`, subscribed with `orderBy('dueAt')` and written
  with `setDoc(..., { merge: true })`. `totalReps` uses `increment()` so two
  devices practising offline both count on reconnect. The Task 1 security rules
  already cover this via their `{document=**}` wildcard; no rules change.
- **Scheduler** (`src/domain/scheduler.ts`) — SM-2 in spirit: an ease factor
  drifting with each grade, multiplying an interval. Pure, with `now` injected.
- **Session planner** (`src/domain/sessionPlanner.ts`) — due-first (most overdue
  leading), topped up with unseen beginner material, capped per family, then
  round-robin interleaved.
- **Today's Session UI** (`src/components/PracticePanel.tsx`) — the plan is
  computed once and frozen for the sitting rather than recomputed from live
  state, so a graded card stays put and reports when it will return instead of
  vanishing the instant it is graded.
- **Pages workflow comments** — spelled out which 404s are expected before Pages
  is enabled and which are real. See "Deployment / GitHub Pages" in the roadmap.

**Two design decisions worth recording.**

*Client timestamps for `dueAt`.* `serverTimestamp()` reads back as null from the
local cache until the server confirms it. A null `dueAt` would make every graded
skill invisible to the planner until the network returned — precisely when
offline practice needs to keep working. `dueAt` and `lastPracticedAt` are
therefore written as concrete `Timestamp.fromDate(...)` values; `createdAt` and
`updatedAt` stay server timestamps because nothing schedules on them, and reads
use `{ serverTimestamps: 'estimate' }` so they are not blank offline either.

*Interleaving is separate from capping.* The per-family cap was implemented
first, and testing showed it produced sessions ordered "four open chords, four
power chords, two picking tasks" — the cap limits how many a family contributes
but not where they land, which is blocked practice wearing a rota's clothing. A
round-robin pass now spreads families across the running order while preserving
priority within each.

**How it was tested.** The domain layer was bundled with esbuild and exercised
under Node across 46 assertions: catalog integrity (unique ids, all categories
and 11 families present); scheduler determinism and non-mutation of its input;
easy/good/hard/fail producing strictly decreasing intervals; a five-rep easy
streak growing 1.33 → 3.72 → 10.97 → 34.01 → 110.53 days with ease capped at
3.5; a fail streak always returning within 0.1 days with ease floored at 1.3;
same-sitting double-taps unable to inflate an interval while a fail still pulls
it back; and for the planner — determinism, due-before-new ordering, most
overdue first, the family cap holding under pressure, inactive skills excluded,
a practised skill with no `dueAt` still surfacing, an empty plan when everything
is caught up, and no two adjacent items sharing a family. That the bundle
contains zero Firebase runtime references confirms the domain layer depends on
Firestore for types only.

The UI was then driven end to end in headless Chrome with the storage layer
swapped for an in-memory double that keeps the real scheduler, covering session
composition, family interleaving surviving into the rendered order, grading
writing through with the correct `current` state, fail scheduling sooner than
easy, session completion, and re-planning skipping what was just scheduled.

Not verified: live Firestore. The emulator needs a JVM that is not installed
here, so the round trip through `/users/{uid}/skills/{skillId}` — and the
cross-device sync that depends on it — has only been reasoned about, not run.

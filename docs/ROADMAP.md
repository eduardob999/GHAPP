# Roadmap

## Vision

An adorable, offline-first practice companion for guitar — the thing you open for
seven minutes before dinner, not the thing you set aside an evening for.

It trains three strands in parallel:

- **Fretting hand** — CAGED shapes, common open chords, barre chords, power
  chords, and scale positions, drilled by *shape and location* rather than by
  song.
- **Picking hand** — pick and bare hand, single-string accuracy, small string
  sets, and basic right-hand techniques.
- **Theory and ear-hand mapping** — chord progressions, intervals, and which
  scales sit over which chords.

The learning design leans on motor-learning research rather than on drill
volume: short distributed sessions, interleaved micro-skills instead of blocked
repetition, and retrieval spaced by how shaky a skill currently is. A
micro-skill is small and concrete — "E-shape barre at the 5th fret",
"string-sniper on the 3rd string" — so it can be scheduled, scored, and rotated
independently.

Everything works offline. The app is a static bundle plus Firestore's local
cache; practice progress syncs between devices through your Google account when
a connection is available, and queues silently when it is not.

## Milestone 1 — Foundation ✅

PWA shell, Google sign-in, Firestore with offline persistence, `/users/{uid}`
profile document, storage abstraction. See `docs/PROMPTS.md`.

## Task 2 — Audio engine + tuner + Pages workflow ✅

The first audio capability, and the deployment fixes that came with it.

- **Audio engine** (`src/audio/`) — Web Audio microphone capture with McLeod
  pitch detection via `pitchy`, wrapped so no other module depends on that
  library's API. Main-thread `AnalyserNode` inside `requestAnimationFrame`,
  throttled to ~25 Hz.
- **Tuner panel** — live note, cents-from-pitch meter, frequency, and clarity,
  on the Dashboard behind an explicit "Start tuner" click. Read-only: it writes
  nothing to Firestore and touches no scheduler state.
- **Pages workflow** — pinned the action majors that declare `node24`, added the
  missing `configure-pages` step, and documented why the 404 needs a manual
  settings change.

This brings forward the capture and detection half of Milestone 4, ahead of the
drills that will consume it. What is still missing there is scoring: onset
detection, note-versus-target grading, and running detection off the main
thread once a drill needs sample-accurate timing.

## Task 3 — Skill model + scheduler + Today's Session ✅

The practice brain, which is what Milestone 2 was about.

- **Skill catalog** (`src/domain/skills.ts`) — 41 micro-skills across fretting,
  picking and theory, each small enough to practise in 20–60 seconds. Static and
  bundled, so it costs no reads and works from the first offline launch.
- **Scheduler** (`src/domain/scheduler.ts`) — SM-2-inspired ease and interval,
  pure and deterministic with `now` injected.
- **Session planner** (`src/domain/sessionPlanner.ts`) — due-first selection,
  capped per family, then round-robin interleaved so no two adjacent items share
  a family.
- **Practice state** at `/users/{uid}/skills/{skillId}`, via
  `src/storage/skillsState.ts`. Covered by the existing security rules with no
  change, thanks to the `{document=**}` wildcard from Task 1.
- **Today's Session UI** — manual Easy/Good/Hard/Fail grading on the Dashboard,
  alongside the tuner.
- **Pages workflow** — documented exactly which 404s are expected before Pages
  is enabled, and which are real.

Still open from Milestone 2: a session log (`/users/{uid}/sessions`) so history
survives changes to the algorithm.

## Milestone 2 — Skill model and scheduler

- Define the micro-skill taxonomy: fretting shapes, picking patterns, theory
  items, each with an id, family, and difficulty.
- `/users/{uid}/skills/{skillId}` — per-skill state: ease, interval, due date,
  recent accuracy, streak.
- `/users/{uid}/sessions/{sessionId}` — an append-only practice log, so history
  survives changes to the scheduling algorithm.
- A spaced scheduler that picks today's rotation, interleaving families rather
  than blocking them.
- Extend `src/storage/` with `getSkillState` / `updateSkillState` /
  `appendSession`. No component should learn the collection layout.

## Milestone 3 — Drills without audio

- Chord-shape and fretboard rendering (SVG diagrams).
- Timed prompts, self-graded outcomes, a metronome via the Web Audio API.
- Session flow: warm-up, rotation, cool-down, and a summary that writes back to
  skill state.

## Milestone 4 — Audio scoring

Capture and monophonic pitch detection landed early, in Task 2. What remains:

- Note and chord recognition good enough to score accuracy automatically.
- Onset detection for picking-hand timing.
- Move detection into an `AudioWorklet` once a drill needs sample-accurate
  timing; `src/audio/pitchDetection.ts` is the seam for that.
- Graceful degradation: everything from Milestone 3 keeps working when
  microphone access is denied.

## Milestone 5 — Adorable

- A practice companion character with mood and reactions.
- Streaks, gentle nudges, and progress visualisation that rewards consistency
  over intensity.
- Sound design, animation, haptics.

## Milestone 6 — Polish and reach

- Update prompts for new service worker versions instead of a silent reload.
- Background sync, install prompts, and share targets.
- Accessibility pass: keyboard-only practice, screen reader labels, reduced
  motion.
- Left-handed and alternate tunings.

## Deployment / GitHub Pages

The workflow cannot enable Pages for you, and it does not try.

1. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
2. Add the `VITE_FIREBASE_*` values as repository secrets.
3. Add the Pages domain to Firebase's authorised domains.

Until step 1 is done, every run shows two 404s even though the build itself
succeeds and uploads its artifact:

- `actions/configure-pages` — `HttpError: Not Found` on
  `GET /repos/OWNER/REPO/pages`. Allowed to fail via `continue-on-error`.
- `actions/deploy-pages` — `Failed to create deployment (status: 404) … Ensure
  GitHub Pages has been enabled`. Not suppressed, because after enablement a
  failure here is real.

Both come from the same cause: the Pages REST endpoints 404 while no Pages site
exists. `enablement: true` on `configure-pages` cannot fix it — that input needs
a PAT or GitHub App with Pages admin rights, which `GITHUB_TOKEN` is not.

## Constraints that shape the design

- **Static hosting only.** No server to maintain — GitHub Pages or Firebase
  Hosting, with Firebase as the only backend.
- **Offline is the default, not a fallback.** Anything that only works online
  belongs behind a capability check.
- **All data keyed by uid.** No device-local source of truth, so a second device
  is never a second account.

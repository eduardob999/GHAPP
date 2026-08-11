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

## Milestone 4 — Audio engine and pitch detection

- Microphone capture, autocorrelation or YIN pitch detection in an
  `AudioWorklet`.
- Note and chord recognition good enough to score accuracy automatically.
- Onset detection for picking-hand timing.
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

## Constraints that shape the design

- **Static hosting only.** No server to maintain — GitHub Pages or Firebase
  Hosting, with Firebase as the only backend.
- **Offline is the default, not a fallback.** Anything that only works online
  belongs behind a capability check.
- **All data keyed by uid.** No device-local source of truth, so a second device
  is never a second account.

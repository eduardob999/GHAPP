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

## Task 4: String Sniper drill + non-fatal Pages 404s

**Goal.** The first exercise the app actually grades by ear. Pick a target
string (and optionally a fret range), play, and get told whether the note you
produced belongs there. Free practice for now — results are shown and discarded,
with no Firestore writes and no effect on the spaced scheduler. Separately, make
the Pages workflow stop reporting failure for 404s that only mean "Pages is not
enabled yet".

**Key components.**

- **Drill logic** (`src/domain/stringSniper.ts`) — `evaluateHit` /
  `evaluateSniperFrame` grade a detected pitch against the target's MIDI band,
  returning `hit`, `wrong_string`, `off_pitch` or `no_signal`. Pure and
  deterministic. Reuses `frequencyToMidi` / `midiToFrequency` /
  `frequencyToNote` from the Task 2 note maths.
- **`src/hooks/useStringSniper.ts`** — runs its own `AudioEngine` rather than
  reusing `usePitchDetector`. The tuner's hook smooths over 5 samples and holds
  a reading for 600 ms, which is right for a steady tuner readout and wrong for
  grading individual pick attacks; keeping them separate also means this cannot
  regress the tuner. A 3-sample median still guards against the octave-up
  outlier a pick attack produces.
- **`src/components/StringSniperPanel.tsx`** — string picker, fret-range
  presets, colour-coded verdict, detected note, cents from target, clarity.
  Never autostarts; stopping releases the microphone.
- **`.github/workflows/deploy.yml`** — `continue-on-error: true` on both
  `configure-pages` and `deploy-pages`.

**The honest limit.** A microphone hears pitch, not geometry. A2 is the open 5th
string *and* the 5th fret of the 6th, so no pitch detector can tell which string
a pick struck. A "hit" therefore means the note is reachable on the target
string within the allowed frets. `overlappingStrings` computes which other
strings could have produced the same note, and the panel surfaces it — open low
E is unambiguous and shows nothing; open G reports that strings 4, 5 and 6 can
sound the same note.

**Two decisions worth recording.**

*Rounded-semitone boundaries.* The near-miss test first compared raw fractional
MIDI against integer bounds, which put a decision boundary exactly on a
floating-point value: `frequencyToMidi(midiToFrequency(42))` can land on
42.0000000001 and flip a verdict from `off_pitch` to `wrong_string`. A test at
exactly two semitones caught it. The comparison now rounds to the nearest
semitone first, which both removes the knife-edge and states the intent better —
the boundary sits halfway between two notes rather than on one.

*No emoji in verdicts.* The brief suggested "Hit! ✅" and similar. Colour already
carries the verdict, and a bare emoji renders as a tofu box wherever no colour
emoji font is installed — the same reason Task 2 draws the app mark as SVG
instead of setting 🎸. The verdicts are plain text on coloured panels.

**Pages trade-off, accepted deliberately.** `continue-on-error` on `deploy-pages`
also swallows genuine deployment failures, so while the guard is on a green run
does not prove the site published. Both steps carry comments saying where to
remove the guard once Pages is enabled and a deploy has succeeded.

**How it was tested.** The grader was bundled with esbuild and exercised under
Node across 107 assertions: every open-string frequency checked against its
published value; each of the six open strings hitting its own target; all thirty
cross-pairs of open strings correctly rejected; fret-range bands; configurable
tolerance; malformed input (null, zero, negative, NaN, Infinity, low clarity);
reversed and negative fret ranges normalised; purity and determinism; and a
semitone sweep pinning the whole verdict map as contiguous
`wrong | off | hit | off | wrong`.

The UI was then driven in headless Chrome with generated WAVs fed through
`--use-file-for-fake-audio-capture`, targeting string 6 open: an 82.41 Hz tone
gave "Hit! / E2 (82.4 Hz) / 0 cents", a 329.63 Hz tone gave "Wrong string / E4 /
+2400 cents", and a 77.78 Hz tone (a semitone flat) gave "Right string, off
pitch / D#2 / −100 cents". Stopping returned the panel to idle and logged the
microphone release in all three runs. Offline: with the preview server killed
and the page reloaded from the service worker cache, all three panels rendered
and the drill still graded an open low E correctly. The tuner and the drill were
also confirmed to run at the same time without interfering.

Not verified: a real guitar through a real microphone. Synthetic tones are
cleaner than a pickup, so expect lower clarity values in practice.

## Task 5: CAGED & chord-shape fretting trainer

**Goal.** Give the fretting hand its own trainer: real chord diagrams for CAGED
shapes, open chords, barres and power chords, practised in short timed reps and
graded by hand. Visual only — no chord audio grading yet. The Pages workflow was
left exactly as Task 4 set it.

**Key components.**

- **Enriched fretting metadata** (`src/domain/skills.ts`) — `FingerPosition`
  plus optional `fingers`, `mutedStrings`, `lowestFret` and `highestFret` on
  `FrettingMetadata`, filled in for 20 shapes across all four diagram families.
  Every field is optional, so existing entries, types and exported arrays are
  unchanged; `scale_pattern` skills carry no diagram and are excluded from the
  trainer rather than being drawn badly.
- **`src/domain/shapeTrainer.ts`** — pure selection and description helpers:
  `trainableShapes`, `toDiagram`, `nextShape`, `describeShape`, `shapeToTab`.
  No React, no Firestore; the esbuild bundle contains zero Firebase references.
- **`src/components/FretboardDiagram.tsx`** — inline SVG chord charts. Vertical
  neck, low E on the left, nut when the shape is open and an "Nfr" position
  label when it is not. Barre notes at the same fret collapse into one bar, and
  the root is marked — a filled accent dot normally, a ring when it sits under a
  barre and has no dot of its own. Muted and open markers are drawn as shapes
  rather than typed as ✕/○ glyphs, for the same font-independence reason Task 2
  and Task 4 avoided emoji.
- **`src/components/ShapeTrainerPanel.tsx`** — shape picker grouped by family,
  diagram, rep-length choice, countdown, grading, and "next shape".
- **Dashboard + PracticePanel hand-off** — Dashboard owns a `trainerSkillId`;
  `PracticePanel` gained one optional `onOpenInTrainer` prop and renders a link
  only on cards whose skill has a diagram.

**Design decisions worth recording.**

*One practice record, two doors.* The trainer calls the same
`upsertSkillPracticeState` as Today's Session. A timed rep is just another
spaced-practice observation, so ease, interval, `dueAt` and `lastResult` move
exactly as they do from a session card. No new collection, no rules change, no
second scheduler.

*Deadline-based countdown.* The timer computes its remaining seconds from a
wall-clock deadline rather than counting `setInterval` ticks. Background tabs
throttle timers, and a tick-counting rep would silently run long. The test
exercises this by accelerating `Date.now` in the page, which drives the real
auto-advance path rather than a shortcut.

**How it was tested.** The catalog was sounded out programmatically: for each of
the 20 shapes, the sounding pitch of every unmuted string was computed and
checked against the title — correct chord quality (major `[0,4,7]`, minor
`[0,3,7]`, power `[0,7]`), root in the bass, every fret inside the drawn window,
and a hand span of at most four frets. All 20 passed, and the derived tab
notation matches standard chord charts (`x-3-2-0-1-0` for open C,
`5-7-7-6-5-5` for the E-shape barre at the 5th).

The domain helpers were then bundled and exercised under Node: only fretting
shapes are trainable, all four diagram families are present, scale patterns and
picking skills are excluded, ordering is deterministic and easiest-first, every
diagram is well formed with no muted-and-fretted conflicts, and `nextShape`
prioritises overdue over new over scheduled while skipping the current shape.
The Task 3 planner was re-checked against the enriched catalog and is unchanged.

The UI was driven in headless Chrome with storage stubbed: diagram rendering per
family, barre and nut and position-label variants, the countdown decrementing
and auto-advancing on its deadline, grading writing the right skill and result
through the real scheduler and reporting when the shape returns, and the
Today's-Session hand-off selecting the requested shape. Offline: with the
preview server killed and the page reloaded from cache, the trainer rendered,
the diagram drew, and a timed rep ran.

Two rendering bugs were found by eye on a contact sheet of all 15 headline
shapes and fixed: a two-digit position label was clipped to "L0fr" at the 10th
fret, and labels collided with the dot on the leftmost string. Both came from
too little left padding.

**Not verified.** Live Firestore, for the same reason as Task 3 — the emulator
needs a JVM that is not installed here — so grading from the trainer has been
exercised against a stub of the storage layer, not the real one.

## Task 6: Production deployment path + phone instructions

**Goal.** Get the repo to "set Firebase, enable Pages, push main, open the URL on
your phone". No new features — just proving the production build actually works
when hosted at `https://eduardob999.github.io/GHAPP/`, and writing the steps
down.

**Changed.** `index.html`, `.github/workflows/deploy.yml`, `README.md`. Nothing
else — every learning feature, the audio layer, the scheduler, the storage
layer, `vite.config.ts` and the service worker are untouched.

**Base path: kept relative, and verified.** Tasks 1–5 used `base: './'` on the
theory that it resolves correctly under any sub-path, but that was never tested
anywhere but the origin root. This task built a small server that mimics a Pages
*project* site — repo served under `/GHAPP/`, 404 at the origin root, 301 on the
bare path — and drove Chrome against it. Everything holds: all assets 200 under
`/GHAPP/`, the manifest's relative `start_url`/`scope`/`id` resolve to
`/GHAPP/`, all four icons fetch, the service worker registers at
`/GHAPP/service-worker.js` with scope `/GHAPP/`, all 8 precache entries live
under the prefix, and the shell still boots from cache with the server dead.

**One real fix.** `index.html` referenced public assets as `./manifest.webmanifest`
and `./icons/...`. Vite only rewrites public-asset references written
root-absolute, so building with `VITE_BASE_PATH=/GHAPP/` produced a mix —
absolute JS and CSS, relative manifest and icons. Switching those three
references to `/manifest.webmanifest` and `/icons/...` makes Vite emit URLs that
match whichever base is set: `./…` with the relative default, `/GHAPP/…` with an
absolute base. Both modes are now internally consistent, and the
`VITE_BASE_PATH` override is genuinely usable rather than a footgun.

**Deliberate deviation.** The task suggested setting `base` to `/GHAPP/`. It is
left relative because (a) it is verified working at the sub-path, (b) an
absolute base would make `npm run preview` serve at `/GHAPP/` rather than the
root, which the same task asked to keep working, and (c) relative keeps the one
build working on Firebase Hosting and a user site too. The README documents the
one case that would justify switching — adding client-side routing with real
sub-paths — and the exact command.

**Workflow.** Guards untouched, as required. Added the live URL and the one-time
UI steps to the header comment, and a final `Show deployed URL` step that runs
with `if: always()` and prints whether the run actually published — the
counterweight to `continue-on-error` making a non-publishing run look green.

### Post-deploy fix: blank page when secrets are missing

The first real deployment came up as a blank white page. Cause was a bug in the
Task 1 config loader, not the deployment.

GitHub Actions substitutes an **empty string** for a secret that does not exist,
so `env.VITE_FIREBASE_API_KEY ?? 'YOUR_API_KEY'` produced `''` in CI — `??`
falls back only on null/undefined. Firebase rejects a blank key with
`auth/invalid-api-key`, thrown from `getAuth()` at module scope in
`src/firebase.ts`, i.e. while the module graph is still being imported. React
never mounted, so the `isFirebaseConfigured` guard in `App.tsx` never ran and
the setup card could not appear. `isFirebaseConfigured` was also wrong in the
same scenario: `''.startsWith('YOUR_')` is false, so a blank key read as
"configured".

Local testing missed it because the variables are *absent* locally, where `??`
behaves as intended — only CI produces the empty-string case.

Fixed in three places:
- `firebaseConfig.example.ts` — an `envOr` helper treats blank as absent.
- `isFirebaseConfigured` — also requires a non-blank key.
- `firebase.ts` — when unconfigured, hands the SDK a syntactically valid
  placeholder so importing the module cannot throw, and the app survives to
  explain itself.

Verified both ways on a clean browser profile: built with empty env vars the app
shows "Finish the Firebase setup" with no exceptions; built with populated ones
it reaches the sign-in screen with no exceptions.

## Task 7: Chord Hero — progression gameplay with chord recognition

**Goal.** Move from single-note detection to polyphonic chord recognition, and
put a rhythm-game loop on top: a progression plays out in time, each chord is
scored by ear, strummed or arpeggiated. Robustness over vocabulary — a detector
that feels random is worse than one with fewer chords.

**Key components.**

- **`src/audio/chordDetection.ts`** — the whole recogniser, pure and
  dependency-free: Hann window, a hand-written radix-2 FFT, a median-based noise
  floor, soft thresholding with peak picking, parabolic interpolation for
  sub-bin frequency accuracy, a 12-bin pitch-class profile, and cosine
  similarity against 10 templates across 12 roots.
- **`src/hooks/useChordDetector.ts`** — audio binding. Runs the engine in
  raw-frame mode with a 16384-sample window (~370 ms), analysing every 180 ms
  and requiring two consecutive agreeing frames before publishing.
- **`src/domain/progressions.ts`** — progression model, four seed progressions,
  and pure stepping/scoring including the `partial` grade for a right root with
  the wrong quality.
- **`src/components/ChordHeroPanel.tsx`** — the game.
- **`src/audio/audioEngine.ts`** — extended, not rewritten, with two optional
  fields: `detectPitch: false` and `onFrame`. Chord detection wants raw windows
  and no pitch tracking; running McLeod on a 16384-sample frame would be pure
  waste. Defaults keep the tuner and String Sniper behaviour identical.

**Design decisions worth recording.**

*Peaks only, and gate on noise.* Summing every FFT bin into the chroma smears
harmonics into something that matches every template about equally; only
spectral peaks contribute. And the accept/reject decision uses
`clarity = similarity × (1 − noiseLevel)` rather than similarity alone, because
template matching alone is happy to label pure noise.

*Grade the window, not the instant.* A strum rings, decays and gets damped, and
an arpeggio only spells its chord once the last note lands. Each chord is graded
on the best moment inside its scoring window, which is also what makes arpeggios
work with no separate code path — multi-frame aggregation is the same mechanism.

**Two bugs the end-to-end test caught.** Observations were originally collected
in an effect keyed on the detected chord changing — but a chord held steady never
changes, so a whole segment recorded one observation and later chords none; the
summary read "1 of 1 chords hit" instead of "1 of 4". Sampling now runs off the
clock. Separately, the live read-out was coloured green whenever *any* chord was
recognised, so a confidently wrong chord looked like approval; it is now coloured
by whether it matches the target.

**How it was tested.** The recogniser was bundled and exercised under Node
against synthetic harmonic-rich voicings: 12/12 clean open-position chords
correct including maj/min, 7ths and a power chord; 6/6 on chords sharing two
notes (G/Em, C/Am, F/Dm) which are the classic confusions; 4/4 barre voicings up
the neck; inversions correctly resolved to the root. Noise sweeps show correct
detection to a noise amplitude of ~0.15 and `null` beyond, never a wrong label;
pure noise returned `null` on every trial, as did silence and single notes.
40/40 correct under moderate noise across four chords.

The progression layer has 32 assertions covering catalog integrity, timing at
different tempos, stepping in order with exact segment boundaries, per-detection
and per-window scoring, and late-resolving arpeggio windows.

The panel was then driven in headless Chrome with a synthetic strummed open G
fed in as the microphone: the HUD, beat bar, diagram and live recognition all
worked, and the run scored "1 of 4 chords hit" with G a hit and D, Em and C
misses — exactly right for a G ringing throughout. The tuner was re-tested after
the `audioEngine` change and still reports A2 at 110.0 Hz with a clean teardown.

**Not verified.** A real guitar through a real microphone. Synthetic tones are
cleaner and more stationary than a pickup in a room, so expect lower clarity and
more `null` frames in practice; `minClarity` in `DEFAULT_CHORD_CONFIG` is the
single knob to loosen if it proves shy.

# Working in this repo

Guitar Practice Companion is an offline-first PWA for short daily guitar
practice: fretting-hand shapes, picking-hand accuracy, and theory, scheduled by
an FSRS model over a catalog of micro-skills. It has Google sign-in, Firestore
sync, a tuner, live chord and pitch detection through an AudioWorklet, and
several drills. One person uses it, and the repo is public.

It is also the parent of [kanji-app](https://github.com/eduardob999/kanji-app),
which lifted the shell, the offline-first Firestore layer and the scheduler from
here. The two share a Firebase project, so a rules change here is a rules change
there. See below.

## Read before you act

| Before you | Read |
|---|---|
| pick up work | [docs/NEXT.md](docs/NEXT.md), the durable queue: the top unticked item is the next thing |
| edit `firestore.rules`, or publish rules | "The rules are shared with kanji-app" below |
| touch anything under `src/audio/` | "The worklet is bundled separately" below |
| add a file to `public/` and expect it offline | "The precache list is hand-maintained" below |
| deploy | run `npm run ship`, not a bare push. "A green run does not mean it published" below |
| change a scheduler constant or a stored field | "What must not change" below |

## Commands, and what each already covers

```bash
npm run dev        # generates src/firebaseConfig.ts first; serves the worklet on demand
npm run typecheck  # tsc --noEmit under strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes
npm test           # vitest run: the scheduler and the FSRS model, 41 tests
npm run build      # typecheck, then vite build, the worklet bundle, and the SW manifest
npm run ship       # build, push, watch the deploy, then fetch the live page and prove it
npm run icons      # regenerate public/icons from the source art
```

**The scheduler has tests; nothing else does.** `npm test` runs vitest over
`src/domain/*.test.ts`. As of 2026-09-02 that is 41 tests across `fsrs.ts` and
`scheduler.ts`, which is where a silent change does the most damage: they decide
when every skill comes back.

Everything else is still uncovered, and that includes all of the audio path,
`autoSession.ts`, `sessionPlanner.ts` and the grading modules. kanji-app has a
test file beside every module in `src/domain/` and 296 tests. **Do not assume a
grading or detection change is covered by anything.** If you change domain logic
outside the scheduler, say plainly in the report that it was verified by hand or
not at all.

`npm run build` is fast (about 400 ms after install). It warns that the bundle
is over 500 kB; that is Firebase, and it is known rather than new.

## The rules are shared with kanji-app

`firestore.rules` here and in kanji-app have identical rule bodies, and both
apps point at the same Firebase project. So:

- **Publishing with `firebase deploy --only firestore:rules` from either repo
  overwrites what the other app relies on.** A rules edit is a security change
  for two apps.
- **An edit here that is not mirrored in kanji-app starts a silent drift.**
  Change both in the same piece of work, or neither.

Run `/security-review` before publishing. The current rule is "you may touch
your own document and nothing else", and the `{document=**}` wildcard already
covers `/users/{uid}/skills` and `/users/{uid}/sessions`, so a new subcollection
needs no rules change.

Firebase web config is not a secret and ships in every client bundle by design.
The rules are what protect the data.

## The worklet is bundled separately

`audioWorklet.addModule` loads a URL into a scope with no module resolution, so
the worklet cannot import from the app graph. `vite.config.ts` bundles
[src/audio/worklet/dspWorklet.ts](src/audio/worklet/dspWorklet.ts) with esbuild
into `audio-dsp-worklet.js`, served on demand in dev and emitted as an asset in
the build. This keeps `dspCore.ts` the one source of truth for both the worklet
and the main-thread fallback, which is worth protecting: a second hand-kept copy
of the DSP is exactly the bug that is impossible to notice.

Two failure modes here are quiet rather than loud. An import the worklet cannot
resolve makes the DSP fall back to main-thread analysis with no error the user
sees. And `audio-dsp-worklet.js` must stay in `SHELL_ASSETS`, or the worklet is
simply unavailable with no network, again silently.

## The precache list is hand-maintained

`SHELL_ASSETS` in `vite.config.ts` is a literal list. Unlike kanji-app, which
reads its data directories at build time, nothing here discovers new files in
`public/`. Add an asset the app cannot boot without and you must add it to that
list yourself, or the app works online and fails on a train.

## A green run does not mean it published

[.github/workflows/deploy.yml](.github/workflows/deploy.yml) carries
`continue-on-error: true` on both `configure-pages` and `deploy-pages`. That
keeps CI quiet, and it also swallows genuine deploy failures.
[scripts/ship.mjs](scripts/ship.mjs) exists for exactly this: it does not trust
the run, it fetches the published page afterwards and checks the bundle it names
actually loads. Use `npm run ship`. `--dry-run` says what it would do.

## Layout, where it is not obvious

- `src/domain/` is pure: no React, no Firebase, `now` passed in as a parameter.
- `src/domain/skills.ts` holds `SKILL_CATALOG`, the micro-skill definitions, plus
  `SKILL_BY_ID` and `groupingKey`, which is what stops one session becoming ten
  barre chords. **It currently has 56 definitions, all `active: true`. The README
  still says 41.** Trust the file, and fix the README when you are next in it.
- `src/domain/progressions.ts` and `songs.ts` are content data, not logic.
- `src/storage/` is the only layer that knows the Firestore collection layout.
  Components and hooks go through it rather than importing `db`.
- `docs/NEXT.md` is the working queue and is kept current. `docs/ROADMAP.md` is
  the vision and is older.
- `src/firebaseConfig.ts` is generated from the example on first run and is
  gitignored.

## What must not change without asking

- **`MAX_INTERVAL_DAYS = 90` in [src/domain/fsrs.ts](src/domain/fsrs.ts).** The
  forgetting curve was fitted to recall of facts; a motor skill decays
  differently and nobody practises a chord once a year. kanji-app deliberately
  raised its own cap to 365 for the opposite reason. Do not resync them.
- **`ease` keeps being written to every skill document**, derived from FSRS
  difficulty, so documents written before FSRS existed keep working and anything
  displaying it keeps reading it. `scheduler.ts` is a thin adapter that exists to
  preserve that. Removing the field breaks stored state.
- **String numbering: 6 is the low E, 1 is the high E**, throughout the domain
  and the diagrams.
- **Reward chimes are pitched above the 1800 Hz analysis band** so the app cannot
  score its own sounds. Chord detection looks between 70 Hz and 1800 Hz.
- **Timing only ever demotes, never promotes.** A missing onset does not demote
  either. Attack detection is the least reliable link in the chain and a
  fingerpicked chord may have no sharp attack at all.
- **The session log at `/users/{uid}/sessions` is append-only.** Skill state is a
  summary the scheduler overwrites every rep; the log is the raw history any
  future scheduler has to be judged against. Do not fold one into the other.

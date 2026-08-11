# Guitar Practice Companion

An offline-first PWA for guitar practice — fretting-hand shapes, picking-hand
accuracy, and theory, in short distributed sessions.

Live at **<https://eduardob999.github.io/GHAPP/>** once Pages is enabled — see
below.

What works today: Google sign-in, Firestore synced across devices and offline, a
spaced-practice scheduler over 41 micro-skills, a tuner, the String Sniper
picking drill, and a fretting-shape trainer with chord diagrams. See
[docs/ROADMAP.md](docs/ROADMAP.md) for what is next.

## 🚀 Deploy it and use it on your phone

Three one-time steps, then it is a link you open.

### 1. Configure Firebase

In the [Firebase console](https://console.firebase.google.com):

- Create a project, then add a **Web app** to it.
- **Authentication → Sign-in method →** enable **Google**.
- **Authentication → Settings → Authorized domains →** add `eduardob999.github.io`.
  Sign-in fails with `auth/unauthorized-domain` without this.
- **Firestore Database →** create a database (native mode).
- **Firestore Database → Rules →** paste [`firestore.rules`](firestore.rules)
  and publish. The console defaults either lock you out or leave your data
  world-readable.

Then put the config values somewhere the build can read them. For deployment
that means repository secrets:

- **Settings → Secrets and variables → Actions**, add `VITE_FIREBASE_API_KEY`,
  `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`,
  `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID` and
  `VITE_FIREBASE_APP_ID` — the names in [`.env.example`](.env.example).

For local work, copy `.env.example` to `.env.local` and fill it in, or edit the
literals in `src/firebaseConfig.ts` (created automatically from
[`src/firebaseConfig.example.ts`](src/firebaseConfig.example.ts) on first run,
and gitignored).

> These values are **not secrets** — Firebase web config ships in every client
> bundle by design. `firestore.rules` is what protects your data.

### 2. Enable GitHub Pages

- Open <https://github.com/eduardob999/GHAPP/settings/pages>.
- Under **Build and deployment**, set **Source** to **GitHub Actions**.
- Save.

No workflow can do this for you — `GITHUB_TOKEN` cannot administer Pages.

### 3. Push to `main`

GitHub Actions builds, uploads the artifact and deploys. The run ends with a
**Show deployed URL** step that prints whether it actually published.

### Then, on your phone

1. Open **<https://eduardob999.github.io/GHAPP/>**.
2. Sign in with Google.
3. Install it:
   - **iOS Safari** — Share → *Add to Home Screen*.
   - **Android Chrome** — ⋮ menu → *Install app* / *Add to Home screen*.
4. Launch it from the home screen. It opens standalone, works offline after the
   first load, and your practice state follows your Google account onto any
   other device.

Microphone features (tuner, String Sniper) need HTTPS — GitHub Pages provides
it, so they work as-is.

## Quick start (local)

```bash
npm install
```

```bash
npm run dev
```

The dev server prints a URL (default <http://localhost:5173>). Until Firebase is
configured, the app shows a setup card instead of the sign-in screen — that is
expected.

### Production preview

Simulates the real build locally, without Pages. This is the only way to
exercise the service worker, since it is not registered in dev.

```bash
npm run build && npm run preview
```

Preview serves at <http://localhost:4173/> — the app uses a relative base, so it
runs correctly both there and under the `/GHAPP/` sub-path on Pages.

## Firebase setup

Covered in [step 1 above](#1-configure-firebase). Two extra notes for local
work:

- Add `localhost` to **Authentication → Settings → Authorized domains** (it is
  usually there already) so sign-in works from the dev server.
- Restart the dev server after editing `.env.local` — Vite reads it at startup.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with hot reload. The service worker is *not* registered here. |
| `npm run build` | Typecheck, then build to `dist/`. Injects the precache manifest into the service worker. |
| `npm run preview` | Serve `dist/` locally — the only way to exercise the PWA behaviour. |
| `npm run typecheck` | TypeScript only. |
| `npm run icons` | Regenerate the placeholder icons in `public/icons`. |

## Verifying offline behaviour

The service worker only runs in production builds:

```bash
npm run build && npm run preview
```

Then, in the preview tab:

- **App shell** — load once, stop the preview server, reload. The app still
  boots from the service worker cache.
- **Firestore reads** — sign in, then go offline (DevTools → Network → Offline).
  The profile card still renders, and the badge reads "Offline — from cache".
- **Firestore writes** — while offline, press **Write a test ping** a few times.
  The counter moves immediately and the badge turns amber ("Saved locally,
  syncing…"). Go back online and it settles to "Synced" without a reload.
- **Install** — DevTools → Application → Manifest → Install, or the browser's
  install affordance.

Note that DevTools' offline toggle does not always apply to the service worker's
own network calls. Stopping the server is the honest test.

`npm run preview` serves at the origin root, which does *not* exercise the
`/GHAPP/` sub-path. To check that layout locally, serve `dist/` under a prefix
with any static server and open `http://localhost:PORT/GHAPP/`.

## Project layout

```
index.html                    App shell markup
vite.config.ts                Build config + the service worker precache plugin
firestore.rules               Security rules — publish these
public/
  manifest.webmanifest        PWA manifest
  service-worker.js           App-shell caching
  icons/                      Generated placeholder icons
src/
  main.tsx                    Entry point; mounts React, registers the worker
  App.tsx                     Auth-state routing: setup / splash / sign-in / dashboard
  firebase.ts                 SDK init, auth + Firestore instances, persistence
  firebaseConfig.example.ts   Template for the gitignored firebaseConfig.ts
  auth.ts                     Google sign-in, sign-out, error messages
  types.ts                    UserProfile and snapshot shapes
  storage/userState.ts        The only module that knows /users/{uid}
  storage/skillsState.ts      …and /users/{uid}/skills
  domain/skills.ts            Micro-skill catalog + chord-diagram metadata
  domain/scheduler.ts         SM-2-inspired spacing, pure
  domain/sessionPlanner.ts    Today's Session selection and interleaving
  domain/shapeTrainer.ts      Fretting-shape selection helpers, pure
  domain/stringSniper.ts      Picking-drill grading, pure
  audio/notes.ts              Frequency ↔ note maths, cents, in-tune tolerance
  audio/pitchDetection.ts     The only module that imports `pitchy`
  audio/audioEngine.ts        Microphone capture and the analysis loop
  hooks/                      useAuthUser, useUserProfile, useOnlineStatus,
                              useSkillStates, usePitchDetector, useStringSniper
  components/                 SignInScreen, Dashboard, PracticePanel,
                              ShapeTrainerPanel, FretboardDiagram, TunerPanel,
                              StringSniperPanel, SyncBadge…
docs/                         Roadmap and task log
```

Three rules worth keeping:

- **Components never import `db` directly.** All Firestore access goes through
  `src/storage/`, so a new collection lands in one file.
- **Nothing outside `src/audio/` imports `pitchy`.** Swapping the detector, or
  moving it into an AudioWorklet, stays a one-file change.
- **`src/domain/` is pure.** No React, no Firestore at runtime — which is what
  makes the scheduler, planner and graders testable on their own.

## The tuner

Open the Dashboard and press **Start tuner**. The browser asks for microphone
access on first use; audio is analysed on-device and never leaves it.

Some notes on how it works, since the settings are not obvious:

- **Browser voice processing is switched off** (`echoCancellation`,
  `noiseSuppression`, `autoGainControl`). Those are tuned for speech — AGC pumps
  the level of a decaying string and noise suppression gates a sustained note as
  stationary noise. Leaving them on visibly wrecks detection.
- **Detection runs on the main thread**, an `AnalyserNode` read inside
  `requestAnimationFrame` throttled to ~25 Hz. That is far cheaper than it
  sounds, needs no separate worklet module to precache, and rAF stops on its own
  when the tab is hidden. `src/audio/pitchDetection.ts` is the seam if this ever
  needs to become an AudioWorklet.
- **Readings are median-filtered** over 5 samples. A pick attack regularly
  produces one octave-up outlier; a median drops it, where a mean would fold it
  in.
- **Requires a secure context.** `localhost` and `https` are fine. Serving the
  dev server on a LAN IP over plain http means no microphone at all — the tuner
  reports that specific case rather than a generic failure.

The tuner is read-only for now: it writes nothing to Firestore and touches no
scheduler state.

## String Sniper

A picking-accuracy drill. Choose a target string and fret range, press **Start
drill**, and pick without looking — the panel says whether the note you produced
belongs on that target.

**What it can and cannot tell you.** A microphone hears pitch, not geometry. A2
is the open 5th string *and* the 5th fret of the 6th string, so no pitch
detector can know which string your pick struck. A "hit" means *the note is
reachable on the target string within the allowed frets*:

- **Open string only** — a tight test. The target is a single pitch, and every
  other open string is far enough away to be rejected.
- **A fret range** — any note in the range counts.
- **Any fret** — deliberately loose, and the panel warns when other strings
  could produce the same note.

Verdicts are `Hit`, `Right string, off pitch` (within two semitones of the
range — usually a fretting slip), and `Wrong string` (further out than that).

Like the tuner, it runs its own audio engine, needs no network, and writes
nothing — results are shown and discarded. Wiring drill performance into the
spaced scheduler is a later milestone.

## Data model

```
/users/{uid}
  uid, displayName, email, photoURL
  createdAt      server timestamp, written once
  lastLoginAt    server timestamp, refreshed on each sign-in
  practicePings  demo counter, proves offline writes queue and sync
```

Everything is keyed by the Firebase `uid`, so signing into the same Google
account on another device restores the same state.

### Awaiting writes

While offline, Firestore applies a write to the local cache immediately but does
not settle the returned promise until the server acknowledges it. `await
setDoc(...)` therefore hangs, without an error, until the network returns. Treat
those promises as *"the server confirmed it"*, never as *"the write happened"*,
and let `onSnapshot` drive the UI.

## Deployment reference

The step-by-step is [above](#-deploy-it-and-use-it-on-your-phone). This section
is the detail behind it.

`.github/workflows/deploy.yml` builds and publishes on every push to `main`.

**Base path.** `vite.config.ts` uses a relative `base` (`./`), so the same build
runs from the `/GHAPP/` project sub-path, from a user site at the origin root,
from Firebase Hosting, and from `npm run preview` — with no rebuild. `index.html`
references public assets root-absolute (`/manifest.webmanifest`), which Vite
rewrites to match whatever base is configured, and the manifest's `start_url`,
`scope` and `id` are relative so they resolve against the manifest's own URL.
The service worker registers relative to `import.meta.env.BASE_URL`, taking the
`/GHAPP/` scope automatically.

If you ever add client-side routing with real sub-paths, switch to an absolute
base — relative URLs would resolve against the current route instead of the app
root:

```bash
VITE_BASE_PATH=/GHAPP/ npm run build
```

**Green runs before Pages exists.** `configure-pages` and `deploy-pages` both
carry `continue-on-error: true`, so their 404s are logged without failing the
run. A green run therefore does *not* prove the site published — check the
**Show deployed URL** step, which says so explicitly. Once Pages is enabled and
a deploy has succeeded, remove `continue-on-error` from `deploy-pages` so real
failures go red again; the step is commented to say so.

`enablement: true` on `configure-pages` cannot replace the manual step — that
input requires a PAT with `repo` scope or a GitHub App with
`administration:write`, not `GITHUB_TOKEN`.

### Redirect sign-in and third-party cookies

Sign-in uses a popup, falling back to a full-page redirect where popups are
blocked. The redirect path depends on storage for your `authDomain`
(`*.firebaseapp.com`), which some browsers restrict when the app is served from
a different origin such as `github.io`. If you hit this, either stay on the
popup path or point `authDomain` at a custom domain you also serve the app from.

## Icons

`public/icons/*` are generated placeholders — a stylised fretboard, drawn by
`scripts/generate-icons.mjs` so no binaries live in git. Replace them with real
artwork at the same filenames and sizes (192, 512, maskable 512, and a 180
apple-touch-icon), or edit the drawing and run `npm run icons`.

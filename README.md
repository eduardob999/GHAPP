# Guitar Practice Companion

An offline-first PWA for guitar practice — fretting-hand shapes, picking-hand
accuracy, and theory, in short distributed sessions.

Current state: the **foundation** (PWA shell, Google sign-in, Firestore with
offline persistence) plus a working **tuner** — Web Audio capture and pitch
detection. No drills or scheduling yet. See [docs/ROADMAP.md](docs/ROADMAP.md).

## Quick start

```bash
npm install
```

```bash
npm run dev
```

The dev server prints a URL (default <http://localhost:5173>). Until Firebase is
configured, the app shows a setup card instead of the sign-in screen — that is
expected.

## Firebase setup

Everything below happens once, in the [Firebase console](https://console.firebase.google.com).

1. **Create a project**, then add a **Web app** to it.
2. **Authentication → Sign-in method →** enable **Google**. That is the only
   provider this app uses.
3. **Authentication → Settings → Authorized domains →** add `localhost` (usually
   present already) and your GitHub Pages host, e.g. `yourname.github.io`.
   Sign-in fails with `auth/unauthorized-domain` if you skip this.
4. **Firestore Database →** create a database.
5. **Firestore Database → Rules →** paste the contents of
   [`firestore.rules`](firestore.rules) and publish. The defaults from the
   console either lock you out entirely or leave your data world-readable.
6. Copy your config values into `.env.local`:

```bash
cp .env.example .env.local
```

Fill in the `VITE_FIREBASE_*` values from **Project settings → General → Your
apps → SDK setup and configuration**, then restart the dev server.

Alternatively, edit the literals directly in `src/firebaseConfig.ts` (created
automatically from `src/firebaseConfig.example.ts` on first run, and gitignored).

> Firebase web config is **not secret** — it ships in every client bundle by
> design. What protects your data is `firestore.rules`, which scopes every
> document to the signed-in user's uid.

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
  storage/userState.ts        The only module that knows the Firestore layout
  audio/notes.ts              Frequency ↔ note maths, cents, in-tune tolerance
  audio/pitchDetection.ts     The only module that imports `pitchy`
  audio/audioEngine.ts        Microphone capture and the analysis loop
  hooks/                      useAuthUser, useUserProfile, useOnlineStatus,
                              usePitchDetector
  components/                 SignInScreen, Dashboard, TunerPanel, SyncBadge…
docs/                         Roadmap and task log
```

Two rules worth keeping:

- **Components never import `db` directly.** All Firestore access goes through
  `src/storage/`, so the upcoming `/users/{uid}/skills` and
  `/users/{uid}/sessions` collections land in one file.
- **Nothing outside `src/audio/` imports `pitchy`.** Swapping the detector, or
  moving it into an AudioWorklet, stays a one-file change.

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

## Deploying to GitHub Pages

`.github/workflows/deploy.yml` builds and publishes on every push to `main`.

The workflow is configured to **stay green even before Pages is enabled** —
`configure-pages` and `deploy-pages` both carry `continue-on-error: true`, so
their 404s are logged without failing the run. Getting a *live site* still needs
step 1 below, and no workflow change can substitute for it: the `enablement: true`
input on `configure-pages` requires a token other than `GITHUB_TOKEN` (a PAT with
`repo` scope, or a GitHub App with `administration:write`).

While those guards are on, a green run does not prove the site published. Once
Pages is enabled and a deploy has succeeded, remove `continue-on-error` from
`deploy-pages` so real failures go red again — the step is commented to say so.

1. **Settings → Pages → Source → GitHub Actions**.
2. **Settings → Secrets and variables → Actions**: add the `VITE_FIREBASE_*`
   values as repository secrets, matching the names in `.env.example`.
3. Add your Pages domain to Firebase's authorised domains (step 3 above).

The build uses a relative `base`, so it works from a project sub-path
(`/GHAPP/`) or a user site without changes.

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

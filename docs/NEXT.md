# Working plan

A durable queue, so work survives context compaction. The top unticked item is
always the next thing to do.

## Done

- [x] **1. Timing feeds the grade.** `applyTiming` demotes a well-played but
      badly-timed step from Hit to Close, behind a "notes + timing" toggle.
      One-way: timing never promotes a wrong chord, and a missing onset never
      demotes — attack detection is the least reliable link, and a fingerpicked
      chord may have no sharp attack at all.
- [x] **2. Session log.** `src/storage/sessionLog.ts` writes append-only records
      to `/users/{uid}/sessions`. Separate from skill state on purpose: skill
      state is a summary the scheduler overwrites every rep, this is the raw
      history a future scheduler can be evaluated against. Covered by the
      existing rules via `{document=**}` — no rules change.
- [x] **3. Riff order.** Longest-common-subsequence over pitch classes, with
      consecutive repeats collapsed (a ringing note is not a repeated note).
      A reversed riff now scores 0.25 order against 1.00 in order, so playing
      the right notes in the wrong sequence is no longer full marks.

- [x] **4. Practice modes.** Tempo ramp (speeds up only on an 80%+ pass, capped
      at 1.3x written tempo) and a "practise the tricky bits" replay built from
      the previous run's failed steps, at 75% tempo.
      loop a single step until it is clean, and a "practice the misses" replay
      built from the previous run's failed steps.
- [x] **5. Session history UI.** Recent runs with an accuracy bar on the Chord
      Hero setup screen, read from the append-only log.
      of accuracy over time per progression would make progress visible.
- [x] **6. More content.** Drop-D and half-step-down tunings, seventh-chord
      progressions through all twelve keys, picking-hand riffs for the
      string-set skills. A tuned step stores the chord that *sounds* — an E
      shape in half-step-down tuning is what the detector hears as E♭ — with
      the shape to grab carried alongside it in `shapeLabel`. 65 progressions,
      296 steps.
- [x] **7. Adorable.** Companion character with eight moods, streak rewards
      counted from the session log, and reward chimes pitched above the 1800 Hz
      analysis band so they cannot be scored. Mood precedence is the design:
      a milestone outranks everything, and what just happened outranks the
      ambient state.

- [x] **8. No microphone, no dead ends.** Milestone 4 asks that everything from
      Milestone 3 keeps working when microphone access is denied. Today a denied
      permission leaves the audio panels showing an error and nothing else.
      Chord Hero should fall back to a self-graded run — the same steps, the
      same clock, manual "got it / missed it" — and every mic panel should say
      what to do about it rather than just what went wrong.
      Done: `src/domain/micGuidance.ts` + `MicNotice`, and a self-graded run
      that files through the same scheduler and log (`graded: 'self'`). Found a
      real bug doing it — the run used to start regardless of whether the
      microphone opened, so a denied permission was filed as a `fail`.
- [x] **9. Session flow.** Milestone 3's last unbuilt piece: warm-up, rotation,
      cool-down, and an end-of-session summary that files one record to
      `/users/{uid}/sessions` (`kind: 'today'`) rather than only per-skill
      grades. Today's Session is a flat list with no shape to it.
      Done: `planStructuredSession` picks the bookends by comfort, the
      cool-down first. Found another cold-cache bug on the way — `onSnapshot`
      never delivers a first snapshot when the cache is empty and no server is
      reachable, so both subscriptions now read the cache explicitly first.

## Next

- [x] **23. Fit a real phone, not a headless one.** The session card is sized
      with `calc(100dvh - 246px)`, a number tuned against headless Chrome with
      no browser chrome. On a real phone the address bar eats the difference and
      the stage clips its own diagram. Make the layout flexible — the screen a
      flex column, the stage taking what is left, the diagram scaling down
      instead of being cut off — and verify at a viewport short enough to prove
      it. Done: the screen is a flex column, and the diagram is sized in `cqh`
      against a size container — a percentage max-height cannot resolve against
      a `minmax(0, 1fr)` track, which is precisely why it overflowed on a phone
      and looked fine headless.
- [x] **24. Show the chords before the count-in.** Chord Hero counts you in with
      nothing but a number: you cannot see the first chord, let alone the
      sequence. Show the whole sequence on the count-in, with the opening chord
      marked, so the hands are ready before the bar starts.
- [x] **25. Strumming patterns.** Songs carry chords and no rhythm, which is
      half the song missing. Add a pattern per song and show it while playing.
- [x] **26. Riffs in string and fret, and a sniper that plays them.** Riff steps
      read "A2 C3 D3 E3", which is note names with octaves — unreadable unless
      you already know the fretboard. Show string and fret instead. And String
      Sniper should drill *riffs* rather than single notes: same scoring, real
      music. Done: `src/domain/riffDrill.ts` plus a rebuilt panel — nine riffs,
      each note ticked off as it is heard, no clock.

- [x] **22. No timer — the playing drives it.** The auto session advances on a
      countdown: every activity carries `seconds`, and it moves on when the
      clock runs out whether or not a note was played. That makes the timer the
      real scheduler and FSRS a bystander. An activity should end when there is
      *evidence* — enough clean frames to call it, or enough heard frames to
      judge it — and silence should advance nothing at all: put the guitar down
      and it waits. Also: the whole session must fit on one screen, with no
      scrolling and no countdown taking up room.
      Done: `src/domain/activityProgress.ts` ends an activity on evidence —
      ten clean frames, or forty heard ones — and silence counts toward
      nothing. The session card is sized to the viewport.

Set as top priority on 2026-08-15. The app is a set of separate tools that
happen to share a shell; it should be one game that listens, scores everything,
and decides for you.

- [x] **16. FSRS, adapting.** Replace the SM-2-ish ease/interval with FSRS —
      difficulty, stability and retrievability per skill, with the parameters
      adapting to this player's own review history rather than staying at the
      published defaults. Pure `src/domain/fsrs.ts`, and `scheduleNext` becomes
      a thin adapter so nothing else has to change at once.
- [x] **17. Everything is scored by ear.** No mode is self-graded any more. The
      fretting trainer must *hear* the chord it asked for; the string sniper
      already hears and must file what it hears; Today's Session stops asking
      "how did that feel". Manual grading survives only as the microphone-denied
      fallback.
      Done: the trainer hears its chord, the sniper scores sets of eight and
      files them, and Today's Session routes every card the microphone can
      judge — 10 of 10 on a fresh account — into the mode that listens.
- [x] **18. Teach before test.** A chord may not appear in Chord Hero, a song or
      the auto session until its shape has been taught in the fretting trainer
      and heard cleanly at least once. Needs a chord → shape map and a gate over
      the content the director may pick from.
      Done: `src/domain/curriculum.ts`, plus thirteen new teaching shapes — the
      catalog taught 14 chords and the library used 63, so gating without them
      would have locked most of the app. All 12 beginner progressions are now
      teachable end to end.
- [x] **19. Chord Hero, no setup.** Slowest tempo is the default, everything
      else is remembered or decided. Picking a progression should be one tap
      from a short list, not four segmented controls.
      Done: five ranked suggestions (due first, then unplayed and easy), one tap
      to play, everything else behind "Browse everything". Tempo now defaults to
      half the written speed with the ramp on, so slow is where you start rather
      than where you stay.
- [x] **20. Songs.** Easy pop songs as playable progressions — chord charts
      only, no lyrics or melodies — scored like everything else, with a Songs
      section that says which ones you can already play.
      Done: fifteen songs, chords only, gated by the same curriculum. A locked
      song names the chord in the way and links to the lesson. Found two more
      content gaps: open A major and open D minor were missing entirely, so the
      app would have taught them as barres.
- [x] **21. One game, not five tools.** A single scored flow: every activity
      hands to the next inside the auto session with no navigation, one running
      score, and the companion reacting to what just happened. The separate
      panels stay as practice rooms but stop being the main way in.
      Done: the auto session plays and *scores* every activity inline on one
      microphone, with a running point total and a per-activity verdict at the
      end.

Drawn from what `docs/ROADMAP.md` still lists as missing, plus the UI direction
set on 2026-08-15: the app is six panels stacked on one scrolling page, and it
should be a tree of menus with one automatic mode at the root.

- [x] **10. A tree, not a stack.** Six panels on one page is a debug harness,
      not an app. A navigation tree with a back stack: Practise / Train /
      Progress / Tools, each panel a leaf. No router dependency — a pure
      `src/domain/navigation.ts` describing the tree, a shell component walking
      it, and the location mirrored into `location.hash` so a reload and the
      installed PWA both come back where you were.
- [x] **11. Auto session — the main mode.** What the app opens on: it starts
      coaching immediately, with no configuration at all. A pure director
      (`src/domain/autoSession.ts`) builds a script of activities from skill
      state, the streak and the time of day, then advances through them on its
      own — tune-up, warm-up shape, progression, riff, accuracy drill — in one
      continuous flow with a shared progress rail, never navigation. Progressive:
      tempo and difficulty follow the last few results, and harder material
      unlocks only when accuracy holds. The existing panels stay reachable from
      the tree for when you want to pick something specific.
      Decisions taken with the user: land straight in the auto session; one
      continuous coached flow rather than handing off to each panel.
      Done: `src/domain/autoSession.ts` is the director (pure),
      `AutoSessionPanel` the surface. `HOME_NODE_ID` is now `practise.auto`.
- [x] **12. Design system.** Partly done, differently than planned. The user's
      design came back as a *regular* Claude Design project, not a design-system
      one — `DesignSync.list_projects` only lists design-system projects, so it
      was invisible until the project id was known, and `get_file` read it fine.
      The mockups are static inline-styled phones rather than a component
      library, so the palette and component anatomy were extracted and rebuilt.
      **Still open:** a two-way sync would need a design-system project, which
      has to be created as one — the type is immutable.
- [x] **12b. Screens still to match the mockups.** Chord Hero playing (1c) and
      Progress (1d) applied: the now-card, the lane of coming chords with "next
      / in 2 / in 3", the streak pill, and on Progress the companion tile, the
      streak as a number, and every badge as a slot — earned or dashed, because
      an empty slot is the reason to come back. Progress was promoted from a
      one-item menu to a screen of its own.

- [x] **13. Accessibility pass.** Skip link, one `h1` per screen and no skipped
      levels, a global `:focus-visible` ring so a new control cannot ship
      without one, throttled live regions on the readouts that change (the
      tuner announces in ten-cent buckets, not 25 times a second), and
      `animation: none` under reduced motion rather than a zeroed duration —
      which had left the companion frozen mid-bob.
- [x] **14. Service worker updates.** The worker no longer calls `skipWaiting()`
      on install, so a deploy waits rather than swapping the assets under
      someone mid-session. `UpdateBar` sits at the app root — a new build is
      worth offering before sign-in too — and "Later" means later. Two bugs
      found while testing it against a real worker: the first visit reloaded
      itself for nothing, and the fix for that then suppressed the genuine
      update swap as well.
- [x] **15. Left-handed.** `src/domain/handedness.ts` is one predicate and one
      coordinate flip; string and fret *numbers* deliberately do not change,
      since renumbering would make every skill id and every practice record mean
      something different behind a flag. Stored on the user profile, not the
      device. Found a real bug: the barre rect took its left edge from the
      highest string number, which is only leftmost on a right-handed chart —
      mirrored it had negative width and vanished.

## Ground rules

- Never touch `.github/workflows/deploy.yml`.
- Every browser test needs a fresh `--user-data-dir`. Reusing one carries state
  between runs — a half-finished session, a stale emulated media feature — and
  the failures look like regressions in the app.
- `src/domain/` stays pure: no React, no Firestore at runtime.
- Components never import `db`; everything goes through `src/storage/`.
- Never await a Firestore write for UI purposes — offline it stays pending for
  hours while the local cache already has the data.
- Sample the microphone on a fixed clock, never on detector updates. The pitch
  detector republishes every 30 ms and the chord detector eight times a second,
  so an effect keyed on both pushes a chord frame — usually null — on every note
  flicker, and a correctly played chord is scored as "not heard".
- Measure before tuning DSP. Two findings recorded the hard way: harmonic
  suppression makes accuracy *worse*, and an 8192-sample window is exactly as
  accurate as 16384 at half the latency.
- A missing fake-audio WAV in the scratchpad presents as `noiseLevel: 1.0,
  clarity: 0.0` — indistinguishable from a detector regression until you read
  the numbers. Check the fixture exists first. Chrome's fake-audio file does not
  loop, so every browser test needs a fresh `--user-data-dir`.
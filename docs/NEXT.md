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

## Next

- [ ] **16. Does a failed rep really belong four days away?** `FAIL_INTERVAL_DAYS
      = 0.1` in [src/domain/scheduler.ts](../src/domain/scheduler.ts) is named
      and commented as "a failure comes back in about two and a half hours, i.e.
      later today". It is not that. It is the lower clamp applied to *every*
      grade, and the lapse interval that FSRS produces sits far above it for
      anything actually practised. Measured on 2026-09-02: a failed rep returns
      in 0.84 days at stability 1, 2.71 at stability 10 and 4.56 at stability 30.
      The floor only binds below about stability 0.05, which no practised skill
      reaches.
      So either the comment is wrong and should be corrected, or the intent is
      right and the code never implemented it. For a practice app the intent
      reads better: failing a chord and not seeing it again until Saturday is not
      how anyone learns a chord. But this changes the schedule for every stored
      skill, so it is a decision rather than a fix.
      `scheduler.test.ts` records the present behaviour, so whichever way it
      goes, the change will be visible rather than silent.

- [x] **16a. A perfectly played riff cannot score 1.00 if its own notes
      repeat.** Consecutive repeats were collapsed on the HEARD side only, so a
      riff written with a genuine repeat, `['E2','E2','G2','A2']`,
      `['G2','E2','E2','E2']`, `['D2','D2','F2','G2']`, `['B3','G3','E3','E3']`,
      capped at an order ratio of **0.75** for a perfect performance. Found
      2026-09-03, fixed the same day.
      Done: the collapse is now a shared `collapsedPitchClasses` helper applied
      to both sides, so the two sequences are compared in the same alphabet.
      **11 of the catalog's 44 riff steps** were affected, not the four named
      above; `riff.string-set.3-5.skip/r4`, `['A2','A3','G3','A2']`, was capped
      by an octave repeat rather than a literal one, because the comparison is
      on pitch class. All 44 now score 1.00 and `hit` when played as written.
      **The design question, answered rather than assumed.** Collapsing the
      expected side means a player who omits the repeat, playing `E2 G2 A2`,
      scores the same as one who plays it. That is accepted, because the two are
      not distinguishable here and never were: both panels record a riff with
      `if (latestNote.current) bucket.push(...)`, so a frame carrying no pitch is
      never stored, and the silence between two picks of the same note is
      discarded before `scoreRiffWindow` is reached. The two performances arrive
      as the same array, so no implementation can return two numbers for them.
      The only choice available is which of the two the shared value should be
      correct for, and the player who played it as written wins that.
      **The onset detector cannot rescue it, and must not be asked to.** Onsets
      exist in the pipeline, but as bare timestamps in `useChordDetector` with no
      pitch attached, and the note stream carries no timestamps to correlate them
      against. Even wired up, recovering the second attack would mean a *missing*
      onset dropped the ratio back to 0.75 and a hit to a partial, which is the
      demotion-on-a-missed-attack CLAUDE.md forbids. Item 1's rule stands: attack
      detection is the least reliable link and never costs a grade.
      Pinned by 8 new tests in `progressions.test.ts` (56 to 64, suite 199 to
      207), including two that re-run the pre-fix computation and require it to
      agree byte for byte on every catalog riff without a repeat. Mutation
      checked both ways: reinstating the bug fails 6 of them, and widening the
      collapse from adjacent to global fails the 2 regression guards.
- [ ] **16d. String Sniper can STALL on the same riffs, and this one is worse
      than 16a was.** Found while fixing 16a, in a different file. `hearNote` in
      `riffDrill.ts` ignores a note equal to `lastHeard`, because a ringing note
      reports on every frame and otherwise holding one note would advance the
      whole riff. A genuine repeat therefore only advances the cursor if a silent
      frame lands between the two picks to reset `lastHeard` to null.

      Play `['E2','E2','G2','A2']` fast enough that the string never goes quiet
      and the drill stops on the second E2: the cursor never moves, and every
      note after it counts as `wrong`. **The riff cannot be completed.** 16a cost
      him feedback; this costs him the exercise.

      Same root cause as 16a, opposite consequence, and it cannot be fixed the
      same way: collapsing repeats is exactly what makes the scorer work and
      exactly what breaks the drill, because a drill has a cursor and a score
      does not. It probably needs the onset timestamps that `useChordDetector`
      already keeps in `onsetsRef`, correlated against the note stream, which is
      the wiring 16a deliberately did not build.

      **`riffDrill.ts` has no test coverage at all.** Found 2026-09-03.

- [x] **16e. Two notes the app cannot parse are treated as the same note.**
      Found and fixed 2026-09-03. `pitchClassOf` returned `null` for anything it
      did not recognise and `riffDrill.hearNote` compared with
      `pitchClassOf(a) === pitchClassOf(b)`, so `null === null` was a match: an
      expected note of `Cb2` was satisfied by heard input of literally any other
      unrecognised string. Latent, and confirmed latent rather than assumed: the
      catalog spells 27 note names and 12 roots and every one of them is a
      natural or a sharp, so no live input reached the bug.

      **The item understated the problem, and the wider fix is a consolidation.**
      There were three note parsers, not one: `progressions.pitchClassOf`, a
      private copy in `riffDrill.ts`, and `tunings.pitchClassOfRoot`. The first
      two parse the same thing for the same purpose and **disagreed on six
      inputs**, because riffDrill's regex was unanchored and did not trim:
      `Ebanana` and `E2 G2` and `C##` and `C4x` and `E 2` all read as real notes
      there and as junk in progressions, while `  G3  ` read as G in
      progressions and as junk there. That was a live disagreement, not a latent
      one. Both are now one parser in `tunings.ts`.

      `pitchClassOfRoot` stays separate and is now the only other one. A root has
      no octave, which is a real difference rather than an accident: `Ab7` is an
      A-flat dominant seventh as a root and A-flat in octave 7 as a note name,
      and merging the two would make `transposeRoot('E2', 2)` answer `F#` and
      quietly drop the octave. It shares the spelling table, so the two agree on
      every name they both accept.

      What changed, in `src/domain/tunings.ts`:

      - `parseNote` is the single parser. `Cb`, `E#`, `Fb` and `B#` now read, and
        `Cb` and `B#` carry the octave borrow they imply, so `Cb4` parses as B3
        and `B#3` as C4. Only `transposeNote` can see that; everything else
        compares pitch classes and discards the octave anyway.
      - **`samePitchClass` is the actual fix**, and is false whenever either side
        fails to parse. A helper rather than a check at every call site, because
        "every call site remembers" is how it broke.
      - Lowercase stays rejected, **deliberately**. Note names here are authored
        catalog data and detector output built from a fixed uppercase table, never
        typing, so `e2` is a catalog typo. Accepting it would discard the one
        signal that now surfaces the typo.

      Proved with a differential run of the old implementations against the new
      over all 252 real note names, four functions and eight transposition
      amounts: zero changes to any input that resolved before, and 404 inputs
      that were unreadable and now resolve. The catalog itself was enumerated
      too, and every one of its names is a natural or a sharp.

      `tunings.test.ts` is new and had no coverage at all before, 31 tests. The
      FINDING tests in `riffDrill.test.ts` now assert the fixed behaviour and
      say in their names that the old assertion was the defect. Suite is 241 to
      278. Mutation-checked three ways: restoring the `null === null` compare
      fails 3 tests, dropping the four spellings fails 13, and unanchoring the
      regex fails 3.

- [x] **16f. The same flat-root blindness, one layer down in the audio code.** DONE 2026-09-05.
      Found 2026-09-03 while consolidating the note parsers for 16e, and left
      alone because it sits in the untested audio path rather than in domain.

      `chordPitchClassMask` in `src/audio/chordDetection.ts` finds a root with a
      sharp-only `indexOf`, so a flat root returns a mask of `0`, and
      `scoreDetection` then falls back to comparing root strings. A catalog root
      of `Db` would therefore never match a detected `C#`, which are the same
      chord.

      Latent for exactly the reason 16e was: every root in the catalog is a
      natural or a sharp, and that was enumerated rather than assumed. It goes
      live the day someone writes a flat.

      **Fixed 2026-09-05.** `chordPitchClassMask` resolves its root through
      `pitchClassOfRoot` in `tunings.ts`, so there is one owner for note
      spelling rather than a private sharp-only table. The audio -> domain
      import is the direction that was already open: `earGrading.ts` and
      `progressions.ts` both import from `chordDetection.ts`, and `tunings.ts`
      imports nothing.

      **The second half was worse than this note recorded, and was live.**
      `earGrading.ts` compared masks with a bare `===`, and an unresolvable
      root masks to 0, so two roots the app could not spell compared EQUAL:
      `Bb` major graded CLEAN against `Db` minor. A wrong answer accepted,
      which is the failure direction `samePitchClass` was written to stop one
      layer up. `progressions.ts` had guarded by hand and was never wrong.
      Both now go through `sameChordTones`, which is the same shape as
      `samePitchClass` and exists for the same recorded reason: "every call
      site has to remember" is how it broke the first time.

      **Mutation-checked both ways, and the second one mattered.** Restoring
      the sharp-only lookup fails 2 tests. Deleting the zero guard failed
      NOTHING at first: fixing the flat lookup had moved `Bb` and `Db` onto
      real, differing masks, so the pair that originally demonstrated the bug
      stopped exercising the guard entirely. The test now uses genuinely
      unspellable roots, which is the case that survives: a typo in the
      catalog. 335 tests green.

      **There are also two more copies of the pitch-class name array**, in
      `chordDetection.ts` and `audio/notes.ts`. 16e collapsed three copies in
      `src/domain` down to one owner in `tunings.ts`; these two are the same
      pattern across the domain and audio boundary, which is a bigger decision
      than 16e was and needs the audio path to have tests first.

- [ ] **16b. The warm-up comment in `planStructuredSession` reads backwards.**
      It says "when there is not enough history to have a comfortable skill, the
      warm-up simply takes the easiest of what is planned." On day one every
      item scores `comfort() === -1`, so the sort is a no-op, plan order stands,
      and the **cool-down** takes first pick. Measured on a catalog of advanced,
      beginner, beginner, intermediate, advanced: cool-down gets `easy-a` and
      the warm-up gets `easy-b` and `middling`. The behaviour is defensible,
      since ending well is the stated priority, but the sentence describes the
      opposite. Correct the comment.
- [x] **16c. Two stale or wrong docstrings around riff scoring.** DONE
      2026-09-05, and the second half was a real defect rather than a comment.

      The `RiffScore` docstring now describes the LCS behaviour and says what
      the thresholds actually are, 70% coverage AND 60% order for a hit. It
      also records that it contradicted `longestCommonSubsequence`, because two
      docstrings disagreeing is worse than one being stale: a reader cannot
      tell which is current.

      `timingVerdict(NaN)` is fixed with `Number.isFinite`, not a null check.
      This was filed as display-only on the grounds that the grade was safe
      either way, and that held, but only by accident: `applyTiming` carried
      its own hand-written `offsetMs === null` test beside the call, so making
      NaN return 'none' would have started demoting unmeasured attacks to
      'partial', which is precisely what its docstring promises never to do.
      Both now route through the verdict, so there is one owner for "was there
      an onset". Mutation-checked: restoring the old comparison fails 2 tests.

      Original entry: The
      `RiffScore` docstring still describes the pre-LCS behaviour, "Coverage,
      not order", while the function below it computes an order ratio and gates
      `hit` on it, and `longestCommonSubsequence`'s own docstring says the
      opposite. Separately, `timingVerdict(NaN)` returns `'on-time'` rather than
      `'none'`, because `NaN < -70` and `NaN > 70` are both false. The grading
      outcome is safe, since both leave a hit intact, but it would display as
      "on time" when there was no onset at all.
- [ ] **17. One frame separates "we did not hear you" from "you played it
      wrong".** `earGrading.ts` says in its own header that it "deliberately does
      *not* punish silence", and at one exact share it does. `MIN_HEARD_SHARE`
      is 0.15 and the grade thresholds are measured against `totalFrames`, so
      2 clean frames in 20 is `unheard` with no grade written, while **3 clean
      frames in 20 is graded `fail`** even though every frame that carried a
      chord carried the right one. Both sides of that edge are now pinned in
      `earGrading.test.ts`, so whichever way it is resolved the change will be
      visible. Found 2026-09-03.
- [x] **18. Two chords the mask cannot spell compare as a clean hit.**
      **DONE 2026-09-05, as the second half of 16f.** This was the same defect
      filed twice, from two directions: 16f found it while consolidating note
      parsers, 18 found it by reading `compareHeard`. Worth noticing that the
      duplicate existed, because the two entries disagreed about severity and
      18 was the one that was right.

      A mask of 0 is now treated as unknown rather than as a value, in
      `sameChordTones`, which both call sites share. `compareHeard({root:'Bb'},
      {root:'Db'})` returns `'wrong'`.

      **"Unreachable today" was the wrong reading, and it is worth keeping why.**
      Both entries said the flat spelling was latent because `noteAt` emits only
      sharps. True of the ROOT NAMES the detector produces, and irrelevant to
      the catalog, which is hand-authored data where nothing stops a flat being
      typed. The guard belongs there regardless of whether anything reaches it,
      because the failure direction is a wrong answer scored as correct.
- [~] **19. `describeRiffPositions` does not do what its docstring claims.**
      **Docstring corrected 2026-09-05; the behaviour is left alone and the
      choice is now an open question for Eduardo, not a bug.**

      The comment is no longer lying: it says the placement is per note with no
      memory of the previous one, gives the real output, and says why that was
      not simply changed to match the claim.

      **The question to put to him, when there is a reason to ask:** should a
      riff prompt prefer open strings, or one hand position? They conflict.
      Open strings are the easiest thing on the guitar and a beginner is
      probably better served by `5:0` than by being sent to the 5th fret to
      keep a shape tidy, which is why the code was not "fixed" to match its own
      comment. But a riff spread over three positions is harder to play as a
      phrase. Implementing position coherence means scoring the whole sequence
      for span rather than each note alone: real work, pure, testable, and
      pointless before knowing which he wants.

      Original entry:
      The docstring says the sort "keeps a riff inside one hand position" and
      gives `6:5 5:3 5:5 4:2` as the shape of the output. For
      `['A2','C3','D3','E3']` the code actually returns `5:0 5:3 4:0 4:2`: the
      sort is per note with no memory of the previous one, so it takes an open
      string wherever one exists and spreads the riff across three positions.
      The output is playable, but the claim is not implemented. Either implement
      it or correct the docstring.
- [x] **20. Two docstrings state the wrong denominator.** DONE 2026-09-05,
      comments only, no divisor touched. The corrected docstring also records
      WHY the denominator is right rather than merely which one it is: a rep
      half of which was never played is not a rep half as good, so silence
      counting against the fraction is the wanted behaviour.
      Original entry: `cleanFraction` and
      `closeFraction` are documented as the "fraction of heard frames" and are
      computed over `totalFrames`. Ten clean frames in a twenty frame window
      whose other ten carried nothing reports 0.5, not 1.0. The thresholds are
      calibrated against the denominator the code uses, so this is a comment to
      fix and **not** a divisor to change.

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
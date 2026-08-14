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

## Next

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

## Next

Drawn from what `docs/ROADMAP.md` still lists as missing.

- [ ] **8. No microphone, no dead ends.** Milestone 4 asks that everything from
      Milestone 3 keeps working when microphone access is denied. Today a denied
      permission leaves the audio panels showing an error and nothing else.
      Chord Hero should fall back to a self-graded run — the same steps, the
      same clock, manual "got it / missed it" — and every mic panel should say
      what to do about it rather than just what went wrong.
- [ ] **9. Session flow.** Milestone 3's last unbuilt piece: warm-up, rotation,
      cool-down, and an end-of-session summary that files one record to
      `/users/{uid}/sessions` (`kind: 'today'`) rather than only per-skill
      grades. Today's Session is a flat list with no shape to it.
- [ ] **10. Accessibility pass.** Milestone 6: keyboard-only practice, screen
      reader labels on every live region, visible focus, and a reduced-motion
      audit now that there is a character bobbing about.
- [ ] **11. Service worker updates.** Milestone 6: prompt when a new version is
      waiting instead of silently reloading.
- [ ] **12. Left-handed.** Milestone 6: mirror the fretboard diagrams and the
      string order behind a profile setting.

## Ground rules

- Never touch `.github/workflows/deploy.yml`.
- `src/domain/` stays pure: no React, no Firestore at runtime.
- Components never import `db`; everything goes through `src/storage/`.
- Never await a Firestore write for UI purposes — offline it stays pending for
  hours while the local cache already has the data.
- Measure before tuning DSP. Two findings recorded the hard way: harmonic
  suppression makes accuracy *worse*, and an 8192-sample window is exactly as
  accurate as 16384 at half the latency.
- A missing fake-audio WAV in the scratchpad presents as `noiseLevel: 1.0,
  clarity: 0.0` — indistinguishable from a detector regression until you read
  the numbers. Check the fixture exists first. Chrome's fake-audio file does not
  loop, so every browser test needs a fresh `--user-data-dir`.

# Live check of the household rules

Written 2026-11-20 because the Rules test API refused the service account and there is no emulator here. It tests the real, released
rules with three throwaway users (owner, invited member, stranger) minted with custom tokens, then deletes everything it made.

1. Mint tokens for `zz-test-owner`, `zz-test-carla`, `zz-test-stranger` with `email` and `email_verified` claims (firebase-admin
   `auth.create_custom_token`), write them as JSON `{uid: token}`.
2. `node livecheck.mjs tokens.json` (uses nexo-app's `.env.local` and `node_modules`).
3. Delete `households/zz-test-house`, `users/zz-test-owner` and the three users. **Start from a clean state**: a leftover invite
   from an earlier run makes "carla cannot join without an invite" fail for a reason that is not the rules.

`rules_api.py` is the small client used to create a ruleset and release it (`firebaserules.googleapis.com`). The previous release id is
kept in the GHAPP commit message and in PM's projects/kaji.md so a bad release can be rolled back by releasing it again.

A write made at once after another can be refused for a split second (rules read the household just written); the check pauses 1.5 s
at those two points and the app's store retries that one error.

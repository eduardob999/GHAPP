import type { User } from 'firebase/auth';
import type { Timestamp } from 'firebase/firestore';
import { persistenceStatus } from '../firebase';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { useUserProfile } from '../hooks/useUserProfile';
import { recordPracticePing } from '../storage/userState';
import { SyncBadge } from './SyncBadge';

/**
 * Where your practice is stored, and whether it has landed.
 *
 * Lifted out of the old dashboard unchanged. It belongs behind a menu rather
 * than under the drills: it is the answer to "did that save?", which is a
 * question you ask occasionally and never while playing.
 */

const DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

/** Pending `serverTimestamp()` values read back as null until the server lands. */
function formatTimestamp(value: Timestamp | null): string {
  if (!value) return 'waiting for the server…';
  return DATE_FORMAT.format(value.toDate());
}

export function AccountPanel({ user }: { user: User }) {
  const online = useOnlineStatus();
  const { profile, fromCache, hasPendingWrites, loading, error } = useUserProfile(user);

  function handlePracticePing() {
    // Deliberately not awaited: offline, this promise stays pending until the
    // network returns, but the local cache — and therefore the counter on
    // screen — updates immediately.
    void recordPracticePing(user.uid).catch((err: unknown) => {
      console.error('[firestore] Practice ping did not reach the server.', err);
    });
  }

  return (
    <section className="card">
      <div className="card__header">
        <h2 className="card__title">Account &amp; sync</h2>
        <SyncBadge online={online} fromCache={fromCache} hasPendingWrites={hasPendingWrites} />
      </div>

      <p className="card__body">
        Signed in as {user.email}. Practice is stored under your account, so a second device is
        never a second account.
      </p>

      {error ? (
        <p className="notice notice--error" role="alert">
          Could not read your profile: {error}
        </p>
      ) : loading ? (
        <p className="card__body">Loading your profile…</p>
      ) : profile ? (
        <>
          <p className="notice notice--ok">
            Profile loaded from <code>/users/{user.uid}</code>
          </p>
          <dl className="datalist">
            <div className="datalist__row">
              <dt>Account created</dt>
              <dd>{formatTimestamp(profile.createdAt)}</dd>
            </div>
            <div className="datalist__row">
              <dt>Last sign-in</dt>
              <dd>{formatTimestamp(profile.lastLoginAt)}</dd>
            </div>
            <div className="datalist__row">
              <dt>Practice pings</dt>
              <dd>{profile.practicePings}</dd>
            </div>
            <div className="datalist__row">
              <dt>Local cache</dt>
              <dd>
                {persistenceStatus === 'persistent'
                  ? 'IndexedDB, shared across tabs'
                  : 'in-memory only'}
              </dd>
            </div>
          </dl>
        </>
      ) : (
        <p className="card__body">
          No profile document yet. It is created on your first sign-in — if this persists, check
          your Firestore security rules.
        </p>
      )}

      <button type="button" className="button button--primary" onClick={handlePracticePing}>
        Write a test ping
      </button>
      <p className="card__hint">
        Go offline and press it a few times: the counter moves straight away, the badge turns
        amber, and the writes land on the server the moment you reconnect.
      </p>
    </section>
  );
}

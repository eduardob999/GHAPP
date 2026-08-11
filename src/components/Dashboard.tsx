import { useState } from 'react';
import type { User } from 'firebase/auth';
import type { Timestamp } from 'firebase/firestore';
import { signOutUser } from '../auth';
import { persistenceStatus } from '../firebase';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { useUserProfile } from '../hooks/useUserProfile';
import { recordPracticePing } from '../storage/userState';
import { SyncBadge } from './SyncBadge';

interface DashboardProps {
  user: User;
}

const DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

/** Pending `serverTimestamp()` values read back as null until the server lands. */
function formatTimestamp(value: Timestamp | null): string {
  if (!value) return 'waiting for the server…';
  return DATE_FORMAT.format(value.toDate());
}

function firstName(displayName: string | null): string {
  return displayName?.trim().split(/\s+/)[0] ?? 'friend';
}

export function Dashboard({ user }: DashboardProps) {
  const online = useOnlineStatus();
  const { profile, fromCache, hasPendingWrites, loading, error } = useUserProfile(user);
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await signOutUser();
    } catch (err) {
      console.error('[auth] Sign-out failed.', err);
      setSigningOut(false);
    }
  }

  function handlePracticePing() {
    // Deliberately not awaited: offline, this promise stays pending until the
    // network returns, but the local cache — and therefore the counter on
    // screen — updates immediately.
    void recordPracticePing(user.uid).catch((err: unknown) => {
      console.error('[firestore] Practice ping did not reach the server.', err);
    });
  }

  return (
    <div className="screen">
      <header className="topbar">
        <div className="topbar__identity">
          {user.photoURL ? (
            <img className="avatar" src={user.photoURL} alt="" referrerPolicy="no-referrer" />
          ) : (
            <div className="avatar avatar--fallback" aria-hidden="true">
              {firstName(user.displayName).charAt(0).toUpperCase()}
            </div>
          )}
          <div>
            <p className="topbar__greeting">Hello, {user.displayName ?? 'friend'}!</p>
            <p className="topbar__email">{user.email}</p>
          </div>
        </div>

        <button
          type="button"
          className="button button--ghost"
          onClick={() => void handleSignOut()}
          disabled={signingOut}
        >
          {signingOut ? 'Signing out…' : 'Sign out'}
        </button>
      </header>

      <main className="content">
        <section className="card">
          <div className="card__header">
            <h2 className="card__title">Practice Dashboard</h2>
            <span className="pill">coming soon</span>
          </div>
          <p className="card__body">
            This is where your daily rotation will live — CAGED shapes for the fretting hand,
            string-accuracy drills for the picking hand, and a spaced scheduler deciding what you
            see today.
          </p>
        </section>

        <section className="card">
          <div className="card__header">
            <h2 className="card__title">Firestore</h2>
            <SyncBadge
              online={online}
              fromCache={fromCache}
              hasPendingWrites={hasPendingWrites}
            />
          </div>

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
      </main>
    </div>
  );
}

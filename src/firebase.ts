import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore';
import { firebaseConfig, isFirebaseConfigured } from './firebaseConfig';

export { isFirebaseConfigured };

export const app: FirebaseApp = initializeApp(firebaseConfig);

export const auth: Auth = getAuth(app);

/**
 * Offline persistence.
 *
 * The older `enableIndexedDbPersistence(db)` call is deprecated in the modular
 * SDK and is documented for removal in a future major version. `localCache` is
 * its supported replacement and does the same thing — an IndexedDB-backed cache
 * that serves reads offline and queues writes until the network returns.
 *
 * `persistentMultipleTabManager()` is the reason to prefer it: the deprecated
 * call fails with `failed-precondition` as soon as the app is open in a second
 * tab, leaving that tab with no persistence at all. The multi-tab manager
 * shares one IndexedDB cache across every open tab instead, so there is no
 * conflict to recover from.
 *
 * Persistence can still be unavailable — private browsing modes and browsers
 * without IndexedDB will reject it — so we fall back to an in-memory cache
 * rather than leaving the app unusable. `persistenceStatus` lets the UI say
 * which mode it ended up in.
 */
export type PersistenceStatus = 'persistent' | 'memory-only';

let resolvedPersistence: PersistenceStatus = 'persistent';

function createFirestore(): Firestore {
  try {
    return initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch (error) {
    resolvedPersistence = 'memory-only';
    console.warn(
      '[firestore] Offline persistence is unavailable, falling back to an in-memory cache. ' +
        'Practice data will not survive a reload. This usually means the browser blocks ' +
        'IndexedDB (private browsing) or does not support it.',
      error,
    );
    return initializeFirestore(app, {});
  }
}

export const db: Firestore = createFirestore();

export const persistenceStatus: PersistenceStatus = resolvedPersistence;

// Google sign-in + cloud backup (Firebase Auth + Firestore, free Spark plan).
// The user's watchlist, alerts, cart, orders and address are mirrored to Firestore
// (document users/{uid}), so signing in again — on this or any device — restores everything.
// Everything here is lazy-loaded: Firebase is only downloaded when Google sign-in is used.
import { Capacitor } from '@capacitor/core';
import { api, type User } from './api';

const env = import.meta.env;
const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  appId: env.VITE_FIREBASE_APP_ID as string | undefined,
};
const webClientId = env.VITE_GOOGLE_WEB_CLIENT_ID as string | undefined;
const native = Capacitor.isNativePlatform();

export const googleConfigured = !!(firebaseConfig.apiKey && firebaseConfig.projectId && (!native || webClientId));

const UID_KEY = 'kompare.googleUid';
const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string | null) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* ignore */ } },
};
type Meta = { changedAt: number; pushedAt: number };
const readMeta = (uid: string): Meta => { try { return { changedAt: 0, pushedAt: 0, ...JSON.parse(store.get(`kompare.sync.${uid}`) || '{}') }; } catch { return { changedAt: 0, pushedAt: 0 }; } };
const writeMeta = (uid: string, m: Meta) => store.set(`kompare.sync.${uid}`, JSON.stringify(m));

let fbPromise: Promise<Awaited<ReturnType<typeof loadFirebase>>> | null = null;
async function loadFirebase() {
  const [{ initializeApp }, authMod, fsMod] = await Promise.all([import('firebase/app'), import('firebase/auth'), import('firebase/firestore')]);
  const app = initializeApp(firebaseConfig);
  const auth = authMod.initializeAuth(app, { persistence: [authMod.indexedDBLocalPersistence, authMod.browserLocalPersistence] });
  const db = fsMod.getFirestore(app);
  await auth.authStateReady();
  return { auth, authMod, db, fsMod };
}
const firebase = () => (fbPromise ||= loadFirebase());

export const currentGoogleUid = () => store.get(UID_KEY);

/** Interactive Google sign-in → our session token, then restore the cloud backup. */
export async function signInWithGoogle(): Promise<{ token: string; user: User }> {
  if (!googleConfigured) throw new Error("Google sign-in isn't set up in this build yet (see README → Google sign-in).");
  const { auth, authMod } = await firebase();
  let cred;
  if (native) {
    const { SocialLogin } = await import('@capgo/capacitor-social-login');
    await SocialLogin.initialize({ google: { webClientId, mode: 'online' } });
    const res = await SocialLogin.login({ provider: 'google', options: { scopes: ['email', 'profile'] } });
    const idToken = (res.result as { idToken?: string | null }).idToken;
    if (!idToken) throw new Error('Google did not return an ID token');
    cred = await authMod.signInWithCredential(auth, authMod.GoogleAuthProvider.credential(idToken));
  } else {
    cred = await authMod.signInWithPopup(auth, new authMod.GoogleAuthProvider());
  }
  const fu = cred.user;
  const session = await api<{ token: string; user: User }>('/auth/google', {
    method: 'POST',
    body: { idToken: await fu.getIdToken(), uid: fu.uid, email: fu.email, name: fu.displayName },
    silent: true,
  });
  store.set(UID_KEY, fu.uid);
  return session;
}

/**
 * Reconcile the device with the cloud copy. Cloud wins if it is newer than our last local change
 * (e.g. new phone / reinstall); otherwise local unsynced changes are pushed up.
 */
export async function syncNow(): Promise<'restored' | 'pushed' | 'in-sync' | 'off'> {
  const uid = currentGoogleUid();
  if (!uid || !googleConfigured) return 'off';
  const { auth, db, fsMod } = await firebase();
  if (auth.currentUser?.uid !== uid) return 'off';
  const ref = fsMod.doc(db, 'users', uid);
  const snap = await fsMod.getDoc(ref);
  const cloud = snap.exists() ? (snap.data() as { data: string; updatedAt: number }) : null;
  const meta = readMeta(uid);
  if (cloud && cloud.updatedAt > meta.changedAt) {
    await api('/sync/import', { method: 'POST', body: { snapshot: JSON.parse(cloud.data) }, silent: true });
    writeMeta(uid, { changedAt: cloud.updatedAt, pushedAt: cloud.updatedAt });
    return 'restored';
  }
  if (!cloud || meta.changedAt > meta.pushedAt) { await push(uid); return 'pushed'; }
  return 'in-sync';
}

async function push(uid: string) {
  const { db, fsMod, auth } = await firebase();
  if (auth.currentUser?.uid !== uid) return;
  const snapshot = await api('/sync/export', { silent: true });
  const now = Date.now();
  await fsMod.setDoc(fsMod.doc(db, 'users', uid), { data: JSON.stringify(snapshot), updatedAt: now, email: auth.currentUser.email });
  writeMeta(uid, { changedAt: now, pushedAt: now });
}

let timer: ReturnType<typeof setTimeout> | null = null;
/** Called after every successful change (cart, watchlist, alerts, orders…): debounced backup. */
export function noteLocalChange() {
  const uid = currentGoogleUid();
  if (!uid || !googleConfigured) return;
  writeMeta(uid, { ...readMeta(uid), changedAt: Date.now() });
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; push(uid).catch((e) => console.warn('[cloud] backup failed, will retry on next change', e)); }, 1500);
}

/** Flush any pending backup, then sign out of Google. Local data stays on the device. */
export async function signOutGoogle() {
  const uid = currentGoogleUid();
  if (!uid) return;
  if (timer) { clearTimeout(timer); timer = null; await push(uid).catch(() => {}); }
  store.set(UID_KEY, null);
  if (!googleConfigured) return;
  const { auth } = await firebase();
  await auth.signOut().catch(() => {});
  if (native) {
    const { SocialLogin } = await import('@capgo/capacitor-social-login');
    await SocialLogin.logout({ provider: 'google' }).catch(() => {});
  }
}

export const lastBackupAt = () => { const uid = currentGoogleUid(); return uid ? readMeta(uid).pushedAt || null : null; };

/** Manual "Back up now". */
export async function backupNow() {
  const uid = currentGoogleUid();
  if (!uid) throw new Error('Sign in with Google to back up your data');
  await push(uid);
}

/** Removes the cloud copy (used when deleting the account). */
export async function deleteCloudBackup() {
  const uid = currentGoogleUid();
  if (!uid || !googleConfigured) return;
  const { db, fsMod } = await firebase();
  await fsMod.deleteDoc(fsMod.doc(db, 'users', uid)).catch(() => {});
}

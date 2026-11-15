import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth, useTitle, useToast } from '../lib/hooks';
import { backupNow, deleteCloudBackup, googleConfigured, lastBackupAt, signInWithGoogle } from '../lib/cloud';
import { enableNotifications, isNative } from '../lib/native';
import { ago } from '../lib/format';

export default function Account() {
  useTitle('Account');
  const { user, cloud, login, logout } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [backedUp, setBackedUp] = useState(lastBackupAt());

  const backup = useMutation({ mutationFn: backupNow, onSuccess: () => { setBackedUp(Date.now()); toast('Backed up to your Google account'); }, onError: (e: Error) => toast(e.message, 'err') });
  const link = useMutation({ mutationFn: signInWithGoogle, onSuccess: (r) => { login(r.token, r.user); toast('Google account linked — backup is on'); }, onError: (e: Error) => toast(e.message, 'err') });
  const del = useMutation({
    mutationFn: async () => { await deleteCloudBackup(); await api('/auth/me', { method: 'DELETE', silent: true }); },
    onSuccess: () => { logout(); toast('Your account and data were deleted'); nav('/', { replace: true }); },
    onError: (e: Error) => toast(e.message, 'err'),
  });
  if (!user) return null;
  const a = user.address;

  return (
    <div className="stack">
      <div className="card pad-lg account-head">
        <div className="avatar" aria-hidden>{user.name[0]?.toUpperCase()}</div>
        <div><h1 className="section-title" style={{ margin: 0 }}>{user.name}</h1><div className="muted sm">{user.email}</div></div>
      </div>

      <div className="card pad-lg">
        <h3>☁️ Cloud backup</h3>
        {cloud ? (
          <>
            <p className="sm">Your watchlist, alerts, cart, orders and address are backed up to your Google account and restored whenever you sign in, on any phone.</p>
            <p className="xs muted">{backedUp ? `Last backup ${ago(backedUp)}` : 'Backs up automatically after each change'}</p>
            <button className="btn" disabled={backup.isPending} onClick={() => backup.mutate()}>{backup.isPending ? 'Backing up…' : 'Back up now'}</button>
          </>
        ) : (
          <>
            <p className="sm">Your data is saved on this phone and stays when you sign out and back in. Link Google to also keep it safe across reinstalls and new phones.</p>
            <button className="btn google" disabled={link.isPending || !googleConfigured} onClick={() => link.mutate()}>{link.isPending ? 'Linking…' : 'Link Google account'}</button>
            {!googleConfigured && <p className="xs muted">Google sign-in isn't set up in this build yet.</p>}
          </>
        )}
      </div>

      <div className="card">
        <Link to="/orders" className="list-link">📦 Orders <span className="muted">›</span></Link>
        <Link to="/watchlist" className="list-link">👀 Watchlist & price alerts <span className="muted">›</span></Link>
        {isNative && <button className="list-link link" style={{ width: '100%', color: 'inherit' }} onClick={async () => { const on = await enableNotifications(); toast(on ? 'Price-drop notifications are on' : 'Notifications are blocked. Enable them in Android settings', on ? 'ok' : 'err'); }}>🔔 Price-drop notifications <span className="muted">›</span></button>}
      </div>

      <div className="card pad-lg">
        <h3>📍 Saved address</h3>
        {a ? <p className="sm">{a.name}<br />{a.line1}<br />{a.city}, {a.state} {a.pincode}<br />📞 {a.phone}</p> : <p className="sm muted">No address yet. It's saved automatically at your first checkout.</p>}
      </div>

      <button className="btn block" onClick={() => { logout(); nav('/', { replace: true }); }}>↩ Sign out</button>

      <div className="card pad-lg danger-zone">
        <h3>Delete account</h3>
        <p className="xs muted">Permanently deletes your account, orders, cart, alerts and cloud backup.</p>
        <button className="btn danger" disabled={del.isPending} onClick={() => confirm('Delete your account and all data? This cannot be undone.') && del.mutate()}>Delete my account</button>
      </div>

      <p className="xs muted center">Kompare {import.meta.env.VITE_APP_VERSION || 'dev'}</p>
    </div>
  );
}

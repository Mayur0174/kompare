import { useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { api, type User } from '../lib/api';
import { useAuth, useTitle } from '../lib/hooks';
import { signInWithGoogle } from '../lib/cloud';

export default function Login() {
  const [params] = useSearchParams();
  const next = params.get('next')?.startsWith('/') ? params.get('next')! : '/';
  const { user, login } = useAuth();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  useTitle(mode === 'login' ? 'Sign in' : 'Create account');

  const m = useMutation({
    mutationFn: (body: Partial<typeof form>) => api<{ token: string; user: User }>(`/auth/${mode}`, { method: 'POST', body }),
    onSuccess: (r) => login(r.token, r.user),
  });

  const google = useMutation({ mutationFn: signInWithGoogle, onSuccess: (r) => login(r.token, r.user) });

  if (user) return <Navigate to={next} replace />;
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    m.mutate(mode === 'login' ? { email: form.email, password: form.password } : form);
  };

  return (
    <div className="auth card pad-lg">
      <h1 className="section-title">{mode === 'login' ? 'Welcome back' : 'Create your account'}</h1>
      <p className="muted sm">Save products, set price alerts and get notified when prices drop.</p>
      <button className="btn google block" disabled={google.isPending} onClick={() => google.mutate()}>
        <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
        {google.isPending ? 'Signing in…' : 'Continue with Google'}
      </button>
      {google.isError && <div className="err sm" role="alert">{(google.error as Error).message}</div>}
      <p className="xs muted center">Google sign-in backs up your watchlist and price alerts, so they come back whenever you sign in again — on any phone.</p>
      <div className="divider"><span>or use email</span></div>
      <form onSubmit={submit} className="stack">
        {mode === 'signup' && <label>Name<input required minLength={2} value={form.name} autoComplete="name" onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>}
        <label>Email<input required type="email" value={form.email} autoComplete="email" onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
        <label>Password<input required type="password" minLength={mode === 'signup' ? 8 : 1} value={form.password} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} onChange={(e) => setForm({ ...form, password: e.target.value })} /></label>
        {m.isError && <div className="err sm" role="alert">{(m.error as Error).message}</div>}
        <button className="btn primary block" disabled={m.isPending}>{m.isPending ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}</button>
      </form>
      <p className="sm center">
        {mode === 'login' ? 'New to Kompare? ' : 'Already have an account? '}
        <button className="link" onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); m.reset(); }}>{mode === 'login' ? 'Create an account' : 'Sign in'}</button>
      </p>
    </div>
  );
}

import { useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { api, type User } from '../lib/api';
import { useAuth, useTitle } from '../lib/hooks';

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

  if (user) return <Navigate to={next} replace />;
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    m.mutate(mode === 'login' ? { email: form.email, password: form.password } : form);
  };

  return (
    <div className="auth card pad-lg">
      <h1 className="section-title">{mode === 'login' ? 'Welcome back' : 'Create your account'}</h1>
      <p className="muted sm">Track prices, set alerts and order from every store with one account.</p>
      <form onSubmit={submit} className="stack">
        {mode === 'signup' && <label>Name<input required minLength={2} value={form.name} autoComplete="name" onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>}
        <label>Email<input required type="email" value={form.email} autoComplete="email" onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
        <label>Password<input required type="password" minLength={mode === 'signup' ? 8 : 1} value={form.password} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} onChange={(e) => setForm({ ...form, password: e.target.value })} /></label>
        {m.isError && <div className="err sm" role="alert">{(m.error as Error).message}</div>}
        <button className="btn primary block" disabled={m.isPending}>{m.isPending ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}</button>
      </form>
      {mode === 'login' && (
        <button className="btn ghost block" disabled={m.isPending} onClick={() => m.mutate({ email: 'demo@kompare.app', password: 'demo1234' })}>Use demo account</button>
      )}
      <p className="sm center">
        {mode === 'login' ? 'New to Kompare? ' : 'Already have an account? '}
        <button className="link" onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); m.reset(); }}>{mode === 'login' ? 'Create an account' : 'Sign in'}</button>
      </p>
    </div>
  );
}

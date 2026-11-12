import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';

import { ApiError } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { ErrorNote } from '../components/ui';

const AuthShell = ({
  kicker,
  headline,
  aside,
  children,
}: {
  kicker: string;
  headline: ReactNode;
  aside: string;
  children: ReactNode;
}) => (
  <div className="auth-shell">
    <section className="auth-story">
      <div className="brand brand-auth">
        <span className="brand-mark" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        <div>
          <p className="brand-name">Stockroom</p>
          <p className="brand-sub">Inventory control</p>
        </div>
      </div>
      <p className="eyebrow">{kicker}</p>
      <h1 className="auth-headline">{headline}</h1>
      <p className="auth-aside">{aside}</p>
      <div className="auth-ledger" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
        <span />
      </div>
      <p className="auth-foot">Every item accounted for. Every change audited.</p>
    </section>
    <section className="auth-panel">{children}</section>
  </div>
);

export const LoginPage = () => {
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) {
    return <Navigate to="/" replace />;
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(email.trim(), password);
      const from = (location.state as { from?: string } | null)?.from ?? '/';
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to sign in right now.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      kicker="Sign in"
      headline={
        <>
          Know what is on
          <br />
          the shelf<span className="accent-dot">.</span>
        </>
      }
      aside="Live stock, sales, and reorder advice for your business — scoped to your account and recorded down to the last movement."
    >
      <form className="auth-form" onSubmit={submit}>
        <p className="eyebrow">Welcome back</p>
        <h2>Sign in to Stockroom</h2>
        <label className="field">
          <span>Email</span>
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@business.com"
          />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="••••••••"
          />
        </label>
        {error ? <ErrorNote>{error}</ErrorNote> : null}
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="auth-switch">
          New business? <Link to="/register">Create an account</Link>
        </p>
      </form>
    </AuthShell>
  );
};

export const RegisterPage = () => {
  const { register, user } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    businessName: '',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) {
    return <Navigate to="/" replace />;
  }

  const update = (key: keyof typeof form, value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (form.password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    setBusy(true);
    try {
      await register({
        name: form.name.trim(),
        email: form.email.trim(),
        password: form.password,
        businessName: form.businessName.trim(),
      });
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to create the account.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      kicker="Register"
      headline={
        <>
          Open the ledger
          <br />
          for your shop<span className="accent-dot">.</span>
        </>
      }
      aside="Create a business workspace and become its first administrator. Staff accounts can be added from the Team page."
    >
      <form className="auth-form" onSubmit={submit}>
        <p className="eyebrow">New workspace</p>
        <h2>Create your business</h2>
        <label className="field">
          <span>Business name</span>
          <input
            required
            value={form.businessName}
            onChange={(event) => update('businessName', event.target.value)}
            placeholder="Nandhu Traders"
          />
        </label>
        <label className="field">
          <span>Your name</span>
          <input
            required
            value={form.name}
            onChange={(event) => update('name', event.target.value)}
            placeholder="Full name"
          />
        </label>
        <label className="field">
          <span>Email</span>
          <input
            type="email"
            autoComplete="email"
            required
            value={form.email}
            onChange={(event) => update('email', event.target.value)}
            placeholder="you@business.com"
          />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={form.password}
            onChange={(event) => update('password', event.target.value)}
            placeholder="At least 8 characters"
          />
        </label>
        {error ? <ErrorNote>{error}</ErrorNote> : null}
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? 'Creating workspace…' : 'Create workspace'}
        </button>
        <p className="auth-switch">
          Already registered? <Link to="/login">Sign in</Link>
        </p>
      </form>
    </AuthShell>
  );
};

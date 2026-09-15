import { FormEvent, useState } from 'react';
import { sendPasswordResetEmail } from 'firebase/auth';
import { Link } from 'react-router-dom';
import { auth, isFirebaseConfigured } from '../../config/firebase';
import AuthShell from '../../components/layout/AuthShell';
import { authErrorMessage } from '../../contexts/authErrors';

export default function ResetPasswordPage() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setMessage('If an account uses this email, you will receive a password reset link. Check your inbox and spam folder.');
    } catch (failure) { setError(authErrorMessage(failure)); }
    finally { setBusy(false); }
  }
  return <AuthShell><section className="card p-7"><p className="page-eyebrow">Account recovery</p><h1 className="font-display text-2xl font-bold">Reset your password</h1><p className="mt-3 text-sm text-ink-600">Enter your account email. Firebase will send a link to choose a new password.</p><form onSubmit={submit} className="mt-6 space-y-4"><label className="block"><span className="field-label">Email address</span><input type="email" required autoComplete="email" className="input" value={email} onChange={event => setEmail(event.target.value)} /></label>{error && <p role="alert" className="text-sm text-red-700">{error}</p>}{message && <p role="status" className="rounded bg-brand-50 p-3 text-sm">{message}</p>}<button disabled={busy || !isFirebaseConfigured} className="btn-primary w-full">{busy ? 'Sending…' : 'Send reset email'}</button></form><Link to="/login" className="mt-5 inline-block font-semibold text-brand-700">Back to sign in</Link></section></AuthShell>;
}

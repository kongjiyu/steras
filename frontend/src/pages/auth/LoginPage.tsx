import { FormEvent, useState } from 'react';
import { Link, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import toast from 'react-hot-toast';
import { sendPasswordResetEmail } from 'firebase/auth';
import { auth } from '../../config/firebase';
import AuthShell from '../../components/layout/AuthShell';
import { getPostLoginPath, getRoleHome, ReturnLocation } from '../../routing';
import { authErrorMessage } from '../../contexts/authErrors';

export default function LoginPage() {
  const { user, profile, signIn, signOut, configured } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const existingSessionHome = user ? getRoleHome(profile?.role) : null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const requestedRoute = (location.state as { from?: ReturnLocation } | null)?.from;
    setSubmitting(true);
    try {
      const profile = await signIn(email, password);
      const destination = getPostLoginPath(profile?.role, requestedRoute);
      if (!destination) {
        await signOut();
        throw new Error('This account does not have a valid STERAS workspace profile. Contact the project administrator.');
      }
      toast.success('Signed in.');
      navigate(destination, { replace: true });
    } catch (err) {
      toast.error(authErrorMessage(err));
      setSubmitting(false);
    }
  };

  const resetPassword = async () => {
    if (!email.trim()) return toast.error('Enter your email address first.');
    try {
      await sendPasswordResetEmail(auth, email.trim());
      toast.success('Password reset email sent.');
    } catch (error) {
      toast.error(authErrorMessage(error));
    }
  };

  // Keep the form mounted while a sign-in is resolving so its intended return
  // route wins over the generic existing-session redirect.
  if (existingSessionHome && !submitting) return <Navigate to={existingSessionHome} replace />;

  return (
    <AuthShell>
      <div className="w-full border-t-4 border-brand-700 bg-[#fffdf8] px-5 py-7 shadow-[0_16px_40px_rgba(63,77,29,0.08)] sm:px-8 sm:py-8">
          <p className="page-eyebrow">Secure workspace access</p>
          <h1 className="font-display text-2xl font-bold tracking-[-0.025em] text-ink-900">Sign in to STERAS</h1>
          <p className="mt-2 text-sm leading-6 text-ink-500">Use your organizer or authority account credentials.</p>

          {!configured && (
            <div className="mt-5 rounded-md border border-gold-300 bg-gold-50 p-3 text-sm text-gold-600">
              Firebase is not configured. See <code>README.md</code> → Setup.
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div>
              <label htmlFor="email" className="field-label">Email</label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input"
                placeholder="you@example.com"
              />
            </div>
            <div>
              <label htmlFor="password" className="field-label">Password</label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input"
                placeholder="••••••••"
              />
            </div>
            <button type="submit" disabled={submitting || !configured} className="btn-primary w-full">
              {submitting ? 'Signing in…' : 'Sign in'}
            </button>
            <button type="button" disabled={!configured} onClick={resetPassword} className="w-full text-sm font-medium text-brand-700 hover:text-brand-800">Forgot password?</button>
          </form>

          <p className="mt-6 border-t border-[#e3dacb] pt-5 text-center text-sm text-ink-500">
            Don&apos;t have an account?{' '}
            <Link to="/register" className="text-brand-600 hover:text-brand-700 font-medium">
              Register
            </Link>
          </p>
      </div>
    </AuthShell>
  );
}

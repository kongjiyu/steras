import { FormEvent, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import toast from 'react-hot-toast';
import AuthShell from '../../components/layout/AuthShell';
import { getRoleHome } from '../../routing';
import { authErrorMessage } from '../../contexts/authErrors';

export default function RegisterPage() {
  const { user, profile, signUp, configured } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const existingSessionHome = user ? getRoleHome(profile?.role) : null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await signUp({
        email,
        password,
        name,
        ...(phone.trim() ? { phone: phone.trim() } : {}),
      });
      toast.success('Account created.');
      navigate('/organizer', { replace: true });
    } catch (err) {
      toast.error(authErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  if (existingSessionHome && !submitting) return <Navigate to={existingSessionHome} replace />;

  return (
    <AuthShell>
      <div className="w-full border-t-4 border-brand-700 bg-[#fffdf8] px-5 py-7 shadow-[0_16px_40px_rgba(63,77,29,0.08)] sm:px-8 sm:py-8">
          <p className="page-eyebrow">Organizer registration</p>
          <h1 className="font-display text-2xl font-bold tracking-[-0.025em] text-ink-900">Create your STERAS account</h1>
          <p className="mt-2 text-sm leading-6 text-ink-500">Start a verified application for a Malaysian tourism event.</p>

          {!configured && (
            <div className="mt-5 rounded-md border border-gold-300 bg-gold-50 p-3 text-sm text-gold-600">
              Firebase is not configured. See <code>README.md</code> → Setup.
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <p className="rounded-md border border-[#dce3c6] bg-brand-50 p-3 text-sm leading-6 text-brand-800">Public registration creates an organizer account. Authority accounts are provisioned separately by the project administrator.</p>

            <div>
              <label htmlFor="name" className="field-label">Full name</label>
              <input id="name" autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} className="input" />
            </div>

            <div>
              <label htmlFor="email" className="field-label">Email address</label>
              <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="input" />
            </div>

            <div>
              <label htmlFor="password" className="field-label">Password</label>
              <input id="password" type="password" autoComplete="new-password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} className="input" />
              <p className="mt-1.5 text-xs text-ink-500">Use at least 6 characters.</p>
            </div>

            <div>
              <label htmlFor="phone" className="field-label">Phone <span className="font-normal text-ink-400">(optional)</span></label>
              <input id="phone" type="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className="input" placeholder="+60 12-345 6789" />
            </div>

            <button type="submit" disabled={submitting || !configured} className="btn-primary w-full">
              {submitting ? 'Creating account…' : 'Create account'}
            </button>
          </form>

          <p className="mt-6 border-t border-[#e3dacb] pt-5 text-center text-sm text-ink-500">
            Already have an account?{' '}
            <Link to="/login" className="text-brand-600 hover:text-brand-700 font-medium">Sign in</Link>
          </p>
      </div>
    </AuthShell>
  );
}

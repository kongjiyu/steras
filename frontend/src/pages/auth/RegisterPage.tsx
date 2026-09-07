import { normalizePhone, passwordRequirements, TERMS_VERSION, validPersonName } from '@shared/accountValidation';
import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import AuthShell from '../../components/layout/AuthShell';
import { getRoleHome } from '../../routing';
import { authErrorMessage } from '../../contexts/authErrors';
import { CalendarPlus, LogIn, LogOut } from 'lucide-react';

export default function RegisterPage() {
  const { user, profile, signUp, signOut, configured } = useAuth();
  const navigate = useNavigate();
  const [accepted, setAccepted] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const existingSessionHome = user ? getRoleHome(profile?.role) : null;
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = async () => {
    if (!window.confirm('Sign out of STERAS?')) return;
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      setSigningOut(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const nextErrors: Record<string, string> = {};
    if (!validPersonName(name)) nextErrors.name = 'Enter your full name using letters, spaces or name punctuation.';
    if (!normalizePhone(phone)) nextErrors.phone = 'Enter a valid phone number, for example +60 12-345 6789.';
    if (!passwordRequirements(password).every(rule => rule.met)) nextErrors.password = 'Complete all password requirements below.';
    if (!accepted) nextErrors.terms = 'Read and accept the Terms & Conditions to create an account.';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    setSubmitting(true);
    try {
      await signUp({
        email,
        password,
        name,
        phone: normalizePhone(phone),
        termsVersion: TERMS_VERSION,
      });
      sessionStorage.setItem('steras-signed-in', 'true');
      navigate('/organizer', { replace: true });
    } catch (err) {
      setErrors({ submit: authErrorMessage(err) });
    } finally {
      setSubmitting(false);
    }
  };

  if (existingSessionHome && !submitting) {
    const roleLabel = profile?.role === 'authority' && profile?.authorityType
      ? `Authority (${profile.authorityType})`
      : profile?.role
      ? profile.role.charAt(0).toUpperCase() + profile.role.slice(1)
      : 'Unknown';
    return (
      <AuthShell variant="register">
        <div className="w-full border-t-4 border-brand-700 bg-[#fffdf8] px-5 py-7 shadow-[0_16px_40px_rgba(63,77,29,0.08)] sm:px-8 sm:py-8">
          <p className="page-eyebrow">Already signed in</p>
          <h1 className="font-display text-2xl font-bold tracking-[-0.025em] text-ink-900">
            You&apos;re signed in as {profile?.name ?? 'a user'}
          </h1>
          <p className="mt-2 text-sm leading-6 text-ink-500">
            You can&apos;t create a new account while another session is active.
            Head to your dashboard, or sign out first to register a different account.
          </p>

          <dl className="mt-5 divide-y divide-[#e8e0cf] rounded-lg border border-[#ded5c5] bg-cream-50/60 text-sm">
            <div className="grid grid-cols-[6rem_minmax(0,1fr)] items-center gap-3 px-4 py-3">
              <dt className="font-semibold text-ink-700">Email</dt>
              <dd className="text-ink-900">{profile?.email ?? '—'}</dd>
            </div>
            <div className="grid grid-cols-[6rem_minmax(0,1fr)] items-center gap-3 px-4 py-3">
              <dt className="font-semibold text-ink-700">Role</dt>
              <dd className="text-ink-900">{roleLabel}</dd>
            </div>
          </dl>

          <div className="mt-6 flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => navigate(existingSessionHome, { replace: true })}
              className="btn-primary flex-1"
            >
              <LogIn size={16} />
              Go to your dashboard
            </button>
            <button
              type="button"
              onClick={handleSignOut}
              disabled={signingOut}
              className="btn-secondary flex-1"
            >
              <LogOut size={16} />
              {signingOut ? 'Signing out…' : 'Sign out & register another'}
            </button>
          </div>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell variant="register">
      <div className="w-full border-t-4 border-brand-700 bg-[#fffdf8] px-5 py-7 shadow-[0_16px_40px_rgba(63,77,29,0.08)] sm:px-8 sm:py-8">
          <p className="page-eyebrow">Create account</p>
          <h1 className="font-display text-2xl font-bold tracking-[-0.025em] text-ink-900">Create your STERAS account</h1>
          <p className="mt-2 text-sm leading-6 text-ink-500">Create an organiser account to submit and track event applications.</p>

          {!configured && (
            <div className="mt-5 rounded-md border border-gold-300 bg-gold-50 p-3 text-sm text-gold-600">
              Firebase is not configured. See <code>README.md</code> → Setup.
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div className="rounded-lg border border-[#dce3c6] bg-brand-50 px-4 py-3">
              <span className="flex items-center gap-2 text-sm font-bold text-ink-900">
                <CalendarPlus size={16} className="text-brand-700" />
                Event organiser
              </span>
              <p className="mt-2 text-xs text-ink-500">
                Public self-registration creates organiser profiles only. Authority and admin accounts are provisioned separately by the project administrator.
              </p>
            </div>

            <div>
              <label htmlFor="name" className="field-label">Full name</label>
              <input id="name" autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} className="input" />
              {errors.name && <p role="alert" className="text-sm text-red-700">{errors.name}</p>}

            </div>

            <div>
              <label htmlFor="email" className="field-label">Email address</label>
              <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="input" />
            </div>

            <div>
              <label htmlFor="password" className="field-label">Password</label>
              <input id="password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} className="input" />
              <button type="button" className="mt-2 text-sm font-semibold text-brand-700" onClick={() => setShowPassword(value => !value)}>{showPassword ? 'Hide password' : 'Show password'}</button>
              <ul className="mt-2 space-y-1 text-xs" aria-label="Password requirements">{passwordRequirements(password).map(rule => <li key={rule.label} className={rule.met ? 'text-brand-700' : 'text-ink-500'}>{rule.met ? '✓' : '○'} {rule.label}</li>)}</ul>
              {errors.password && <p role="alert" className="mt-2 text-sm text-red-700">{errors.password}</p>}
            </div>

            <div>
              <label htmlFor="phone" className="field-label">Phone number *</label>
              <input id="phone" type="tel" required autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className="input" placeholder="+60 12-345 6789" />
            </div>

            {errors.phone && <p role="alert" className="text-sm text-red-700">{errors.phone}</p>}
            <div className="rounded border border-brand-200 bg-brand-50 p-3 text-sm"><p className="mb-3 font-semibold">You are creating an organiser account to submit event applications.</p><label className="flex items-start gap-3"><input type="checkbox" checked={accepted} onChange={event => setAccepted(event.target.checked)} className="mt-1" /><span>I agree to the <Link className="underline" target="_blank" to="/terms">Terms &amp; Conditions</Link> and will provide accurate information.</span></label></div>
            {errors.terms && <p role="alert" className="text-sm text-red-700">{errors.terms}</p>}
            {errors.submit && <p role="alert" className="rounded bg-red-50 p-3 text-sm text-red-700">{errors.submit} <Link to="/reset-password" className="underline">Reset password</Link></p>}
            <button type="submit" disabled={submitting || !configured} className="btn-primary w-full">
              {submitting ? 'Creating account…' : 'Create organiser account'}
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

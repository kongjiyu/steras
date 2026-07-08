import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import toast from 'react-hot-toast';
import { AuthorityType, UserRole } from '@shared/types';

export default function RegisterPage() {
  const { signUp, configured } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<UserRole>('organizer');
  const [authorityType, setAuthorityType] = useState<AuthorityType>('PDRM');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await signUp({
        email,
        password,
        name,
        role,
        authorityType: role === 'authority' ? authorityType : undefined,
        phone: phone || undefined,
      });
      toast.success('Account created.');
      navigate(role === 'organizer' ? '/organizer' : '/authority', { replace: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Registration failed';
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="card w-full max-w-lg">
        <div className="card-body">
          <h1 className="text-2xl font-bold text-slate-900">Create your STERAS account</h1>

          {!configured && (
            <div className="mt-4 p-3 rounded bg-amber-50 border border-amber-200 text-sm text-amber-800">
              Firebase is not configured. See <code>README.md</code> → Setup.
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700">I am a…</label>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {(['organizer', 'authority'] as UserRole[]).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRole(r)}
                    className={
                      'px-3 py-2 rounded-md border text-sm font-medium ' +
                      (role === r
                        ? 'bg-brand-50 border-brand-500 text-brand-700'
                        : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50')
                    }
                  >
                    {r === 'organizer' ? 'Event Organizer' : 'Authority Reviewer'}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label htmlFor="name" className="block text-sm font-medium text-slate-700">Full name</label>
              <input id="name" required value={name} onChange={(e) => setName(e.target.value)} className="input mt-1" />
            </div>

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-slate-700">Email</label>
              <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="input mt-1" />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-slate-700">Password</label>
              <input id="password" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} className="input mt-1" />
            </div>

            {role === 'authority' && (
              <div>
                <label htmlFor="auth" className="block text-sm font-medium text-slate-700">Authority</label>
                <select
                  id="auth"
                  value={authorityType}
                  onChange={(e) => setAuthorityType(e.target.value as AuthorityType)}
                  className="input mt-1"
                >
                  {(['PDRM', 'BOMBA', 'KKM', 'DBKL', 'MOTAC'] as AuthorityType[]).map((a) => (
                    <option key={a} value={a}>{a}</option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-slate-500">
                  Note: authority accounts typically require admin approval. This is a prototype.
                </p>
              </div>
            )}

            <div>
              <label htmlFor="phone" className="block text-sm font-medium text-slate-700">Phone (optional)</label>
              <input id="phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className="input mt-1" placeholder="+60 12-345 6789" />
            </div>

            <button type="submit" disabled={submitting || !configured} className="btn-primary w-full">
              {submitting ? 'Creating account…' : 'Create account'}
            </button>
          </form>

          <p className="mt-4 text-sm text-slate-600 text-center">
            Already have an account?{' '}
            <Link to="/login" className="text-brand-600 hover:text-brand-700 font-medium">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import toast from 'react-hot-toast';
import { KeyRound, Plus, ShieldCheck, Users, X } from 'lucide-react';
import { AuthorityType, COLLECTIONS, UserProfile, UserRole } from '@shared/types';
import { db, functions, isFirebaseConfigured } from '../../config/firebase';
import { WorkspaceTopBar } from '../../components/layout/Sidebar';
import { useAuth } from '../../contexts/AuthContext';

const ROLE_BADGE: Record<UserRole, string> = {
  organizer: 'admin-badge admin-badge--default', authority: 'admin-badge admin-badge--warn',
  public: 'admin-badge admin-badge--default', admin: 'admin-badge admin-badge--good',
};
const AUTHORITIES: AuthorityType[] = ['PDRM', 'BOMBA', 'KKM', 'DBKL', 'MOTAC'];
const RESET_TEMPORARY_PASSWORD = 'Steras@Reset2026!';

function initialsFor(name?: string) {
  return name ? name.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase() : 'AD';
}

export default function AdminUsers() {
  const { profile } = useAuth();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<UserRole | 'all'>('all');
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<'authority' | 'admin'>('authority');
  const [authorityType, setAuthorityType] = useState<AuthorityType>('PDRM');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [resetTarget, setResetTarget] = useState<UserProfile | null>(null);
  const [resettingUid, setResettingUid] = useState<string | null>(null);
  const [resetIdempotencyKey, setResetIdempotencyKey] = useState(() => crypto.randomUUID());

  useEffect(() => {
    if (!isFirebaseConfigured) { setLoading(false); return undefined; }
    return onSnapshot(
      query(collection(db, COLLECTIONS.USERS), where('role', 'in', ['organizer', 'authority', 'public', 'admin'])),
      (snapshot) => { setUsers(snapshot.docs.map((document) => document.data() as UserProfile)); setLoading(false); },
      () => { toast.error('Unable to load user accounts.'); setLoading(false); },
    );
  }, []);

  const filtered = useMemo(() => filter === 'all' ? users : users.filter((user) => user.role === filter), [users, filter]);
  const counts = useMemo(() => users.reduce<Record<string, number>>((result, user) => {
    result[user.role] = (result[user.role] ?? 0) + 1; return result;
  }, {}), [users]);

  const close = () => {
    if (creating) return;
    setOpen(false); setName(''); setEmail(''); setPhone(''); setPassword('');
    setRole('authority'); setAuthorityType('PDRM'); setIdempotencyKey(crypto.randomUUID());
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setCreating(true);
    try {
      await httpsCallable(functions, 'createPrivilegedAccount')({
        name, email, password, role, idempotencyKey,
        ...(phone.trim() ? { phone } : {}), ...(role === 'authority' ? { authorityType } : {}),
      });
      toast.success(`${role === 'authority' ? authorityType + ' authority' : 'Administrator'} account created.`);
      setCreating(false); close();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to create account.'); setCreating(false);
    }
  };

  const beginPasswordReset = (user: UserProfile) => {
    setResetTarget(user);
    setResetIdempotencyKey(crypto.randomUUID());
  };

  const resetPassword = async () => {
    if (!resetTarget) return;
    setResettingUid(resetTarget.uid);
    try {
      await httpsCallable(functions, 'resetUserPassword')({
        uid: resetTarget.uid,
        idempotencyKey: resetIdempotencyKey,
      });
      toast.success(`Password reset for ${resetTarget.name}.`);
      setResetTarget(null);
      setResetIdempotencyKey(crypto.randomUUID());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to reset password.');
    } finally {
      setResettingUid(null);
    }
  };

  return (
    <div className="min-h-screen bg-[#f3f1e9] pb-16">
      <WorkspaceTopBar title="User accounts" subtitle="Create accounts and issue temporary passwords" userInitials={initialsFor(profile?.name)} workspaceEyebrow="STERAS administration" workspaceEyebrowIcon={ShieldCheck} />
      <main className="page-shell page-enter">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            {(['all', 'admin', 'authority', 'organizer', 'public'] as const).map((item) => (
              <button key={item} type="button" aria-pressed={filter === item} onClick={() => setFilter(item)} className={'min-h-9 rounded-md border px-3 text-xs font-semibold transition-colors ' + (filter === item ? 'border-brand-600 bg-brand-600 text-white' : 'border-ink-200 bg-white text-ink-700 hover:bg-cream-50')}>
                {item === 'all' ? `All (${users.length})` : `${item} (${counts[item] ?? 0})`}
              </button>
            ))}
          </div>
          <button type="button" className="btn-primary min-h-11" onClick={() => setOpen(true)}><Plus size={16} /> Create privileged account</button>
        </div>
        <section className="overflow-x-auto rounded-lg border border-[#ded5c5] bg-white shadow-card"><div className="min-w-[860px]">
          <header className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,2fr)_8rem_9rem_9rem] gap-3 border-b border-[#e8e0cf] bg-cream-50 px-4 py-2.5 text-[11px] font-bold uppercase tracking-[0.06em] text-ink-500"><span>Name</span><span>Email</span><span>Role</span><span>Authority</span><span>Account access</span></header>
          {loading ? <p className="p-5 text-sm text-ink-500">Loading users…</p> : filtered.length === 0 ? <div className="flex flex-col items-center gap-2 p-10 text-center"><Users size={28} className="text-ink-400" /><p className="text-sm text-ink-500">No users match the current filter.</p></div> : <ul className="divide-y divide-[#e8e0cf]">{filtered.map((user) => (
            <li key={user.uid}>
              <div className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,2fr)_8rem_9rem_9rem] items-center gap-3 px-4 py-3 text-sm">
                <span className="font-semibold text-ink-900">{user.name}</span>
                <span className="truncate text-ink-700">{user.email}</span>
                <span className={ROLE_BADGE[user.role]}>{user.role}</span>
                <span className="text-ink-600">{user.authorityType ?? '—'}</span>
                <button
                  type="button"
                  className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md border border-[#cfc3ad] bg-white px-3 text-xs font-semibold text-brand-700 transition-colors hover:border-brand-400 hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
                  aria-expanded={resetTarget?.uid === user.uid}
                  onClick={() => resetTarget?.uid === user.uid ? setResetTarget(null) : beginPasswordReset(user)}
                >
                  <KeyRound size={14} /> Reset password
                </button>
              </div>
              {resetTarget?.uid === user.uid && (
                <div className="border-t border-[#eee7d9] bg-gold-50/70 px-4 py-4" role="region" aria-label={`Reset password for ${user.name}`}>
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-semibold text-ink-900">Issue a new temporary password?</p>
                      <p className="mt-1 text-sm leading-6 text-ink-600">
                        {user.name} will sign in with <code className="rounded bg-white px-1.5 py-1 font-semibold text-ink-900">{RESET_TEMPORARY_PASSWORD}</code>. Existing sessions will be revoked.
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <button type="button" className="btn-secondary" disabled={resettingUid === user.uid} onClick={() => setResetTarget(null)}>Cancel</button>
                      <button type="button" className="btn-primary" disabled={resettingUid === user.uid} onClick={resetPassword}>
                        {resettingUid === user.uid ? 'Resetting…' : 'Confirm reset'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </li>
          ))}</ul>}
        </div></section>
        <p className="mt-3 text-xs leading-5 text-ink-500">Account creation and password resets are restricted to authorised administrators. Passwords are sent directly to Firebase Authentication and are never stored in Firestore; reset actions are recorded in the administrative audit trail.</p>
      </main>

      {open && <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="create-account-title"><form onSubmit={submit} className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-xl border border-ink-200 bg-white p-5 shadow-xl sm:p-6">
        <div className="flex items-start justify-between gap-4"><div><h2 id="create-account-title" className="font-display text-xl font-bold text-ink-900">Create privileged account</h2><p className="mt-1 text-sm text-ink-500">The account can sign in immediately with the temporary password.</p></div><button type="button" className="rounded p-2 text-ink-500 hover:bg-cream-50" aria-label="Close" onClick={close}><X size={20} /></button></div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="field-label">Role<select className="input mt-1" value={role} onChange={(event) => setRole(event.target.value as 'authority' | 'admin')}><option value="authority">Authority officer</option><option value="admin">Administrator</option></select></label>
          {role === 'authority' ? <label className="field-label">Authority<select className="input mt-1" value={authorityType} onChange={(event) => setAuthorityType(event.target.value as AuthorityType)}>{AUTHORITIES.map((item) => <option key={item}>{item}</option>)}</select></label> : <div className="rounded-md border border-gold-200 bg-gold-50 p-3 text-xs leading-5 text-gold-800">Administrators receive access to all Admin workspace functions.</div>}
          <label className="field-label sm:col-span-2">Full name<input className="input mt-1" autoComplete="name" minLength={2} maxLength={100} required value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label className="field-label">Email<input className="input mt-1" type="email" autoComplete="email" maxLength={254} required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label className="field-label">Phone (optional)<input className="input mt-1" autoComplete="tel" maxLength={30} value={phone} onChange={(event) => setPhone(event.target.value)} /></label>
          <label className="field-label sm:col-span-2">Temporary password<input className="input mt-1" type="password" minLength={12} maxLength={128} autoComplete="new-password" required value={password} onChange={(event) => setPassword(event.target.value)} /><span className="mt-1 block text-xs font-normal text-ink-500">At least 12 characters with upper-case, lower-case, number and symbol.</span></label>
        </div>
        <div className="mt-6 flex justify-end gap-3"><button type="button" className="btn-secondary" disabled={creating} onClick={close}>Cancel</button><button type="submit" className="btn-primary" disabled={creating}>{creating ? 'Creating…' : 'Create account'}</button></div>
      </form></div>}
    </div>
  );
}

import { FormEvent, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { Link } from 'react-router-dom';
import { functions } from '../../config/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { normalizePhone, validPersonName } from '@shared/accountValidation';

export default function ProfilePage() {
  const { profile, refreshProfile } = useAuth();
  const [name, setName] = useState(profile?.name ?? '');
  const [phone, setPhone] = useState(profile?.phone ?? '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!validPersonName(name) || !normalizePhone(phone)) { setMessage('Enter a valid full name and phone number.'); return; }
    setBusy(true); setMessage('');
    try { await httpsCallable(functions, 'updateOwnProfile')({ name: name.trim(), phone: normalizePhone(phone) }); await refreshProfile(); setMessage('Profile saved. New submissions will use these details.'); }
    catch { setMessage('Your profile could not be saved. Please retry.'); }
    finally { setBusy(false); }
  }
  return <section className="card mx-auto max-w-2xl p-6"><p className="page-eyebrow">Your account</p><h1 className="font-display text-2xl font-bold">Profile</h1><form className="mt-6 space-y-5" onSubmit={save}><label className="block"><span className="field-label">Full name</span><input className="input" required value={name} onChange={event => setName(event.target.value)} /></label><label className="block"><span className="field-label">Email address</span><input className="input" readOnly value={profile?.email ?? ''} /></label><label className="block"><span className="field-label">Phone number</span><input className="input" type="tel" required value={phone} onChange={event => setPhone(event.target.value)} /></label>{message && <p role="status" className="rounded bg-brand-50 p-3 text-sm">{message}</p>}<button disabled={busy} className="btn-primary">{busy ? 'Saving…' : 'Save profile'}</button></form><Link to="/reset-password" className="mt-6 inline-block font-semibold text-brand-700">Reset password by email</Link></section>;
}

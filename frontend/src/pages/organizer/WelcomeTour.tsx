import { useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { functions } from '../../config/firebase';

const steps = [
  ['Start an application', 'Choose your Core and scenario templates, upload the completed documents, then review the extracted details.', '/organizer/events/new'],
  ['My events', 'Return to saved drafts and follow the current review stage of each submitted application.', '/organizer/events'],
  ['Notifications', 'Read application updates below. Use All, Unread and Read to keep track of decisions and requests.', '/organizer'],
  ['Your profile', 'Keep your name and phone up to date. New applications use the identity linked to this account.', '/organizer/profile'],
] as const;

export default function WelcomeTour() {
  const { profile, refreshProfile } = useAuth();
  const [open, setOpen] = useState(!profile?.onboardingCompleted);
  const [step, setStep] = useState(-1);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function finish() {
    setBusy(true);
    try { await httpsCallable(functions, 'updateOwnProfile')({ onboardingCompleted: true }); await refreshProfile(); setOpen(false); }
    catch { setError('Could not save your tour preference. Please retry.'); }
    finally { setBusy(false); }
  }
  if (!open) return <button className="mb-5 text-sm font-semibold text-brand-700 underline" onClick={() => { setStep(-1); setOpen(true); }}>Show welcome guide</button>;
  return <section aria-label="Welcome guide" className="page-enter mb-6 rounded-xl border border-brand-200 bg-brand-50 p-6"><p className="page-eyebrow">{step < 0 ? 'Welcome to STERAS' : `Your workspace · ${step + 1} of ${steps.length}`}</p><h2 className="font-display text-2xl font-bold">{step < 0 ? `Welcome, ${profile?.name ?? 'organiser'}` : steps[step][0]}</h2><p className="mt-3 max-w-2xl text-sm leading-6">{step < 0 ? 'A quick guide will show you where to prepare an application, follow decisions and manage your account.' : steps[step][1]}</p>{error && <p role="alert" className="mt-3 text-red-700">{error}</p>}<div className="mt-5 flex flex-wrap gap-3">{step >= 0 && <button className="btn-secondary" onClick={() => setStep(value => value - 1)}>Back</button>}{step < steps.length - 1 ? <button className="btn-primary" onClick={() => setStep(value => value + 1)}>{step < 0 ? 'Click to start' : 'Next'}</button> : <button disabled={busy} className="btn-primary" onClick={() => void finish()}>Finish guide</button>}<button disabled={busy} className="btn-secondary" onClick={() => void finish()}>Skip guide</button>{step >= 0 && <Link className="btn-secondary" to={steps[step][2]}>Open {steps[step][0]}</Link>}</div></section>;
}

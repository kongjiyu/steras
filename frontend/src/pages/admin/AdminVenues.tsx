import { useEffect, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db, isFirebaseConfigured } from '../../config/firebase';
import { COLLECTIONS } from '@shared/types';
import { WorkspaceTopBar } from '../../components/layout/Sidebar';
import { useAuth } from '../../contexts/AuthContext';
import { MapPin, ShieldCheck } from 'lucide-react';

interface VenueRow {
  venueId: string;
  name: string;
  address: string;
  capacity: number;
  verifiedSafeCapacity?: number;
  jurisdiction?: string;
  fireCertificateStatus?: string;
}

function initialsFor(name?: string) {
  if (!name) return 'AD';
  return name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
}

export default function AdminVenues() {
  const { profile } = useAuth();
  const [venues, setVenues] = useState<VenueRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isFirebaseConfigured) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDocs(collection(db, COLLECTIONS.VENUES));
        if (cancelled) return;
        setVenues(snap.docs.map((d) => d.data() as VenueRow));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="min-h-screen bg-[#f3f1e9] pb-16">
      <WorkspaceTopBar
        title="Venues"
        subtitle="M1 — venue database (FR-M1-21: admin can create, update, verify, deactivate, view venues)"
        userInitials={initialsFor(profile?.name)}
        workspaceEyebrow="STERAS administration"
        workspaceEyebrowIcon={ShieldCheck}
      />
      <main className="page-shell page-enter">
        <section className="overflow-hidden rounded-lg border border-[#ded5c5] bg-white shadow-card">
          <header className="grid grid-cols-[minmax(0,2fr)_minmax(0,2.5fr)_7rem_8rem_8rem] gap-3 border-b border-[#e8e0cf] bg-cream-50 px-4 py-2.5 text-[11px] font-bold uppercase tracking-[0.06em] text-ink-500">
            <span>Venue</span>
            <span>Address</span>
            <span>Capacity</span>
            <span>Verified</span>
            <span>Fire cert</span>
          </header>
          {loading ? (
            <p className="p-5 text-sm text-ink-500">Loading venues…</p>
          ) : venues.length === 0 ? (
            <div className="flex flex-col items-center gap-2 p-10 text-center">
              <MapPin size={28} className="text-ink-400" />
              <p className="text-sm text-ink-500">No venues in the database yet.</p>
            </div>
          ) : (
            <ul className="divide-y divide-[#e8e0cf]">
              {venues.map((v) => (
                <li key={v.venueId} className="grid grid-cols-[minmax(0,2fr)_minmax(0,2.5fr)_7rem_8rem_8rem] items-center gap-3 px-4 py-3 text-sm">
                  <span className="font-semibold text-ink-900">{v.name}</span>
                  <span className="truncate text-ink-700">{v.address}</span>
                  <span className="text-ink-800">{v.capacity.toLocaleString()}</span>
                  <span className="text-ink-700">{(v.verifiedSafeCapacity ?? 0).toLocaleString()}</span>
                  <span className="admin-badge admin-badge--good text-xs">{v.fireCertificateStatus ?? 'unknown'}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <p className="mt-3 text-xs text-ink-500">
          Create / update / verify / deactivate actions are stubbed in this build. Future work:
          full FR-M1-21 implementation.
        </p>
      </main>
    </div>
  );
}

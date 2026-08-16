import { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db, isFirebaseConfigured } from '../../config/firebase';
import { COLLECTIONS, UserProfile, UserRole } from '@shared/types';
import { WorkspaceTopBar } from '../../components/layout/Sidebar';
import { useAuth } from '../../contexts/AuthContext';
import { Users, ShieldCheck, ShieldAlert } from 'lucide-react';

const ROLE_BADGE: Record<UserRole, string> = {
  organizer: 'admin-badge admin-badge--default',
  authority: 'admin-badge admin-badge--warn',
  public: 'admin-badge admin-badge--default',
  admin: 'admin-badge admin-badge--good',
};

function initialsFor(name?: string) {
  if (!name) return 'AD';
  return name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
}

export default function AdminUsers() {
  const { profile } = useAuth();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<UserRole | 'all'>('all');

  useEffect(() => {
    if (!isFirebaseConfigured) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDocs(query(collection(db, COLLECTIONS.USERS), where('role', 'in', ['organizer', 'authority', 'public', 'admin'])));
        if (cancelled) return;
        setUsers(snap.docs.map((d) => d.data() as UserProfile));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() =>
    filter === 'all' ? users : users.filter((u) => u.role === filter),
  [users, filter]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const u of users) c[u.role] = (c[u.role] ?? 0) + 1;
    return c;
  }, [users]);

  return (
    <div className="min-h-screen bg-[#f3f1e9] pb-16">
      <WorkspaceTopBar
        title="User accounts"
        subtitle="M1 — view all registered accounts (organisers, authorities, public viewers, admins)"
        userInitials={initialsFor(profile?.name)}
        workspaceEyebrow="STERAS administration"
        workspaceEyebrowIcon={ShieldCheck}
      />
      <main className="page-shell page-enter">
        {/* Role filter chips */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {(['all', 'admin', 'authority', 'organizer', 'public'] as const).map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={filter === r}
              onClick={() => setFilter(r)}
              className={
                'min-h-9 rounded-md border px-3 text-xs font-semibold transition-colors ' +
                (filter === r
                  ? 'border-brand-600 bg-brand-600 text-white'
                  : 'border-ink-200 bg-white text-ink-700 hover:bg-cream-50')
              }
            >
              {r === 'all' ? `All (${users.length})` : `${r} (${counts[r] ?? 0})`}
            </button>
          ))}
        </div>

        <section className="overflow-hidden rounded-lg border border-[#ded5c5] bg-white shadow-card">
          <header className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,2fr)_8rem_10rem] gap-3 border-b border-[#e8e0cf] bg-cream-50 px-4 py-2.5 text-[11px] font-bold uppercase tracking-[0.06em] text-ink-500">
            <span>Name</span>
            <span>Email</span>
            <span>Role</span>
            <span>Authority</span>
          </header>
          {loading ? (
            <p className="p-5 text-sm text-ink-500">Loading users…</p>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-2 p-10 text-center">
              <Users size={28} className="text-ink-400" />
              <p className="text-sm text-ink-500">No users match the current filter.</p>
            </div>
          ) : (
            <ul className="divide-y divide-[#e8e0cf]">
              {filtered.map((u) => (
                <li key={u.uid} className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,2fr)_8rem_10rem] items-center gap-3 px-4 py-3 text-sm">
                  <span className="font-semibold text-ink-900">{u.name}</span>
                  <span className="truncate text-ink-700">{u.email}</span>
                  <span className={ROLE_BADGE[u.role]}>{u.role}</span>
                  <span className="text-ink-600">{u.authorityType ?? '—'}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <p className="mt-3 text-xs text-ink-500">
          Create / edit / suspend actions are stubbed in this build. Future work: per FR-M1-03
          (admin-only authority/admin account creation).
        </p>
      </main>
    </div>
  );
}

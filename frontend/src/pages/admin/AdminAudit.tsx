import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { collection, getDocs, limit, orderBy, query, where } from 'firebase/firestore';
import { History, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import { COLLECTIONS, EventRecord, UserProfile, Venue } from '@shared/types';
import { WorkspaceTopBar } from '../../components/layout/Sidebar';
import EmptyState from '../../components/ui/EmptyState';
import { db, isFirebaseConfigured } from '../../config/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { userFacingSystemText } from '../../utils/userFacingText';
import { ADMIN_VISIBLE_EVENT_STATUSES } from './adminApplicationVisibility';

type AuditSource = 'application' | 'venue' | 'account';

interface AuditRow {
  id: string;
  action: string;
  actorId: string;
  actorRole?: string;
  timestamp: number;
  source: AuditSource;
  eventId?: string;
  venueId?: string;
  targetId?: string;
  notes?: string;
  previousStatus?: string;
  newStatus?: string;
  metadata?: Record<string, unknown>;
}

function initialsFor(name?: string) {
  if (!name) return 'AD';
  return name.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase();
}

export default function AdminAudit() {
  const { profile } = useAuth();
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [events, setEvents] = useState<Record<string, EventRecord>>({});
  const [venues, setVenues] = useState<Record<string, Venue>>({});
  const [users, setUsers] = useState<Record<string, UserProfile>>({});
  const [source, setSource] = useState<AuditSource | 'all'>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (!isFirebaseConfigured) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [eventSnapshot, venueSnapshot, userSnapshot, accountAuditSnapshot] = await Promise.all([
          getDocs(query(
            collection(db, COLLECTIONS.EVENTS),
            where('status', 'in', ADMIN_VISIBLE_EVENT_STATUSES),
            orderBy('updatedAt', 'desc'),
            limit(100),
          )),
          getDocs(collection(db, COLLECTIONS.VENUES)),
          getDocs(collection(db, COLLECTIONS.USERS)),
          getDocs(query(collection(db, COLLECTIONS.ADMIN_AUDIT_LOGS), orderBy('timestamp', 'desc'), limit(100))),
        ]);

        const eventRecords = Object.fromEntries(eventSnapshot.docs.map((item) => [
          item.id,
          { eventId: item.id, ...item.data() } as EventRecord,
        ]));
        const venueRecords = Object.fromEntries(venueSnapshot.docs.map((item) => [
          item.id,
          { venueId: item.id, ...item.data() } as Venue,
        ]));
        const userRecords = Object.fromEntries(userSnapshot.docs.map((item) => [
          item.id,
          item.data() as UserProfile,
        ]));

        const [eventAudits, venueAudits] = await Promise.all([
          Promise.all(eventSnapshot.docs.map(async (eventDocument) => {
            const snapshot = await getDocs(query(
              collection(eventDocument.ref, COLLECTIONS.AUDIT_LOGS),
              orderBy('timestamp', 'desc'),
              limit(50),
            ));
            return snapshot.docs.map((item) => toAuditRow(item.id, item.data(), 'application', eventDocument.id));
          })),
          Promise.all(venueSnapshot.docs.map(async (venueDocument) => {
            const snapshot = await getDocs(query(
              collection(venueDocument.ref, COLLECTIONS.AUDIT_LOGS),
              orderBy('timestamp', 'desc'),
              limit(30),
            ));
            return snapshot.docs.map((item) => toAuditRow(item.id, item.data(), 'venue', venueDocument.id));
          })),
        ]);

        const nextRows = [
          ...eventAudits.flat(),
          ...venueAudits.flat(),
          ...accountAuditSnapshot.docs.map((item) => toAuditRow(item.id, item.data(), 'account')),
        ].sort((left, right) => right.timestamp - left.timestamp).slice(0, 500);

        if (cancelled) return;
        setEvents(eventRecords);
        setVenues(venueRecords);
        setUsers(userRecords);
        setRows(nextRows);
        setError('');
        setLoading(false);
      } catch (loadError) {
        if (cancelled) return;
        console.error('[AdminAudit] load failed', loadError);
        setError('The audit trail could not be loaded. Check the connection and try again.');
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [retryKey]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (source !== 'all' && row.source !== source) return false;
      if (!term) return true;
      const eventName = row.eventId ? events[row.eventId]?.eventDetails.name : '';
      const venueName = row.venueId ? venues[row.venueId]?.name : '';
      const actorName = users[row.actorId]?.name ?? actorLabel(row, users);
      return [actionLabel(row.action), eventName, venueName, actorName, row.notes]
        .some((value) => value?.toLowerCase().includes(term));
    });
  }, [events, rows, search, source, users, venues]);

  return (
    <div className="min-h-screen bg-[#f3f1e9] pb-16">
      <WorkspaceTopBar
        title="Audit log"
        subtitle="System-wide history of application, venue and account activity"
        userInitials={initialsFor(profile?.name)}
        workspaceEyebrow="STERAS administration"
        workspaceEyebrowIcon={ShieldCheck}
      />
      <main className="page-shell page-enter">
        <section className="mb-5 grid gap-3 border-y border-[#ded4c1] py-4 md:grid-cols-[minmax(0,1fr)_auto]">
          <label className="relative block">
            <span className="sr-only">Search audit trail</span>
            <Search className="pointer-events-none absolute left-3 top-3.5 text-ink-400" size={17} />
            <input type="search" className="input min-h-11 !pl-10" placeholder="Search action, record or person" value={search} onChange={(event) => setSearch(event.target.value)} />
          </label>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filter audit trail by record type">
            {(['all', 'application', 'venue', 'account'] as const).map((value) => (
              <button key={value} type="button" aria-pressed={source === value} className={`min-h-11 rounded-md border px-3 text-sm font-semibold capitalize ${source === value ? 'border-brand-600 bg-brand-600 text-white' : 'border-ink-200 bg-white text-ink-700 hover:bg-cream-50'}`} onClick={() => setSource(value)}>
                {value === 'all' ? 'All records' : value}
              </button>
            ))}
          </div>
        </section>

        {loading ? (
          <div className="py-20 text-center text-sm text-ink-500">Loading audit trail…</div>
        ) : error ? (
          <EmptyState title="Audit trail unavailable" description={error}>
            <button type="button" className="btn-secondary" onClick={() => { setLoading(true); setRetryKey((value) => value + 1); }}><RefreshCw size={16} /> Try again</button>
          </EmptyState>
        ) : filtered.length === 0 ? (
          <EmptyState title="No matching activity" description={rows.length === 0 ? 'No administrative activity has been recorded yet.' : 'Try another search or record type.'} />
        ) : (
          <section className="overflow-hidden rounded-lg border border-[#ded5c5] bg-white shadow-card" aria-label="Audit trail results">
            <div className="flex items-center justify-between gap-3 border-b border-[#e8e0cf] bg-cream-50 px-4 py-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-ink-800"><History size={17} /> Recorded activity</div>
              <span className="text-xs text-ink-500">{filtered.length} result{filtered.length === 1 ? '' : 's'}</span>
            </div>
            <ol className="divide-y divide-[#e8e0cf]">
              {filtered.map((row) => {
                const eventRecord = row.eventId ? events[row.eventId] : undefined;
                const venueRecord = row.venueId ? venues[row.venueId] : undefined;
                const subject = eventRecord?.eventDetails.name ?? venueRecord?.name ?? accountTargetLabel(row, users);
                const summary = auditSummary(row, users);
                return (
                  <li key={`${row.source}-${row.eventId ?? row.venueId ?? row.targetId ?? 'system'}-${row.id}`} className="grid gap-3 px-4 py-4 sm:grid-cols-[10rem_minmax(0,1fr)_12rem] sm:px-5">
                    <div><span className="admin-badge admin-badge--default capitalize">{row.source}</span><p className="mt-2 text-xs text-ink-500">{formatTimestamp(row.timestamp)}</p></div>
                    <div className="min-w-0">
                      <p className="font-display text-sm font-bold text-ink-900">{actionLabel(row.action)}</p>
                      <p className="mt-1 text-sm text-ink-700">{row.eventId && eventRecord ? <Link className="font-semibold text-brand-700 hover:underline" to={`/admin/applications/${row.eventId}`}>{subject}</Link> : subject}</p>
                      {summary && <p className="mt-1 text-xs leading-5 text-ink-500">{summary}</p>}
                    </div>
                    <div className="sm:text-right"><p className="text-xs font-semibold text-ink-700">{actorLabel(row, users)}</p><p className="mt-1 text-xs capitalize text-ink-500">{row.actorRole?.replaceAll('_', ' ') ?? 'System activity'}</p></div>
                  </li>
                );
              })}
            </ol>
          </section>
        )}
      </main>
    </div>
  );
}

function toAuditRow(id: string, value: Record<string, unknown>, source: AuditSource, parentId?: string): AuditRow {
  return {
    id,
    action: typeof value.action === 'string' ? value.action : 'activity_recorded',
    actorId: typeof value.actorId === 'string' ? value.actorId : 'system',
    actorRole: typeof value.actorRole === 'string' ? value.actorRole : undefined,
    timestamp: typeof value.timestamp === 'number' && Number.isFinite(value.timestamp) ? value.timestamp : 0,
    source,
    eventId: source === 'application' ? (typeof value.eventId === 'string' ? value.eventId : parentId) : undefined,
    venueId: source === 'venue' ? (typeof value.venueId === 'string' ? value.venueId : parentId) : undefined,
    targetId: typeof value.targetId === 'string' ? value.targetId : undefined,
    notes: typeof value.notes === 'string' ? value.notes : undefined,
    previousStatus: typeof value.previousStatus === 'string' ? value.previousStatus : undefined,
    newStatus: typeof value.newStatus === 'string' ? value.newStatus : undefined,
    metadata: isRecord(value.metadata) ? value.metadata : undefined,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function actionLabel(value: string): string {
  const words = userFacingSystemText(value)
    .replaceAll('_', ' ')
    .replaceAll('-', ' ')
    .replace(/\bstage\s*([12])\b/gi, 'Stage $1')
    .trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Activity recorded';
}

function actorLabel(row: AuditRow, users: Record<string, UserProfile>): string {
  if (row.actorId === 'system') return 'Automated service';
  return users[row.actorId]?.name ?? 'Former or system account';
}

function accountTargetLabel(row: AuditRow, users: Record<string, UserProfile>): string {
  if (row.source !== 'account') return 'Administrative record';
  return row.targetId ? users[row.targetId]?.name ?? 'User account' : 'User account';
}

function auditSummary(row: AuditRow, users: Record<string, UserProfile>): string {
  if (row.notes) return replaceKnownUserIds(userFacingSystemText(row.notes), users);
  if (row.previousStatus || row.newStatus) return `${row.previousStatus ?? 'Previous state'} → ${row.newStatus ?? 'Updated state'}`;
  const decision = row.metadata?.finalDecision ?? row.metadata?.decision;
  if (typeof decision === 'string') return `Decision: ${userFacingSystemText(decision.replaceAll('_', ' '))}`;
  return '';
}

function replaceKnownUserIds(value: string, users: Record<string, UserProfile>): string {
  return Object.values(users).reduce(
    (text, user) => user.uid && text.includes(user.uid) ? text.replaceAll(user.uid, user.name) : text,
    value,
  );
}

function formatTimestamp(timestamp: number): string {
  if (!timestamp) return 'Time unavailable';
  return new Date(timestamp).toLocaleString('en-MY', { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

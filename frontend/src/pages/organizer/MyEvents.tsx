import { Fragment, type FormEvent, useEffect, useMemo, useState } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { db, functions, isFirebaseConfigured } from '../../config/firebase';
import { COLLECTIONS, EventRecord } from '@shared/types';
import { resolveApplicationDisplayState } from '@shared/applicationState';
import { useAuth } from '../../contexts/AuthContext';
import PageHeader from '../../components/ui/PageHeader';
import EmptyState from '../../components/ui/EmptyState';
import { format } from 'date-fns';
import { ArrowRight, CalendarPlus, MapPin, Trash2 } from 'lucide-react';
import OrganizerStatusBadge from './OrganizerStatusBadge';
import { applicationStatusLabel, assessmentLabel, isEditableApplicationStatus, ORGANIZER_STATUS_FILTERS, organizerAdminDecisionLabel, organizerPublicationLabel, organizerPublicationStateFromProjection, OrganizerStatusFilter } from './organizerApplication';
import { mockEvents } from '../../mock_data/events';
import { mockPublicEvents } from '../../mock_data/public_events';

type TimeFilter = 'all' | 'current' | 'upcoming' | 'past';

export function eventTimeGroup(event: EventRecord, now = Date.now()): Exclude<TimeFilter, 'all'> {
  const start = event.eventDetails.startDatetime;
  const end = event.eventDetails.endDatetime;
  if (start > 0 && start > now) return 'upcoming';
  if (end > 0 && end < now) return 'past';
  return 'current';
}

const TIME_LABELS: Record<Exclude<TimeFilter, 'all'>, string> = {
  current: 'Ongoing & unscheduled',
  upcoming: 'Upcoming',
  past: 'Past',
};

const DELETE_CONFIRMATION = 'DELETE';

interface DeleteDraftApplicationResponse {
  eventId: string;
  deleted: true;
  alreadyDeleted: boolean;
}

export default function MyEvents() {
  const { user } = useAuth();
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<OrganizerStatusFilter>(() => {
    const value = new URLSearchParams(window.location.search).get('status');
    return ORGANIZER_STATUS_FILTERS.includes(value as OrganizerStatusFilter) ? value as OrganizerStatusFilter : 'all';
  });
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all');
  const [search, setSearch] = useState(() => new URLSearchParams(window.location.search).get('q') ?? '');
  const [error, setError] = useState('');
  const [retryKey, setRetryKey] = useState(0);
  const [publicProjections, setPublicProjections] = useState<Map<string, unknown>>(new Map());
  const [publicationLoadState, setPublicationLoadState] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [deleteTarget, setDeleteTarget] = useState<EventRecord | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [deletingEventId, setDeletingEventId] = useState<string | null>(null);

  useEffect(() => {
    if (!isFirebaseConfigured || !user) {
      if (!isFirebaseConfigured && user) {
        setEvents(mockEvents
          .filter((event) => event.organizerId === user.uid)
          .sort((a, b) => b.createdAt - a.createdAt));
      }
      setLoading(false);
      return;
    }
    const q = query(
      collection(db, COLLECTIONS.EVENTS),
      where('organizerId', '==', user.uid),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setEvents(snap.docs
          .map((d) => ({ eventId: d.id, ...d.data() }) as EventRecord)
          .sort((a, b) => b.createdAt - a.createdAt));
        setError('');
        setLoading(false);
      },
      (err) => {
        console.warn('[MyEvents] Snapshot error:', err);
        setError('Your applications could not be loaded.');
        setLoading(false);
      },
    );
    return () => unsub();
  }, [user, retryKey]);

  useEffect(() => {
    if (!isFirebaseConfigured) {
      setPublicProjections(new Map(mockPublicEvents.map((event) => [event.eventId, event])));
      setPublicationLoadState('ready');
      return;
    }
    setPublicationLoadState('loading');
    return onSnapshot(collection(db, COLLECTIONS.PUBLIC_EVENTS), (snapshot) => {
      setPublicProjections(new Map(snapshot.docs.map((document) => [document.id, document.data()])));
      setPublicationLoadState('ready');
    }, () => {
      setPublicProjections(new Map());
      setPublicationLoadState('unavailable');
    });
  }, [retryKey]);

  const publicationStateFor = (event: EventRecord) => publicationLoadState === 'loading'
    ? 'loading' as const
    : publicationLoadState === 'unavailable'
      ? 'unavailable' as const
      : organizerPublicationStateFromProjection(publicProjections.get(event.eventId), event.eventId, event.currentVersionId);

  const filtered = useMemo(() => {
    const queryText = search.trim().toLocaleLowerCase();
    return events.filter((event) => {
      const displayState = resolveApplicationDisplayState(event);
      const matchesState = filter === 'all' || displayState === filter;
      const searchable = [event.eventId, event.eventDetails.name, event.eventDetails.venueName, event.eventDetails.type]
        .filter(Boolean).join(' ').toLocaleLowerCase();
      return matchesState && (!queryText || searchable.includes(queryText));
    });
  }, [events, filter, search]);
  const timeFiltered = timeFilter === 'all' ? filtered : filtered.filter(event => eventTimeGroup(event) === timeFilter);
  const groupOrder: Record<Exclude<TimeFilter, 'all'>, number> = { current: 0, upcoming: 1, past: 2 };
  const ordered = [...timeFiltered].sort((left, right) => {
    const groupDifference = groupOrder[eventTimeGroup(left)] - groupOrder[eventTimeGroup(right)];
    if (groupDifference) return groupDifference;
    return timeFilter === 'past'
      ? right.eventDetails.endDatetime - left.eventDetails.endDatetime
      : left.eventDetails.startDatetime - right.eventDetails.startDatetime;
  });

  const openDeleteDialog = (event: EventRecord) => {
    setDeleteTarget(event);
    setDeleteConfirmation('');
    setDeleteError('');
  };

  const closeDeleteDialog = () => {
    if (deletingEventId) return;
    setDeleteTarget(null);
    setDeleteConfirmation('');
    setDeleteError('');
  };

  const handleDeleteDraft = async (submitEvent: FormEvent<HTMLFormElement>) => {
    submitEvent.preventDefault();
    if (!deleteTarget || deleteConfirmation !== DELETE_CONFIRMATION || deletingEventId) return;

    const target = deleteTarget;
    setDeleteError('');
    setDeletingEventId(target.eventId);
    try {
      if (!isFirebaseConfigured) throw new Error('Firebase is not configured. Draft deletion is disabled.');
      const command = httpsCallable<{ eventId: string }, DeleteDraftApplicationResponse>(functions, 'deleteDraftApplication');
      await command({ eventId: target.eventId });
      setEvents((current) => current.filter((event) => event.eventId !== target.eventId));
      setDeleteTarget(null);
      setDeleteConfirmation('');
      toast.success('Draft deleted permanently.');
    } catch (error) {
      setDeleteError(deleteDraftErrorMessage(error));
    } finally {
      setDeletingEventId(null);
    }
  };

  return (
    <div>
      <PageHeader
        title="My Events"
        description="Your submitted events and their latest review status. Updates appear automatically as each review progresses."
        action={
          <Link to="/organizer/events/new" className="btn-primary"><CalendarPlus size={17} />New event</Link>
        }
      />

      <div className="mb-6 flex gap-2 overflow-x-auto border-b border-[#ded5c5] pb-3" aria-label="Filter applications by status">
        {ORGANIZER_STATUS_FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => {
              setFilter(f);
              const params = new URLSearchParams(window.location.search);
              if (f === 'all') params.delete('status'); else params.set('status', f);
              window.history.replaceState(null, '', `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}`);
            }}
            aria-pressed={filter === f}
            className={
              'min-h-10 shrink-0 rounded-md px-3 py-2 text-sm font-semibold ' +
              (filter === f ? 'bg-brand-700 text-cream-50' : 'border border-[#d8cebd] bg-[#fffdf8] text-ink-600 hover:bg-cream-100')
            }
          >
            {f === 'all' ? 'All' : applicationStatusLabel(f)}
          </button>
        ))}
      </div>

      <div className="mb-6">
        <label className="relative block">
          <span className="sr-only">Search events</span>
          <input
            type="search"
            className="input min-h-11 w-full"
            placeholder="Search event, application ID, venue, or type"
            value={search}
            onChange={(event) => {
              const value = event.target.value;
              setSearch(value);
              const params = new URLSearchParams(window.location.search);
              if (value.trim()) params.set('q', value); else params.delete('q');
              window.history.replaceState(null, '', `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}`);
            }}
            aria-label="Search events"
          />
        </label>
      </div>

      <div className="sticky top-20 z-10 mb-6 flex gap-1 overflow-x-auto rounded-lg border border-[#ded5c5] bg-[#fffdf8]/95 p-1 shadow-sm backdrop-blur" aria-label="Filter events by time">
        {(['all', 'current', 'upcoming', 'past'] as TimeFilter[]).map(value => <button key={value} type="button" aria-pressed={timeFilter === value} onClick={() => setTimeFilter(value)} className={`min-h-10 shrink-0 rounded-md px-4 text-sm font-semibold ${timeFilter === value ? 'bg-brand-700 text-white' : 'text-ink-600 hover:bg-cream-100'}`}>{value === 'all' ? 'All dates' : TIME_LABELS[value]}</button>)}
      </div>

      {loading ? (
        <div className="card"><div className="card-body text-center text-ink-500">Loading applications…</div></div>
      ) : error ? (
        <EmptyState title="Applications unavailable" description={error}><button type="button" className="btn-secondary" onClick={() => { setLoading(true); setRetryKey((value) => value + 1); }}>Try again</button></EmptyState>
      ) : timeFiltered.length === 0 ? (
        <EmptyState
          title={filter === 'all' ? 'No events yet' : `No events with status "${applicationStatusLabel(filter)}"`}
          description={filter === 'all' ? 'Submit your first event application to get started.' : 'Choose another status to view your other applications.'}
          children={<Link to="/organizer/events/new" className="btn-primary"><CalendarPlus size={17} />New event</Link>}
        />
      ) : (
        <div>
          <div className="hidden overflow-hidden rounded-lg border border-[#ded5c5] bg-[#fffdf8] md:block">
          <table className="w-full text-sm">
            <thead className="bg-cream-100/70 text-left">
              <tr>
                <th className="px-4 py-3 font-semibold text-ink-600">Event</th>
                <th className="px-4 py-3 font-semibold text-ink-600">Version</th>
                <th className="px-4 py-3 font-semibold text-ink-600">Review</th>
                <th className="px-4 py-3 font-semibold text-ink-600">Date</th>
                <th className="px-4 py-3 font-semibold text-ink-600">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e3dacb]">
              {ordered.map((e, index) => {
                const group = eventTimeGroup(e);
                const showGroup = index === 0 || eventTimeGroup(ordered[index - 1]) !== group;
                return <Fragment key={e.eventId}>{showGroup && <tr><th colSpan={6} className="border-y border-[#d8cebd] bg-cream-50 px-4 py-2 text-left text-xs font-bold uppercase tracking-[0.08em] text-brand-700">{TIME_LABELS[group]}</th></tr>}<tr className={`transition-colors hover:bg-cream-50 ${new URLSearchParams(window.location.search).get('highlight') === e.eventId ? 'bg-brand-50 ring-2 ring-inset ring-brand-500' : ''}`}>
                  <td className="px-4 py-3">
                    <div className="font-semibold text-ink-800">{e.eventDetails.name || 'Untitled event'}</div>
                    <div className="mt-0.5 text-xs text-ink-500">{e.eventDetails.venueName || 'Venue not set'} - {e.eventDetails.type}</div>
                  </td>
                  <td className="px-4 py-3 text-ink-600">{versionLabel(e)}</td>
                  <td className="px-4 py-3 text-ink-600">
                    <div>{assessmentLabel(e)}</div>
                    <div className="mt-0.5 text-xs text-ink-500">{organizerAdminDecisionLabel(e)} - {organizerPublicationLabel(publicationStateFor(e))}</div>
                  </td>
                  <td className="px-4 py-3 tabular-nums text-ink-600">
                    {e.eventDetails.startDatetime ? format(new Date(e.eventDetails.startDatetime), 'PP') : 'Not scheduled'}
                  </td>
                  <td className="px-4 py-3"><OrganizerStatusBadge status={String(e.status)} state={resolveApplicationDisplayState(e)} /></td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-3">
                      <Link to={isEditableApplicationStatus(String(e.status)) ? `/organizer/events/${e.eventId}/edit` : `/organizer/events/${e.eventId}`} className="text-brand-600 hover:text-brand-700 text-sm font-medium">
                        {isEditableApplicationStatus(String(e.status)) ? 'Edit' : 'View'}
                      </Link>
                      {e.controlListGenerated === true && <Link data-testid={`event-controls-${e.eventId}`} to={`/organizer/events/${e.eventId}/controls`} className="text-brand-600 hover:text-brand-700 text-sm font-semibold">Controls</Link>}
                      {String(e.status) === 'Draft' && <button
                        type="button"
                        className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-red-200 px-2.5 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={() => openDeleteDialog(e)}
                        disabled={Boolean(deletingEventId)}
                        aria-label={`Delete ${e.eventDetails.name || 'Untitled event'}`}
                      >
                        <Trash2 size={14} />
                        Delete
                      </button>}
                    </div>
                  </td>
                </tr></Fragment>;
              })}
            </tbody>
          </table>
          </div>

          <ul className="space-y-3 md:hidden">
            {ordered.map((e, index) => {
              const editable = isEditableApplicationStatus(String(e.status));
              const group = eventTimeGroup(e);
              const showGroup = index === 0 || eventTimeGroup(ordered[index - 1]) !== group;
              const draft = String(e.status) === 'Draft';
              return <Fragment key={e.eventId}>{showGroup && <li className="border-b border-[#d8cebd] pb-2 pt-3 text-xs font-bold uppercase tracking-[0.08em] text-brand-700">{TIME_LABELS[group]}</li>}<li><div className="rounded-lg border border-[#ded5c5] bg-[#fffdf8] p-4">
                <div className="flex items-start justify-between gap-3"><h2 className="font-display text-base font-bold leading-snug text-ink-800">{e.eventDetails.name || 'Untitled event'}</h2><OrganizerStatusBadge status={String(e.status)} state={resolveApplicationDisplayState(e)} /></div>
                <div className="mt-3 space-y-1 text-sm text-ink-500"><p className="flex items-center gap-2"><MapPin size={14} />{e.eventDetails.venueName || 'Venue not set'}</p><p className="tabular-nums">{e.eventDetails.startDatetime ? format(new Date(e.eventDetails.startDatetime), 'PP') : 'Not scheduled'}</p><p>{versionLabel(e)} - {assessmentLabel(e)}</p><p>{organizerAdminDecisionLabel(e)} - {organizerPublicationLabel(publicationStateFor(e))}</p></div>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-[#e3dacb] pt-3">
                  <Link to={editable ? `/organizer/events/${e.eventId}/edit` : `/organizer/events/${e.eventId}`} className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-brand-700 hover:text-brand-800">
                    <span>{editable ? 'Continue application' : 'View application'}</span>
                    <ArrowRight size={16} />
                  </Link>
                  {draft && <button
                    type="button"
                    className="inline-flex min-h-10 items-center gap-1.5 rounded-md border border-red-200 px-2.5 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => openDeleteDialog(e)}
                    disabled={Boolean(deletingEventId)}
                    aria-label={`Delete ${e.eventDetails.name || 'Untitled event'}`}
                  >
                    <Trash2 size={14} />
                    Delete
                  </button>}
                </div>
              </div>{e.controlListGenerated === true && <Link data-testid={`event-controls-${e.eventId}`} to={`/organizer/events/${e.eventId}/controls`} className="mt-2 block rounded-lg border border-brand-200 bg-brand-50 px-4 py-3 text-center text-sm font-semibold text-brand-700">Event controls &amp; documentation</Link>}</li></Fragment>;
            })}
          </ul>
        </div>
      )}

      {deleteTarget && <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="delete-draft-title">
        <form onSubmit={handleDeleteDraft} className="w-full max-w-lg rounded-xl border border-ink-200 bg-[#fffdf8] p-5 shadow-xl sm:p-6">
          <p className="page-eyebrow text-red-700">Permanent action</p>
          <h2 id="delete-draft-title" className="mt-1 font-display text-2xl font-bold text-ink-900">Delete {deleteTarget.eventDetails.name || 'Untitled event'}?</h2>
          <p className="mt-3 text-sm leading-6 text-ink-600">This permanently deletes the Draft application, its uploaded files, and all saved application data. This action cannot be undone.</p>
          {isRevisionDraft(deleteTarget) && <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-sm leading-5 text-red-800">This is a revision Draft. The previous submitted version, revision data, and review history will also be removed.</p>}
          <label htmlFor="delete-draft-confirmation" className="mt-5 block text-sm font-semibold text-ink-800">Type DELETE to confirm</label>
          <input
            id="delete-draft-confirmation"
            className="input mt-2"
            value={deleteConfirmation}
            onChange={(event) => setDeleteConfirmation(event.target.value)}
            disabled={Boolean(deletingEventId)}
            autoComplete="off"
            autoFocus
            spellCheck={false}
          />
          {deleteError && <p role="alert" className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-800">{deleteError}</p>}
          <div className="mt-6 flex flex-wrap justify-end gap-3">
            <button type="button" className="btn-secondary" disabled={Boolean(deletingEventId)} onClick={closeDeleteDialog}>Cancel</button>
            <button type="submit" className="inline-flex min-h-11 items-center gap-2 rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50" disabled={Boolean(deletingEventId) || deleteConfirmation !== DELETE_CONFIRMATION}>
              <Trash2 size={15} />
              {deletingEventId ? 'Deleting…' : 'Delete draft'}
            </button>
          </div>
        </form>
      </div>}
    </div>
  );
}

function versionLabel(event: EventRecord): string {
  const status = String(event.status);
  if (isEditableApplicationStatus(status)) {
    return `${event.activeRevision ? 'Revision' : 'Draft'} ${event.editableVersionId ?? `v${(event.currentVersionNumber ?? 0) + 1}`}`;
  }
  return event.currentVersionId ? `Submitted ${event.currentVersionId}` : 'No submitted version';
}

function isRevisionDraft(event: EventRecord): boolean {
  return String(event.status) === 'Draft'
    && Boolean(event.activeRevision || event.currentVersionId || (event.currentVersionNumber ?? 0) > 0);
}

function deleteDraftErrorMessage(error: unknown): string {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code ?? '')
    : '';
  if (code.endsWith('failed-precondition')) return 'This application is no longer a Draft. Refresh the page and try again.';
  if (code.endsWith('permission-denied')) return 'You do not have permission to delete this application.';
  if (code.endsWith('not-found')) return 'This application was already removed. Refresh the page to update the list.';
  return 'The Draft could not be fully deleted. Please try again.';
}

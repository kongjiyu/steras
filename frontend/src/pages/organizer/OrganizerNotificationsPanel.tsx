import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { COLLECTIONS, Notification } from '@shared/types';
import { db, functions, isFirebaseConfigured } from '../../config/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { userFacingSystemText } from '../../utils/userFacingText';

export default function OrganizerNotificationsPanel() {
  const { user } = useAuth();
  const [items, setItems] = useState<Notification[]>([]);
  const [filter, setFilter] = useState<'All' | 'Unread' | 'Read'>('All');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState('');
  useEffect(() => {
    if (!user || !isFirebaseConfigured) { setLoading(false); return; }
    setLoading(true);
    return onSnapshot(query(collection(db, COLLECTIONS.NOTIFICATIONS), where('recipientUid', '==', user.uid)), snapshot => {
      setItems(snapshot.docs.map(item => ({ ...item.data(), notificationId: item.id }) as Notification).sort((a, b) => b.createdAt - a.createdAt));
      setError(''); setLoading(false);
    }, () => { setError('Notifications could not be refreshed.'); setLoading(false); });
  }, [user, retry]);
  async function toggle(item: Notification) {
    setBusy(item.notificationId);
    try { await httpsCallable(functions, 'markNotificationRead')({ notificationId: item.notificationId, read: !item.read }); }
    catch { setError('Could not update this notification. Please retry.'); }
    finally { setBusy(''); }
  }
  const visible = items.filter(item => filter === 'All' || (filter === 'Read' ? item.read : !item.read));
  return <section className="card" aria-labelledby="organizer-notifications-title"><div className="card-header"><h2 id="organizer-notifications-title" className="section-title">Recent updates</h2><span className="text-sm">{loading ? 'Loading…' : error ? 'Refresh unavailable' : `${items.filter(item => !item.read).length} unread`}</span></div><div className="card-body"><div className="mb-4 flex gap-2" aria-label="Notification filters">{(['All', 'Unread', 'Read'] as const).map(value => <button key={value} type="button" aria-pressed={filter === value} className={filter === value ? 'btn-primary' : 'btn-secondary'} onClick={() => setFilter(value)}>{value}</button>)}</div>{error && <p role="alert" className="mb-4 text-sm text-red-700">{error} <button onClick={() => setRetry(value => value + 1)} className="underline">Retry</button></p>}{!loading && !error && !visible.length && <p className="text-sm text-ink-500">No {filter === 'All' ? '' : filter.toLowerCase()} notifications.</p>}<ul className="divide-y divide-cream-200">{visible.map(item => <li key={item.notificationId} className={`py-4 ${item.read ? '' : 'bg-brand-50 px-3'}`}><div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold">{userFacingSystemText(item.title)}</h3><p className="mt-2 whitespace-pre-line text-sm text-ink-600">{userFacingSystemText(item.message)}</p>{item.reason && <p className="mt-2 text-sm">Reason: {userFacingSystemText(item.reason)}</p>}{item.suggestion && <p className="mt-2 text-sm">Suggestion: {userFacingSystemText(item.suggestion)}</p>}<Link className="mt-3 inline-block text-sm font-semibold text-brand-700" to={`/organizer/events/${item.eventId}`}>Open application →</Link></div><button disabled={Boolean(busy)} onClick={() => void toggle(item)} className="btn-secondary shrink-0">{busy === item.notificationId ? 'Saving…' : item.read ? 'Mark unread' : 'Mark read'}</button></div></li>)}</ul></div></section>;
}

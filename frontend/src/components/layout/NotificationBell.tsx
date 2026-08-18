/**
 * NotificationBell — bell icon + unread badge + dropdown panel showing
 * the current user's notifications. Mounts a real-time listener against
 * the `notifications` collection so the badge updates immediately when
 * a new decision or control verification lands.
 *
 * Backed by the `listMyNotifications` and `markNotificationRead` Cloud
 * Functions (server-side scoped by recipientUid).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Bell, Check } from 'lucide-react';
import {
  collection,
  limit as fsLimit,
  onSnapshot,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import { db, isFirebaseConfigured } from '../../config/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { COLLECTIONS, Notification } from '@shared/types';

const MAX_VISIBLE = 20;

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function NotificationBell() {
  const { user, profile } = useAuth();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Real-time subscription to the signed-in user's notifications.
  // Scoped by Firestore rules — the rule set must include a `where
  // recipientUid == request.auth.uid` clause for reads, otherwise the
  // listener will fail. We pass the filter as both the query predicate
  // AND the rules filter (rules ignore query params; they only see
  // request.auth).
  useEffect(() => {
    if (!isFirebaseConfigured || !user) {
      setItems([]);
      return;
    }
    const notifsRef = collection(db, COLLECTIONS.NOTIFICATIONS);
    const q = query(
      notifsRef,
      where('recipientUid', '==', user.uid),
      orderBy('createdAt', 'desc'),
      fsLimit(MAX_VISIBLE),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const next: Notification[] = [];
        snap.forEach((d) => {
          const data = d.data() as Notification;
          next.push({ ...data, notificationId: data.notificationId ?? d.id });
        });
        setItems(next);
      },
      (err) => {
        console.warn('[NotificationBell] subscribe failed (rules may not include recipientUid):', err.message);
        setItems([]);
      },
    );
    return unsub;
  }, [user]);

  // Close the panel on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const unread = useMemo(() => items.filter((n) => !n.read).length, [items]);

  async function toggleRead(notif: Notification) {
    if (!isFirebaseConfigured) return;
    if (notif.read) return;
    // Optimistic
    setItems((curr) => curr.map((n) => (n.notificationId === notif.notificationId ? { ...n, read: true } : n)));
    try {
      const { httpsCallable, getFunctions } = await import('firebase/functions');
      const fns = getFunctions();
      const mark = httpsCallable(fns, 'markNotificationRead');
      await mark({ notificationId: notif.notificationId, read: true });
    } catch (err) {
      // Revert on failure
      setItems((curr) => curr.map((n) => (n.notificationId === notif.notificationId ? { ...n, read: false } : n)));
      console.warn('[NotificationBell] markNotificationRead failed', err);
    }
  }

  if (!isFirebaseConfigured || !user || !profile) return null;

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-md border border-[#ded5c5] bg-[#fffdf8] text-ink-700 transition-colors hover:border-brand-300 hover:bg-cream-50"
        aria-label={unread > 0 ? `Notifications (${unread} unread)` : 'Notifications'}
        title={unread > 0 ? `${unread} unread notification${unread === 1 ? '' : 's'}` : 'Notifications'}
      >
        <Bell size={16} />
        {unread > 0 && (
          <span
            data-testid="notification-badge"
            className="absolute -right-1.5 -top-1.5 inline-flex min-w-[18px] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-[1.5] text-white"
          >
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 top-11 z-30 w-[360px] max-h-[480px] overflow-y-auto rounded-lg border border-[#ded5c5] bg-[#fffdf8] shadow-card"
          role="dialog"
          aria-label="Notifications"
        >
          <div className="flex items-center justify-between border-b border-[#e3dacb] px-4 py-3">
            <p className="text-sm font-bold uppercase tracking-[0.06em] text-ink-700">Notifications</p>
            <span className="text-xs text-ink-500">{unread} unread</span>
          </div>
          {items.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-ink-500">No notifications yet.</p>
          ) : (
            <ul className="divide-y divide-[#e3dacb]">
              {items.map((n) => (
                <li
                  key={n.notificationId}
                  className={`flex items-start gap-3 px-4 py-3 text-sm ${n.read ? 'bg-transparent' : 'bg-brand-50/40'}`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-ink-800">{n.title}</p>
                    <p className="mt-0.5 text-xs leading-5 text-ink-600">{n.message}</p>
                    {/* FR-M3-08: surface reason + suggestion as separate
                        lines when present, so the organizer sees the
                        full feedback (not just the message). Old
                        notifications without these fields skip this. */}
                    {(n.reason || n.suggestion) && (
                      <div className="mt-2 rounded-md border border-ink-100 bg-white px-3 py-2 text-[12px] leading-5 text-ink-700">
                        {n.reason && (
                          <p>
                            <span className="font-semibold text-ink-800">Reason:</span>{' '}
                            <span className="whitespace-pre-line">{n.reason}</span>
                          </p>
                        )}
                        {n.suggestion && (
                          <p className={n.reason ? 'mt-1' : ''}>
                            <span className="font-semibold text-ink-800">Suggestion:</span>{' '}
                            <span className="whitespace-pre-line">{n.suggestion}</span>
                          </p>
                        )}
                      </div>
                    )}
                    <p className="mt-1 text-[11px] uppercase tracking-[0.06em] text-ink-400">{timeAgo(n.createdAt)}</p>
                  </div>
                  {!n.read && (
                    <button
                      type="button"
                      onClick={() => toggleRead(n)}
                      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-500 hover:bg-cream-50 hover:text-ink-700"
                      aria-label="Mark as read"
                      title="Mark as read"
                    >
                      <Check size={14} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

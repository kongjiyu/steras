import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, Check, ExternalLink } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { findNotificationsForRecipient, Notification as MockNotification } from '../../mock_data/notifications';

const MAX_VISIBLE = 5;

export default function OrganizerNotificationsPanel() {
  const { profile, user } = useAuth();
  const [readIds, setReadIds] = useState<Set<string>>(() => new Set());
  const recipientId = profile?.uid ?? user?.uid ?? '';
  const notifications = useMemo(
    () => findNotificationsForRecipient(recipientId).slice(0, MAX_VISIBLE),
    [recipientId],
  );
  const unreadCount = notifications.filter((notification) => !notification.readAt && !readIds.has(notification.notificationId)).length;

  return (
    <section className="card" aria-labelledby="organizer-notifications-title">
      <div className="card-header">
        <div>
          <p className="page-eyebrow !mb-1">M3 notifications</p>
          <h2 id="organizer-notifications-title" className="section-title">Recent updates</h2>
        </div>
        <span className="badge bg-brand-50 text-brand-700">
          <Bell size={13} />
          {unreadCount} unread
        </span>
      </div>
      <div className="card-body">
        {notifications.length === 0 ? (
          <p className="text-sm leading-6 text-ink-500">No organiser notifications yet.</p>
        ) : (
          <ul className="divide-y divide-[#e3dacb] border-y border-[#e3dacb]">
            {notifications.map((notification) => {
              const read = Boolean(notification.readAt) || readIds.has(notification.notificationId);
              const feedback = correctionFeedback(notification);
              return (
                <li key={notification.notificationId} className={`py-4 ${read ? '' : 'bg-brand-50/40 px-3'}`}>
                  <div className="flex items-start gap-3">
                    <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${read ? 'bg-cream-100 text-ink-500' : 'bg-brand-600 text-cream-50'}`}>
                      <Bell size={14} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-ink-800">{notification.title}</p>
                      <p className="mt-1 text-sm leading-6 text-ink-600">{notification.message}</p>
                      {feedback && (
                        <div className="mt-3 rounded-md border border-[#ded5c5] bg-[#fffdf8] px-3 py-2 text-xs leading-5 text-ink-700">
                          <p><span className="font-semibold text-ink-800">Reason:</span> {feedback.reason}</p>
                          <p className="mt-1"><span className="font-semibold text-ink-800">Suggestion:</span> {feedback.suggestion}</p>
                        </div>
                      )}
                      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs font-semibold text-ink-500">
                        <span>{timeAgo(notification.createdAt)}</span>
                        <span>Version {notification.versionId}</span>
                        <Link to={`/organizer/events/${notification.eventId}`} className="inline-flex items-center gap-1 text-brand-700 hover:text-brand-800">
                          Open application <ExternalLink size={12} />
                        </Link>
                      </div>
                    </div>
                    {!read && (
                      <button
                        type="button"
                        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-ink-500 hover:bg-cream-100 hover:text-ink-800"
                        onClick={() => setReadIds((current) => new Set(current).add(notification.notificationId))}
                        aria-label="Mark notification as read"
                        title="Mark as read"
                      >
                        <Check size={15} />
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

function correctionFeedback(notification: MockNotification): { reason: string; suggestion: string } | null {
  const [, rawReason] = notification.message.split('Reason:');
  if (!rawReason) return null;
  const [reason, suggestion = ''] = rawReason.split('Suggestion:').map((value) => value.trim());
  if (!reason || !suggestion) return null;
  return { reason, suggestion };
}

function timeAgo(timestamp: number): string {
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

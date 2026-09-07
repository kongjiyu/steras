import { useOnlineStatus } from '../../hooks/useOnlineStatus';

export default function ConnectionStatus() {
  const online = useOnlineStatus();
  if (online) return null;
  return <div role="alert" className="fixed bottom-4 left-4 right-4 z-[100] mx-auto max-w-xl rounded-lg border border-gold-300 bg-gold-50 p-4 text-sm text-ink-900 shadow-lg">
    <strong>You are offline.</strong> Displayed information may be out of date. Reconnect and check the status of pending changes before submitting again.
  </div>;
}

import Analytics from '../authority/Analytics';

/**
 * Module 5 admin route adapter.
 *
 * AdminLayout owns the authenticated shell, sidebar, and sign-out control.
 * The report page is embedded here so the shared admin workspace is not
 * duplicated by a second header.
 */
export default function AdminAnalytics() {
  return <Analytics embedded />;
}

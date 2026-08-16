import { ShieldCheck, History } from 'lucide-react';
import { WorkspaceTopBar } from '../../components/layout/Sidebar';
import { useAuth } from '../../contexts/AuthContext';

function initialsFor(name?: string) {
  if (!name) return 'AD';
  return name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
}

export default function AdminAudit() {
  const { profile } = useAuth();
  return (
    <div className="min-h-screen bg-[#f3f1e9] pb-16">
      <WorkspaceTopBar
        title="Audit log"
        subtitle="System-wide audit trail across all event applications"
        userInitials={initialsFor(profile?.name)}
        workspaceEyebrow="STERAS administration"
        workspaceEyebrowIcon={ShieldCheck}
      />
      <main className="page-shell page-enter">
        <div className="rounded-lg border border-[#ded5c5] bg-white p-8 text-center text-ink-500">
          <History size={28} className="mx-auto mb-2 text-ink-400" />
          <p className="text-sm">
            Cross-event audit aggregation view (FR-AUDIT-aggregation). To be built in a
            follow-up — for now, each application&apos;s audit log is visible on its review page.
          </p>
        </div>
      </main>
    </div>
  );
}

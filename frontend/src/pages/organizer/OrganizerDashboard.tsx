import { Link } from 'react-router-dom';
import { ArrowRight, CalendarPlus, ClipboardList, FileCheck2, ShieldCheck } from 'lucide-react';
import PageHeader from '../../components/ui/PageHeader';
import { useAuth } from '../../contexts/AuthContext';

export default function OrganizerDashboard() {
  const { profile } = useAuth();
  return (
    <div>
      <PageHeader
        title={`Welcome, ${profile?.name ?? 'Organizer'}`}
        description="Prepare evidence, submit an event application, and follow every authority decision from one place."
      />

      <section className="overflow-hidden rounded-lg bg-brand-800 text-cream-50 shadow-[0_16px_40px_rgba(52,65,28,0.14)]">
        <div className="grid lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="relative px-5 py-7 sm:px-8 sm:py-9">
            <div className="absolute inset-0 opacity-20 [background-image:linear-gradient(115deg,transparent_0_38%,rgba(255,255,255,.18)_38%_39%,transparent_39%_62%,rgba(240,195,64,.3)_62%_63%,transparent_63%)]" aria-hidden="true" />
            <div className="relative max-w-2xl">
              <p className="text-xs font-bold uppercase tracking-[0.08em] text-gold-300">Next step</p>
              <h2 className="mt-3 font-display text-2xl font-bold leading-tight text-cream-50 sm:text-3xl">Build an authority-ready application</h2>
              <p className="mt-3 max-w-xl text-sm leading-6 text-brand-100">Accurate venue, attendance, emergency-plan, and supporting evidence details produce a clearer assessment and faster review.</p>
              <Link to="/organizer/events/new" className="btn mt-6 bg-gold-300 text-brand-950 hover:bg-gold-200"><CalendarPlus size={17} />Start an application</Link>
            </div>
          </div>
          <div className="border-t border-white/15 bg-brand-900/25 p-5 lg:border-l lg:border-t-0 lg:p-7">
            <ShieldCheck size={24} className="text-gold-300" />
            <p className="mt-4 text-sm font-semibold text-cream-50">Evidence first</p>
            <p className="mt-2 text-sm leading-6 text-brand-100">Each submission becomes an immutable version for coordinated review.</p>
          </div>
        </div>
      </section>

      <section className="mt-8 grid gap-6 border-t border-[#ded5c5] pt-8 md:grid-cols-[0.72fr_1.28fr]">
        <div>
          <p className="page-eyebrow">Application workflow</p>
          <h2 className="font-display text-xl font-bold text-ink-800">Clear progress, no guesswork</h2>
          <p className="mt-3 text-sm leading-6 text-ink-500">STERAS keeps the submitted version, assessed risk, evidence, and agency decisions together.</p>
        </div>
        <div className="divide-y divide-[#ded5c5] border-y border-[#ded5c5]">
          {[
            { icon: ClipboardList, title: 'Prepare the application', body: 'Add event, venue, crowd, contact, and emergency-plan information.' },
            { icon: FileCheck2, title: 'Submit evidence', body: 'Attach the files authorities need to inspect the same application version.' },
            { icon: ShieldCheck, title: 'Track review', body: 'See live workflow status and the authoritative final risk assessment.' },
          ].map(({ icon: Icon, title, body }, index) => (
            <div key={title} className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3 py-4">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-brand-50 text-brand-700"><Icon size={17} /></div>
              <div><p className="text-xs font-bold uppercase tracking-[0.06em] text-gold-600">0{index + 1}</p><h3 className="mt-1 font-display text-sm font-bold text-ink-800">{title}</h3><p className="mt-1 text-sm leading-6 text-ink-500">{body}</p></div>
            </div>
          ))}
        </div>
      </section>

      <Link to="/organizer/events" className="mt-8 flex min-h-14 items-center justify-between gap-4 rounded-lg border border-[#ccd6ae] bg-brand-50 px-5 text-sm font-semibold text-brand-800 transition-colors hover:bg-brand-100">
        <span className="inline-flex items-center gap-3"><ClipboardList size={19} />View and manage all applications</span><ArrowRight size={18} />
      </Link>
    </div>
  );
}

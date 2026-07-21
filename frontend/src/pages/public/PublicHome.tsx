import { Link } from 'react-router-dom';
import { CalendarDays, FileCheck2, ShieldCheck } from 'lucide-react';
import PublicHeader from '../../components/layout/PublicHeader';
import heroUrl from '../../assets/imagery/public-event-hero.webp';

const capabilities = [
  { icon: FileCheck2, title: 'Auditable assessment', body: 'One deterministic baseline, one bounded M3 adjustment, and one authoritative final risk.' },
  { icon: ShieldCheck, title: 'Coordinated approval', body: 'Required agencies review the same immutable application version with recorded rationale.' },
  { icon: CalendarDays, title: 'Trusted public register', body: 'Only unanimously approved events appear in the public tourism calendar.' },
];

export default function PublicHome() {
  return (
    <div className="min-h-screen bg-cream-50">
      <PublicHeader />
      <main>
        <section className="relative isolate min-h-[32rem] overflow-hidden border-b border-[#d9cdb8] sm:min-h-[38rem] lg:min-h-[min(44rem,calc(100svh-8rem))]">
          <img src={heroUrl} alt="Malaysian cultural performers at a tourism event in Kuala Lumpur" className="absolute inset-0 -z-20 h-full w-full object-cover object-center" />
          <div className="absolute inset-y-0 left-0 -z-10 w-full bg-[#fffdf7]/90 sm:w-[68%] lg:w-[55%]" />
          <div className="mx-auto flex min-h-[inherit] max-w-6xl items-center px-5 py-12 sm:px-8">
            <div className="max-w-xl">
              <p className="text-xs font-bold uppercase text-gold-600">Smart Tourism Event Risk &amp; Approval System</p>
              <h1 className="mt-4 font-display text-4xl font-bold leading-tight text-ink-900 sm:text-5xl">Safer tourism events, clearer approvals</h1>
              <p className="mt-5 max-w-lg text-base leading-7 text-ink-600">STERAS helps Malaysian organizers and authorities assess risk, coordinate evidence-based decisions, and publish trusted approved events.</p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link to="/calendar" className="btn-primary">View approved events</Link>
                <Link to="/register" className="btn-secondary">Organizer sign-up</Link>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-5 py-10 sm:px-8 sm:py-14" aria-labelledby="capabilities-title">
          <div className="grid gap-8 border-b border-[#d9cdb8] pb-10 md:grid-cols-[1fr_2fr]">
            <div>
              <p className="text-xs font-bold uppercase text-gold-600">One review system</p>
              <h2 id="capabilities-title" className="mt-2 font-display text-2xl font-bold text-ink-900">From application to public confidence</h2>
            </div>
            <div className="grid gap-7 sm:grid-cols-3">
              {capabilities.map(({ icon: Icon, title, body }) => (
                <article key={title}>
                  <Icon size={22} className="text-brand-600" aria-hidden="true" />
                  <h3 className="mt-3 text-sm font-semibold text-ink-800">{title}</h3>
                  <p className="mt-2 text-sm leading-6 text-ink-500">{body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

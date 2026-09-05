import { Link } from 'react-router-dom';
import {
  ArrowRight,
  BarChart3,
  Building2,
  CalendarDays,
  Check,
  ClipboardCheck,
  FileSearch,
  LockKeyhole,
  MapPin,
  RadioTower,
  ShieldCheck,
  Siren,
  UserRoundCheck,
} from 'lucide-react';
import PublicHeader from '../../components/layout/PublicHeader';
import heroUrl from '../../assets/imagery/public-event-hero.webp';

const journey = [
  {
    step: '01',
    phase: 'Application',
    title: 'Prepare one complete application',
    body: 'Choose an event scenario, preview the right templates, upload your completed documents and verify every extracted field before submission.',
    detail: 'Guided templates · venue registry · evidence checks',
    icon: ClipboardCheck,
  },
  {
    step: '02',
    phase: 'Risk & resources',
    title: 'Understand risk before review',
    body: 'STERAS brings event data and contextual evidence together, then produces traceable category risks and practical safety-resource planning ranges.',
    detail: 'Eight risk categories · provenance · resource ranges',
    icon: FileSearch,
  },
  {
    step: '03',
    phase: 'Approval',
    title: 'Coordinate accountable approval',
    body: 'Administrators and assigned agencies review the same submitted version, record their rationale and complete the required event-control workflow.',
    detail: 'Named reviewers · immutable decisions · event controls',
    icon: ShieldCheck,
  },
  {
    step: '04',
    phase: 'Incident response',
    title: 'Respond when an incident happens',
    body: 'Registered reporters can raise an incident, while organizers and authorities coordinate response, escalation, evidence and final resolution.',
    detail: 'Incident triage · authority referral · resolution history',
    icon: Siren,
  },
  {
    step: '05',
    phase: 'Analytics',
    title: 'Learn across the event portfolio',
    body: 'Privacy-safe operational reports reveal application outcomes, risk patterns, incidents, controls and resource trends without exposing private evidence.',
    detail: 'Read-only analytics · PDF and CSV reports',
    icon: BarChart3,
  },
];

const trustSteps = [
  ['Evidence in context', 'Weather, venue, calendar and eligible historical evidence are recorded with source and retrieval details.'],
  ['AI proposes', 'MiniMax identifies hazards and proposes structured category scores, concerns and missing information.'],
  ['Rules calculate', 'Versioned hard rules and formulas validate the proposal and calculate provisional risk and planning ranges.'],
  ['People decide', 'Assigned officers confirm or override scores with reasons before an official result can support approval.'],
];

export default function PublicHome() {
  return (
    <div className="min-h-screen overflow-hidden bg-cream-50">
      <PublicHeader />
      <main>
        <section className="relative isolate overflow-hidden border-b border-[#d9cdb8]" aria-labelledby="home-title">
          <img
            src={heroUrl}
            alt="Malaysian cultural performers at a tourism event in Kuala Lumpur"
            className="absolute inset-0 -z-30 h-full w-full object-cover object-[68%_center] lg:object-center"
          />
          <div className="absolute inset-0 -z-20 bg-[linear-gradient(90deg,rgba(251,247,238,0.98)_0%,rgba(251,247,238,0.96)_45%,rgba(251,247,238,0.28)_72%,rgba(26,35,13,0.16)_100%)]" />
          <div className="absolute inset-x-0 bottom-0 -z-10 h-28 bg-[linear-gradient(0deg,#fbf7ee_0%,rgba(251,247,238,0)_100%)]" />

          <div className="mx-auto grid min-h-[min(47rem,calc(100svh-4.5rem))] max-w-6xl items-center px-5 py-16 sm:px-8 lg:grid-cols-[minmax(0,1.08fr)_minmax(18rem,0.92fr)] lg:py-24">
            <div className="page-enter max-w-[42rem]">
              <p className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.11em] text-gold-700">
                <span className="h-px w-8 bg-gold-500" aria-hidden="true" />
                Malaysia&apos;s coordinated event-safety workspace
              </p>
              <h1 id="home-title" className="mt-6 max-w-[13ch] font-display text-[clamp(2.75rem,6vw,5.5rem)] font-bold leading-[0.98] tracking-[-0.055em] text-ink-900">
                Safer events start with clearer evidence.
              </h1>
              <p className="mt-7 max-w-[36rem] text-lg leading-8 text-ink-600">
                STERAS guides tourism-event applications from the first document to an auditable multi-agency decision—and keeps approved public information easy to verify.
              </p>
              <div className="mt-9 flex flex-wrap gap-3">
                <Link to="/register" className="btn-primary group">
                  Start an application
                  <ArrowRight size={17} className="transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden="true" />
                </Link>
                <Link to="/calendar" className="btn-secondary">Explore approved events</Link>
              </div>

              <ul className="mt-12 grid max-w-[38rem] gap-x-8 gap-y-3 border-t border-[#cfc3ad] pt-6 text-sm font-semibold text-ink-700 sm:grid-cols-3" aria-label="STERAS trust commitments">
                <li className="flex items-center gap-2"><Check size={16} className="text-brand-600" />Versioned submissions</li>
                <li className="flex items-center gap-2"><Check size={16} className="text-brand-600" />Human decisions</li>
                <li className="flex items-center gap-2"><Check size={16} className="text-brand-600" />Public-safe records</li>
              </ul>
            </div>

          </div>
        </section>

        <section id="how-it-works" className="mx-auto max-w-6xl scroll-mt-24 px-5 py-20 sm:px-8 sm:py-28" aria-labelledby="journey-title">
          <div className="grid gap-10 lg:grid-cols-[0.72fr_1.28fr] lg:gap-20">
            <div className="lg:sticky lg:top-28 lg:self-start">
              <p className="text-xs font-bold uppercase tracking-[0.1em] text-gold-700">One connected journey</p>
              <h2 id="journey-title" className="mt-4 max-w-[12ch] font-display text-[clamp(2rem,4vw,3.5rem)] font-bold leading-[1.05] tracking-[-0.04em] text-ink-900">
                From idea to public confidence
              </h2>
              <p className="mt-6 max-w-sm text-base leading-7 text-ink-600">
                Five connected stages keep work moving without losing the evidence, people or decisions that came before.
              </p>
              <Link to="/login" className="mt-8 inline-flex min-h-11 items-center gap-2 font-semibold text-brand-700 underline decoration-brand-300 underline-offset-4 hover:text-brand-600">
                Continue to your workspace <ArrowRight size={16} />
              </Link>
            </div>

            <ol className="relative border-l border-[#cfc3ad] pl-7 sm:pl-10">
              {journey.map(({ step, phase, title, body, detail, icon: Icon }) => (
                <li key={step} className="relative pb-12 last:pb-0 sm:pb-16">
                  <span className="absolute -left-[2.28rem] top-0 grid h-4 w-4 place-items-center rounded-full border-[3px] border-cream-50 bg-brand-600 sm:-left-[2.78rem]" aria-hidden="true" />
                  <div className="grid gap-4 sm:grid-cols-[5rem_1fr] sm:gap-7">
                    <div>
                      <span className="font-display text-4xl font-bold tracking-[-0.06em] text-[#c9bea9]">{step}</span>
                      <span className="mt-1 block text-xs font-bold uppercase tracking-[0.09em] text-gold-700">{phase}</span>
                    </div>
                    <article>
                      <div className="flex items-start gap-3">
                        <Icon size={21} className="mt-1 shrink-0 text-brand-600" aria-hidden="true" />
                        <h3 className="font-display text-xl font-bold leading-snug text-ink-900 sm:text-2xl">{title}</h3>
                      </div>
                      <p className="mt-3 max-w-[40rem] text-base leading-7 text-ink-600">{body}</p>
                      <p className="mt-4 text-xs font-bold uppercase tracking-[0.07em] text-brand-700">{detail}</p>
                    </article>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="who-it-is-for" className="relative scroll-mt-24 overflow-hidden bg-brand-950 text-cream-50" aria-labelledby="roles-title">
          <div className="absolute inset-0 opacity-[0.12] [background-image:linear-gradient(45deg,transparent_46%,#f0c340_47%,#f0c340_48%,transparent_49%),linear-gradient(-45deg,transparent_46%,#f0c340_47%,#f0c340_48%,transparent_49%)] [background-size:42px_42px]" aria-hidden="true" />
          <div className="relative mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-28">
            <div className="grid gap-8 border-b border-white/20 pb-12 lg:grid-cols-[1fr_0.85fr] lg:items-end">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.1em] text-gold-300">Designed around real responsibilities</p>
                <h2 id="roles-title" className="mt-4 max-w-[16ch] font-display text-[clamp(2rem,4vw,3.5rem)] font-bold leading-[1.08] tracking-[-0.04em] text-cream-50">Every role sees the detail it needs—and no more.</h2>
              </div>
              <p className="max-w-xl text-base leading-7 text-cream-100 lg:justify-self-end">
                STERAS separates public information, organizer progress and restricted review evidence while keeping every actor connected to the same event history.
              </p>
            </div>

            <div className="grid gap-0 lg:grid-cols-2">
              <article className="border-b border-white/20 py-12 lg:border-b-0 lg:border-r lg:pr-14">
                <div className="flex items-center gap-3 text-gold-300"><Building2 size={21} /><span className="text-xs font-bold uppercase tracking-[0.11em]">For event organizers</span></div>
                <h3 className="mt-5 font-display text-2xl font-bold text-cream-50">Know what to prepare before review begins.</h3>
                <ul className="mt-7 space-y-4 text-base leading-7 text-cream-100">
                  <li className="flex gap-3"><span className="mt-3 h-px w-5 shrink-0 bg-gold-300" />Get the right core and scenario templates.</li>
                  <li className="flex gap-3"><span className="mt-3 h-px w-5 shrink-0 bg-gold-300" />Review extracted fields, evidence gaps and application progress.</li>
                  <li className="flex gap-3"><span className="mt-3 h-px w-5 shrink-0 bg-gold-300" />Follow decisions, corrections, controls and incident responses.</li>
                </ul>
                <Link to="/register" className="mt-9 inline-flex min-h-11 items-center gap-2 font-bold text-gold-300 hover:text-gold-200">Create organizer account <ArrowRight size={16} /></Link>
              </article>

              <article className="py-12 lg:pl-14">
                <div className="flex items-center gap-3 text-gold-300"><UserRoundCheck size={21} /><span className="text-xs font-bold uppercase tracking-[0.11em]">For Admin and authorities</span></div>
                <h3 className="mt-5 font-display text-2xl font-bold text-cream-50">Review the evidence behind every recommendation.</h3>
                <ul className="mt-7 space-y-4 text-base leading-7 text-cream-100">
                  <li className="flex gap-3"><span className="mt-3 h-px w-5 shrink-0 bg-gold-300" />Inspect provenance, warnings, risk categories and resource ranges.</li>
                  <li className="flex gap-3"><span className="mt-3 h-px w-5 shrink-0 bg-gold-300" />Record named, reasoned decisions against an immutable version.</li>
                  <li className="flex gap-3"><span className="mt-3 h-px w-5 shrink-0 bg-gold-300" />Coordinate event controls, incidents and privacy-safe analytics.</li>
                </ul>
                <Link to="/login" className="mt-9 inline-flex min-h-11 items-center gap-2 font-bold text-gold-300 hover:text-gold-200">Open secure workspace <ArrowRight size={16} /></Link>
              </article>
            </div>
          </div>
        </section>

        <section id="trust-model" className="mx-auto max-w-6xl scroll-mt-24 px-5 py-20 sm:px-8 sm:py-28" aria-labelledby="trust-title">
          <div className="grid gap-12 lg:grid-cols-[1fr_1.25fr] lg:gap-20">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.1em] text-gold-700">Human-governed intelligence</p>
              <h2 id="trust-title" className="mt-4 max-w-[14ch] font-display text-[clamp(2rem,4vw,3.5rem)] font-bold leading-[1.06] tracking-[-0.04em] text-ink-900">AI can advise. Evidence and accountable people decide.</h2>
              <p className="mt-6 max-w-md text-base leading-7 text-ink-600">
                The original AI proposal is preserved, deterministic rules remain visible, and official outcomes require an auditable human review path.
              </p>
            </div>

            <ol className="divide-y divide-[#d8cdb9] border-y border-[#d8cdb9]">
              {trustSteps.map(([title, body], index) => (
                <li key={title} className="grid gap-3 py-6 sm:grid-cols-[3rem_9rem_1fr] sm:items-start sm:gap-5">
                  <span className="font-display text-2xl font-bold text-[#b0a58f]">0{index + 1}</span>
                  <h3 className="font-display text-base font-bold text-ink-900">{title}</h3>
                  <p className="text-sm leading-6 text-ink-600">{body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="border-y border-[#d9cdb8] bg-[#f4ecd9]" aria-labelledby="privacy-title">
          <div className="mx-auto grid max-w-6xl gap-10 px-5 py-16 sm:px-8 md:grid-cols-[0.8fr_1.2fr] md:items-center md:py-20">
            <div className="relative min-h-52 overflow-hidden bg-brand-900 p-7 text-cream-50">
              <div className="absolute -right-12 -top-12 h-40 w-40 rounded-full border border-gold-300/25" />
              <div className="absolute -right-3 -top-3 h-24 w-24 rounded-full border border-gold-300/35" />
              <LockKeyhole size={27} className="text-gold-300" />
              <p className="mt-10 max-w-xs font-display text-xl font-bold leading-snug text-cream-50">Private evidence stays inside the review boundary.</p>
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.1em] text-gold-700">Public confidence without private exposure</p>
              <h2 id="privacy-title" className="mt-4 font-display text-3xl font-bold tracking-[-0.035em] text-ink-900">Approval is visible. Restricted review detail is not.</h2>
              <p className="mt-5 max-w-2xl text-base leading-7 text-ink-600">The public calendar contains only approved, sanitised event information. Organizer identity details, private evidence, risk internals, officer notes and incident narratives stay protected by role-based access.</p>
              <div className="mt-7 flex flex-wrap gap-x-8 gap-y-3 text-sm font-semibold text-ink-700">
                <span className="flex items-center gap-2"><CalendarDays size={17} className="text-brand-600" />Approved events</span>
                <span className="flex items-center gap-2"><MapPin size={17} className="text-brand-600" />Safe venue details</span>
                <span className="flex items-center gap-2"><RadioTower size={17} className="text-brand-600" />Published controls</span>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-28">
          <div className="grid overflow-hidden border border-[#d1c5ae] bg-[#fffdf8] lg:grid-cols-[1fr_auto] lg:items-center">
            <div className="p-8 sm:p-12">
              <p className="text-xs font-bold uppercase tracking-[0.1em] text-gold-700">Ready when your event is</p>
              <h2 className="mt-4 max-w-[18ch] font-display text-3xl font-bold tracking-[-0.04em] text-ink-900 sm:text-4xl">Make the first review easier by preparing the right evidence now.</h2>
              <p className="mt-5 max-w-2xl text-base leading-7 text-ink-600">Start with a guided application, or browse the public register to see events that have completed the approval journey.</p>
            </div>
            <div className="flex flex-col gap-3 border-t border-[#d1c5ae] bg-cream-100 p-8 sm:flex-row lg:min-w-72 lg:flex-col lg:border-l lg:border-t-0 lg:p-10">
              <Link to="/register" className="btn-primary group">Start an application <ArrowRight size={17} className="transition-transform group-hover:translate-x-0.5" /></Link>
              <Link to="/calendar" className="btn-secondary">View approved events</Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/15 bg-brand-950 text-cream-100">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-9 sm:px-8 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="font-display text-base font-bold text-cream-50">STERAS</p>
            <p className="mt-1 text-sm">Smart Tourism Event Risk &amp; Approval System</p>
          </div>
          <nav className="flex flex-wrap gap-x-6 gap-y-2 text-sm font-semibold" aria-label="Footer navigation">
            <a href="#how-it-works" className="hover:text-gold-300">How it works</a>
            <Link to="/calendar" className="hover:text-gold-300">Approved events</Link>
            <Link to="/login" className="hover:text-gold-300">Sign in</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}

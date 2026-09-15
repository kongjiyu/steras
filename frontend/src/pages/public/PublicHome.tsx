import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Building2,
  CalendarDays,
  Check,
  CheckCircle2,
  ClipboardCheck,
  CloudSun,
  FileCheck2,
  FileSearch,
  Fingerprint,
  MapPin,
  ShieldCheck,
  Sparkles,
  UserRoundCheck,
} from 'lucide-react';
import PublicHeader from '../../components/layout/PublicHeader';
import logoUrl from '../../assets/brand/steras-mark.svg';
import heroUrl from '../../assets/imagery/public-event-hero.webp';
import planningUrl from '../../assets/imagery/auth-event-planning.webp';

const journey = [
  {
    step: '01',
    title: 'Prepare application',
    body: 'Choose a scenario, preview the right templates and verify every extracted field before submission.',
    note: 'Guided templates and evidence checks',
    icon: ClipboardCheck,
  },
  {
    step: '02',
    title: 'Evidence & risk assessment',
    body: 'Venue, weather and eligible evidence become a traceable eight-category risk assessment.',
    note: 'Context, provenance and resource ranges',
    icon: FileSearch,
  },
  {
    step: '03',
    title: 'Multi-agency review',
    body: 'Assigned authorities inspect the same version and record named, reasoned decisions.',
    note: 'Accountable review without lost context',
    icon: UserRoundCheck,
  },
  {
    step: '04',
    title: 'Approved public record',
    body: 'A final decision publishes only the safe event details visitors need to plan with confidence.',
    note: 'Verified outcome and protected evidence',
    icon: ShieldCheck,
  },
];

const organizerCapabilities = [
  ['Smart templates', 'Scenario-matched documents and required fields.'],
  ['Extracted fields', 'Key details captured and ready for verification.'],
  ['Evidence completeness', 'Missing items surfaced before submission.'],
  ['Application progress', 'A clear view of review status and next actions.'],
];

const authorityCapabilities = [
  ['Provenance first', 'See who provided what, when and why.'],
  ['Risk categories', 'Traceable scores with deterministic guardrails.'],
  ['Resource ranges', 'Planning recommendations tied to event demand.'],
  ['Named decisions', 'Accountable outcomes with a full audit trail.'],
];

const decisionFlow = [
  {
    label: 'Source evidence',
    icon: FileCheck2,
    title: 'Verified inputs',
    detail: 'Venue plan · medical plan · traffic plan',
    accent: 'A complete evidence pack',
  },
  {
    label: 'AI proposal',
    icon: Sparkles,
    title: 'Structured assessment',
    detail: 'Hazards · category scores · concerns',
    accent: 'Proposal preserved as provenance',
  },
  {
    label: 'Deterministic rules',
    icon: Fingerprint,
    title: 'Versioned calculation',
    detail: 'Hard floors · weights · resource ranges',
    accent: 'Same inputs, same result',
  },
  {
    label: 'Human decision',
    icon: ShieldCheck,
    title: 'Accountable outcome',
    detail: 'Named reviewers · reasons · conditions',
    accent: 'People remain responsible',
  },
];

function JourneyDocumentPreview({ step }: { step: number }) {
  const sheetClass = 'absolute border border-[#d5cab6] bg-[#fffdf8] shadow-[0_18px_38px_rgba(63,53,34,0.11)]';

  if (step === 0) {
    return (
      <div className="relative mt-8 h-[17rem]" aria-hidden="true">
        <div className={`${sheetClass} left-2 top-3 h-52 w-[82%] -rotate-2`} />
        <div className={`${sheetClass} bottom-0 right-1 w-[88%] rotate-1 p-4`}>
          <div className="flex items-start justify-between border-b border-[#ddd3c1] pb-3">
            <div><p className="text-[8px] font-bold uppercase tracking-[0.1em] text-gold-700">Core application</p><p className="mt-1 font-display text-xs font-bold text-ink-900">Event submission</p></div>
            <span className="bg-brand-100 px-2 py-1 text-[8px] font-bold uppercase text-brand-700">Ready</span>
          </div>
          <img src={heroUrl} alt="" className="mt-3 h-16 w-full object-cover object-[63%_52%]" />
          <dl className="mt-3 space-y-2 text-[9px]">
            <div className="flex justify-between"><dt className="text-ink-400">Scenario</dt><dd className="font-bold text-ink-700">Cultural event</dd></div>
            <div className="flex justify-between"><dt className="text-ink-400">Venue</dt><dd className="font-bold text-brand-700">Registry matched</dd></div>
            <div className="flex justify-between"><dt className="text-ink-400">Documents</dt><dd className="font-bold text-brand-700">6 of 6</dd></div>
          </dl>
        </div>
      </div>
    );
  }

  if (step === 1) {
    return (
      <div className="relative mt-8 h-[17rem]" aria-hidden="true">
        <div className={`${sheetClass} bottom-1 left-0 w-full p-4`}>
          <div className="flex items-start justify-between border-b border-[#ddd3c1] pb-3">
            <div><p className="text-[8px] font-bold uppercase tracking-[0.1em] text-gold-700">Risk assessment</p><p className="mt-1 font-display text-xs font-bold text-ink-900">Category analysis</p></div>
            <span className="bg-gold-200 px-2 py-1 text-[8px] font-extrabold uppercase text-gold-800">Medium</span>
          </div>
          <div className="mt-4 space-y-3 text-[9px]">
            {[['Crowd safety', '12'], ['Fire safety', '8'], ['Public health', '6'], ['Transport', '6']].map(([category, score], row) => (
              <div key={category} className="grid grid-cols-[1fr_3rem] items-center gap-3">
                <div><p className="font-bold text-ink-600">{category}</p><div className="mt-1 h-1 bg-[#e3dccf]"><div className={`${row === 0 ? 'w-4/5 bg-gold-400' : 'w-1/2 bg-brand-400'} h-full`} /></div></div>
                <span className="border border-[#d8cebc] py-1 text-center font-bold text-ink-700">{score}</span>
              </div>
            ))}
          </div>
          <p className="mt-4 border-t border-[#ddd3c1] pt-3 text-[9px] font-bold text-brand-700">Evidence-linked and rules validated</p>
        </div>
      </div>
    );
  }

  if (step === 2) {
    return (
      <div className="relative mt-8 h-[17rem]" aria-hidden="true">
        <div className={`${sheetClass} bottom-1 left-0 w-full p-4`}>
          <div className="flex items-start justify-between border-b border-[#ddd3c1] pb-3">
            <div><p className="text-[8px] font-bold uppercase tracking-[0.1em] text-gold-700">Agency review ledger</p><p className="mt-1 font-display text-xs font-bold text-ink-900">Assigned reviewers</p></div>
            <UserRoundCheck size={15} className="text-brand-600" />
          </div>
          <ul className="mt-4 space-y-3 text-[9px]">
            {['Police review', 'Fire & Rescue review', 'Health review'].map((agency) => (
              <li key={agency} className="flex items-center justify-between border-b border-[#e4dccf] pb-2.5">
                <span className="font-semibold text-ink-600">{agency}</span>
                <span className="flex items-center gap-1 font-bold text-brand-700"><Check size={10} />Signed</span>
              </li>
            ))}
          </ul>
          <div className="mt-5 flex items-center justify-between">
            <div><p className="text-[8px] font-bold uppercase tracking-[0.08em] text-ink-400">Review progress</p><p className="mt-1 font-display text-lg font-bold text-ink-900">3 / 3 complete</p></div>
            <span className="-rotate-6 rounded-full border-2 border-brand-600 px-2 py-3 text-[8px] font-extrabold uppercase text-brand-700">Reviewed</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative mt-8 h-[17rem]" aria-hidden="true">
      <div className={`${sheetClass} bottom-1 left-0 w-full p-4`}>
        <div className="flex items-start justify-between border-b border-[#ddd3c1] pb-3">
          <div><p className="text-[8px] font-bold uppercase tracking-[0.1em] text-gold-700">Public event record</p><p className="mt-1 font-display text-xs font-bold text-ink-900">Approval certificate</p></div>
          <span className="border-2 border-brand-600 px-2 py-1 text-[8px] font-extrabold uppercase tracking-[0.08em] text-brand-700">Approved</span>
        </div>
        <div className="mt-5 text-center">
          <img src={logoUrl} alt="" className="mx-auto h-14 w-14 opacity-75" />
          <p className="mt-3 font-display text-base font-bold text-ink-900">Approved public event</p>
          <p className="mt-1 text-[9px] text-ink-500">Safe event details ready for publication</p>
        </div>
        <div className="mt-5 flex items-end justify-between border-t border-[#ddd3c1] pt-3">
          <div><p className="font-display text-sm italic text-ink-700">Authorised</p><span className="block h-px w-20 bg-[#b8ac97]" /></div>
          <span className="text-[8px] font-bold uppercase tracking-[0.08em] text-brand-700">Record verified</span>
        </div>
      </div>
    </div>
  );
}

function ProcessDocumentPreview({ step }: { step: number }) {
  const paperClass = 'relative min-h-[18rem] border border-[#d5cab6] bg-[#fffdf8] p-5 shadow-[9px_10px_0_#eee7d8] transition-transform duration-300 ease-out group-hover:-translate-y-1';

  if (step === 0) {
    return (
      <div className={paperClass}>
        <div className="flex items-start justify-between border-b border-[#ddd3c1] pb-3">
          <div><p className="text-[9px] font-bold uppercase tracking-[0.1em] text-gold-700">Supporting evidence</p><p className="mt-1 font-display text-sm font-bold text-ink-900">Event evidence pack</p></div>
          <span className="bg-brand-100 px-2 py-1 text-[9px] font-bold uppercase text-brand-700">Complete</span>
        </div>
        <img src={heroUrl} alt="Prepared cultural event venue" className="mt-4 h-20 w-full object-cover object-[65%_52%]" />
        <dl className="mt-4 grid grid-cols-[1fr_auto] gap-x-3 gap-y-2 text-[10px]">
          <dt className="font-semibold text-ink-500">Venue plan</dt><dd className="font-bold text-brand-700">Verified</dd>
          <dt className="font-semibold text-ink-500">Medical plan</dt><dd className="font-bold text-brand-700">Attached</dd>
          <dt className="font-semibold text-ink-500">Traffic plan</dt><dd className="font-bold text-brand-700">Attached</dd>
        </dl>
        <p className="mt-4 border-t border-[#ddd3c1] pt-3 text-[10px] font-bold text-brand-700">A complete, versioned evidence pack</p>
      </div>
    );
  }

  if (step === 1) {
    return (
      <div className={paperClass}>
        <div className="flex items-start justify-between border-b border-[#ddd3c1] pb-3">
          <div><p className="text-[9px] font-bold uppercase tracking-[0.1em] text-gold-700">Assessment proposal</p><p className="mt-1 font-display text-sm font-bold text-ink-900">AI risk proposal</p></div>
          <Sparkles size={16} className="text-brand-600" />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 text-[9px] font-semibold text-ink-500">
          <span className="border border-[#ddd3c1] px-2 py-1.5">Crowd safety</span>
          <span className="border border-[#ddd3c1] px-2 py-1.5">Fire safety</span>
          <span className="border border-[#ddd3c1] px-2 py-1.5">Public health</span>
          <span className="border border-[#ddd3c1] px-2 py-1.5">Transport</span>
        </div>
        <div className="mt-4 flex items-center justify-between bg-cream-100 px-3 py-2.5">
          <span className="text-[9px] font-bold uppercase tracking-[0.08em] text-ink-500">Suggested risk</span>
          <span className="bg-gold-200 px-2 py-1 text-[9px] font-extrabold uppercase text-gold-800">Moderate</span>
        </div>
        <div className="mt-4 space-y-2" aria-hidden="true"><div className="h-1.5 w-full bg-[#ded6c7]" /><div className="h-1.5 w-5/6 bg-[#ded6c7]" /><div className="h-1.5 w-2/3 bg-[#ded6c7]" /></div>
        <p className="mt-4 border-t border-[#ddd3c1] pt-3 text-[10px] font-bold text-brand-700">Proposal retained as provenance</p>
      </div>
    );
  }

  if (step === 2) {
    return (
      <div className={paperClass}>
        <div className="flex items-start justify-between border-b border-[#ddd3c1] pb-3">
          <div><p className="text-[9px] font-bold uppercase tracking-[0.1em] text-gold-700">Rules validation</p><p className="mt-1 font-display text-sm font-bold text-ink-900">Risk calculation</p></div>
          <Fingerprint size={16} className="text-brand-600" />
        </div>
        <div className="mt-4 grid grid-cols-[auto_1fr] gap-4">
          <div className="grid h-24 w-24 grid-cols-5 gap-0.5 border border-[#d8cebc] bg-[#d8cebc] p-0.5" aria-label="Five by five risk matrix">
            {Array.from({ length: 25 }, (_, index) => (
              <span key={index} className={index === 8 || index === 13 ? 'bg-gold-300' : index > 14 ? 'bg-[#e8c3b4]' : 'bg-brand-100'} />
            ))}
          </div>
          <dl className="space-y-2 text-[9px]">
            <div><dt className="font-semibold text-ink-400">Likelihood</dt><dd className="font-bold text-ink-700">3 / 5</dd></div>
            <div><dt className="font-semibold text-ink-400">Severity</dt><dd className="font-bold text-ink-700">4 / 5</dd></div>
            <div><dt className="font-semibold text-ink-400">Matrix</dt><dd className="font-bold text-gold-700">12 · Medium</dd></div>
          </dl>
        </div>
        <div className="mt-4 space-y-2 text-[9px] font-semibold text-ink-500">
          <p className="flex items-center gap-2"><Check size={11} className="text-brand-600" />Hard-rule floors applied</p>
          <p className="flex items-center gap-2"><Check size={11} className="text-brand-600" />Resource ranges calculated</p>
        </div>
        <p className="mt-4 border-t border-[#ddd3c1] pt-3 text-[10px] font-bold text-brand-700">Same inputs, same result</p>
      </div>
    );
  }

  return (
    <div className={paperClass}>
      <div className="flex items-start justify-between border-b border-[#ddd3c1] pb-3">
        <div><p className="text-[9px] font-bold uppercase tracking-[0.1em] text-gold-700">Review outcome</p><p className="mt-1 font-display text-sm font-bold text-ink-900">Authority decision</p></div>
        <span className="border-2 border-brand-600 px-2 py-1 text-[9px] font-extrabold uppercase tracking-[0.08em] text-brand-700">Approved</span>
      </div>
      <dl className="mt-4 space-y-3 text-[9px]">
        <div className="flex justify-between border-b border-[#e2d9ca] pb-2"><dt className="font-semibold text-ink-400">Reviewed by</dt><dd className="font-bold text-ink-700">Multi-agency panel</dd></div>
        <div className="flex justify-between border-b border-[#e2d9ca] pb-2"><dt className="font-semibold text-ink-400">Risk outcome</dt><dd className="font-bold text-gold-700">Medium</dd></div>
        <div className="flex justify-between border-b border-[#e2d9ca] pb-2"><dt className="font-semibold text-ink-400">Conditions</dt><dd className="font-bold text-ink-700">Recorded</dd></div>
      </dl>
      <div className="mt-6 flex items-end justify-between">
        <div><p className="font-display text-lg italic text-ink-700">Approved</p><span className="mt-1 block h-px w-24 bg-[#b9ad98]" /><span className="mt-1 block text-[8px] font-semibold uppercase text-ink-400">Authorised signature</span></div>
        <img src={logoUrl} alt="" className="h-12 w-12 opacity-75" />
      </div>
      <p className="mt-4 border-t border-[#ddd3c1] pt-3 text-[10px] font-bold text-brand-700">People remain responsible</p>
    </div>
  );
}

export default function PublicHome() {
  const [selectedBenefit, setSelectedBenefit] = useState(0);
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

        <section id="how-it-works" className="relative scroll-mt-24 overflow-hidden border-b border-[#ded3c0]" aria-labelledby="journey-title">
          <div className="relative mx-auto max-w-[80rem] px-5 py-14 sm:py-16 sm:px-8">
            <div className="grid items-end gap-8 lg:grid-cols-[0.8fr_1.2fr]">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.11em] text-gold-700">The Malaysian approval journey</p>
                <h2 id="journey-title" className="mt-4 max-w-[14ch] font-display text-[clamp(2.25rem,4.6vw,4.4rem)] font-bold leading-[1.01] tracking-[-0.055em] text-ink-900">
                  How an application becomes approval
                </h2>
              </div>
              <div className="max-w-xl lg:justify-self-end">
                <p className="text-lg leading-8 text-ink-600">One connected route carries evidence from preparation to a public record you can trust.</p>
                <Link to="/login" className="mt-5 inline-flex min-h-11 items-center gap-2 font-bold text-brand-700 underline decoration-brand-300 underline-offset-4 hover:text-brand-600">
                  Continue to your workspace <ArrowRight size={16} />
                </Link>
              </div>
            </div>

            <div className="relative mt-16 lg:mt-24">


              <ol className="grid gap-12 lg:grid-cols-4 lg:gap-5">
                {journey.map(({ step, title, body, note, icon: Icon }, index) => (
                  <li key={step} className={`relative ${['lg:pt-24', 'lg:pt-16', 'lg:pt-8', 'lg:pt-0'][index]}`}>
                    <article className="pt-5">
                      <span className="font-display text-5xl font-bold tracking-[-0.08em] text-[#c9bea9]">{step}</span>
                      <div className="mt-3 flex items-start gap-3">
                        <Icon size={20} className="mt-1 shrink-0 text-brand-600" aria-hidden="true" />
                        <h3 className="font-display text-xl font-bold leading-tight text-ink-900">{title}</h3>
                      </div>
                      <p className="mt-4 text-sm leading-6 text-ink-600">{body}</p>
                      <p className="mt-5 text-[11px] font-bold uppercase tracking-[0.08em] text-gold-700">{note}</p>

                      <JourneyDocumentPreview step={index} />
                    </article>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        <section id="who-it-is-for" className="relative scroll-mt-24 overflow-hidden bg-brand-950 text-cream-50" aria-labelledby="roles-title">
          <div className="relative mx-auto max-w-[90rem] py-14 sm:py-16">
            <div className="px-5 sm:px-8 lg:px-14">
              <p className="text-xs font-bold uppercase tracking-[0.11em] text-gold-300">Two perspectives. One trusted outcome.</p>
              <h2 id="roles-title" className="mt-4 max-w-[20ch] font-display text-[clamp(2.25rem,4.7vw,4.5rem)] font-bold leading-[1.03] tracking-[-0.05em] text-cream-50">
                Built for organizers. Accountable to authorities.
              </h2>
            </div>

            <div className="mt-14 grid lg:grid-cols-[0.85fr_0.62fr_0.85fr]">
              <article className="border-y border-white/15 px-5 py-10 sm:px-8 lg:border-r lg:px-14 lg:py-14">
                <div className="flex items-center gap-3 text-gold-300"><Building2 size={20} /><span className="text-xs font-bold uppercase tracking-[0.11em]">For event organizers</span></div>
                <h3 className="mt-5 max-w-sm font-display text-2xl font-bold text-cream-50">Know what is ready before review begins.</h3>
                <ul className="mt-8 space-y-5">
                  {organizerCapabilities.map(([title, body]) => (
                    <li key={title} className="grid grid-cols-[1.25rem_1fr] gap-3">
                      <CheckCircle2 size={17} className="mt-0.5 text-gold-300" />
                      <div><p className="font-bold text-cream-50">{title}</p><p className="mt-1 text-sm leading-6 text-cream-100/80">{body}</p></div>
                    </li>
                  ))}
                </ul>
                <Link to="/register" className="mt-9 inline-flex min-h-11 items-center gap-2 font-bold text-gold-300 hover:text-gold-200">Create organizer account <ArrowRight size={16} /></Link>
              </article>

              <div className="relative min-h-[26rem] overflow-hidden border-b border-white/15 lg:min-h-0 lg:border-y" aria-hidden="true">
                <img src={planningUrl} alt="" className="absolute inset-0 h-full w-full object-cover object-[56%_center]" />
                <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(26,35,13,0.05),rgba(26,35,13,0.55))]" />
                <div className="absolute inset-x-5 bottom-6 border-l-2 border-gold-300 pl-4 text-sm font-semibold leading-6 text-cream-50">
                  One shared event history.<br />Clear responsibility at every handoff.
                </div>
              </div>

              <article className="border-b border-white/15 px-5 py-10 sm:px-8 lg:border-y lg:border-l lg:px-14 lg:py-14">
                <div className="flex items-center gap-3 text-gold-300"><UserRoundCheck size={20} /><span className="text-xs font-bold uppercase tracking-[0.11em]">For Admin and authorities</span></div>
                <h3 className="mt-5 max-w-sm font-display text-2xl font-bold text-cream-50">See the evidence behind every recommendation.</h3>
                <ul className="mt-8 space-y-5">
                  {authorityCapabilities.map(([title, body]) => (
                    <li key={title} className="grid grid-cols-[1.25rem_1fr] gap-3">
                      <CheckCircle2 size={17} className="mt-0.5 text-gold-300" />
                      <div><p className="font-bold text-cream-50">{title}</p><p className="mt-1 text-sm leading-6 text-cream-100/80">{body}</p></div>
                    </li>
                  ))}
                </ul>
                <Link to="/login" className="mt-9 inline-flex min-h-11 items-center gap-2 font-bold text-gold-300 hover:text-gold-200">Open secure workspace <ArrowRight size={16} /></Link>
              </article>
            </div>
          </div>
        </section>

        <section id="trust-model" className="relative scroll-mt-24 overflow-hidden border-b border-[#ddd1bd]" aria-labelledby="trust-title">
          <div className="relative mx-auto max-w-[80rem] px-5 py-14 sm:py-16 sm:px-8">
            <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-end">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.11em] text-gold-700">Evidence to decision</p>
                <h2 id="trust-title" className="mt-4 max-w-[18ch] font-display text-[clamp(2.25rem,4.5vw,4.25rem)] font-bold leading-[1.03] tracking-[-0.05em] text-ink-900">
                  AI can advise. Evidence and accountable people decide.
                </h2>
              </div>
              <p className="max-w-md text-lg leading-8 text-ink-600 lg:justify-self-end">STERAS preserves what the system suggested, what the rules calculated and who made the final call.</p>
            </div>

            <div className="mt-10 grid gap-8 lg:grid-cols-[0.8fr_1.2fr]">
              <div className="space-y-3" aria-label="Explore the benefits">{decisionFlow.map((item, index) => <button type="button" key={item.label} aria-pressed={selectedBenefit === index} onClick={() => setSelectedBenefit(index)} className={`w-full rounded-lg border p-5 text-left ${selectedBenefit === index ? 'border-brand-600 bg-brand-50' : 'border-cream-200 bg-white'}`}><span className="text-xs font-bold text-gold-700">0{index + 1}</span><h3 className="mt-2 font-display text-xl font-bold">{item.label}</h3><p className="mt-2 text-sm text-ink-600">{item.detail}</p></button>)}</div>
              <section aria-live="polite" className="rounded-lg bg-[#f7f2e8] p-6 sm:p-8"><p className="page-eyebrow">What this gives you</p><h3 className="font-display text-2xl font-bold">{decisionFlow[selectedBenefit].title}</h3><p className="mt-3 text-ink-600">{decisionFlow[selectedBenefit].accent}</p><div className="mx-auto mt-6 max-w-md"><ProcessDocumentPreview step={selectedBenefit} /></div></section>
            </div>

          </div>
        </section>

        <section className="bg-[#f3ead7]" aria-labelledby="privacy-title">
          <div className="mx-auto max-w-[80rem] px-5 py-14 sm:py-16 sm:px-8">
            <div className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.11em] text-gold-700">Public trust by design</p>
                <h2 id="privacy-title" className="mt-4 max-w-[13ch] font-display text-[clamp(2.25rem,4.3vw,4rem)] font-bold leading-[1.03] tracking-[-0.05em] text-ink-900">
                  Approval is visible. Restricted review detail is not.
                </h2>
                <p className="mt-6 max-w-lg text-base leading-7 text-ink-600">Visitors can verify approved event details. Sensitive evidence, reviewer identity and internal risk information remain protected.</p>
                <Link to="/calendar" className="mt-8 inline-flex min-h-11 items-center gap-2 font-bold text-brand-700 underline decoration-brand-300 underline-offset-4 hover:text-brand-600">
                  Explore approved events <ArrowRight size={16} />
                </Link>

                <div className="mt-12 border border-[#d3c6ae] bg-[#fffdf8] p-6 sm:p-8">
                  <div className="flex items-center justify-between border-b border-[#ddd2bf] pb-5">
                    <div>
                      <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-gold-700">Public register</p>
                      <h3 className="mt-2 font-display text-xl font-bold text-ink-900">Approved events</h3>
                    </div>
                    <CalendarDays size={22} className="text-brand-600" />
                  </div>
                  <div className="mt-6 grid gap-6 sm:grid-cols-[7rem_1fr]">
                    <div className="grid place-items-center border border-[#d8cdb9] bg-cream-100 px-3 py-5 text-center">
                      <span className="text-xs font-bold uppercase tracking-[0.1em] text-gold-700">Event date</span>
                      <span className="mt-2 font-display text-4xl font-bold text-ink-900">30</span>
                      <span className="font-bold text-brand-700">SEP</span>
                    </div>
                    <div>
                      <span className="inline-flex bg-brand-100 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-brand-700">Approved</span>
                      <p className="mt-3 font-display text-xl font-bold text-ink-900">A verified public event record</p>
                      <p className="mt-3 flex items-center gap-2 text-sm text-ink-600"><MapPin size={15} className="text-brand-600" />Safe venue and schedule details</p>
                      <p className="mt-2 flex items-center gap-2 text-sm text-ink-600"><ShieldCheck size={15} className="text-brand-600" />Published conditions and controls</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="relative">

                <div className="border border-[#bbb09b] bg-[#dfd9ca] p-5 shadow-[0_26px_70px_rgba(57,49,32,0.16)] sm:p-8">
                  <div className="flex items-center justify-between border-b border-[#b9ae9a] pb-5">
                    <div>
                      <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-brand-700">Restricted review dossier</p>
                      <p className="mt-2 text-sm text-ink-600">Visible only to authorised roles</p>
                    </div>
                    <span className="rotate-2 border-2 border-[#a63d32] px-3 py-1.5 text-xs font-extrabold uppercase tracking-[0.08em] text-[#a63d32]">Internal use only</span>
                  </div>
                  <div className="mt-8 grid gap-5 sm:grid-cols-[0.8fr_1.2fr]">
                    <div className="border border-[#c9bfac] bg-[#fffdf8] p-5">
                      <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-gold-700">Evidence index</p>
                      <ul className="mt-5 space-y-4 text-sm font-semibold text-ink-600">
                        <li className="flex items-center gap-2"><FileCheck2 size={15} className="text-brand-600" />Police comments</li>
                        <li className="flex items-center gap-2"><CloudSun size={15} className="text-brand-600" />Weather context</li>
                        <li className="flex items-center gap-2"><FileCheck2 size={15} className="text-brand-600" />Medical plan</li>
                        <li className="flex items-center gap-2"><FileCheck2 size={15} className="text-brand-600" />Resource policy</li>
                      </ul>
                    </div>
                    <div className="border border-[#c9bfac] bg-[#fffdf8] p-5">
                      <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-gold-700">Review notes</p>
                      <div className="mt-5 space-y-3" aria-hidden="true">
                        <div className="h-2 w-full bg-[#ddd5c6]" /><div className="h-2 w-4/5 bg-[#ddd5c6]" /><div className="h-2 w-11/12 bg-[#ddd5c6]" />
                      </div>
                      <p className="mt-7 text-[10px] font-bold uppercase tracking-[0.1em] text-gold-700">Risk calculation</p>
                      <div className="mt-4 grid grid-cols-5 gap-1" aria-hidden="true">
                        {[1, 2, 3, 4, 5].map((value) => <span key={value} className={`h-7 ${value < 4 ? 'bg-brand-200' : 'bg-gold-300'}`} />)}
                      </div>
                      <p className="mt-6 text-xs leading-5 text-ink-500">Contains personal data, operational plans and reviewer rationale protected by role-based access.</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="relative overflow-hidden bg-brand-900 text-cream-50">
          <div className="relative mx-auto grid max-w-[80rem] items-center gap-10 px-5 py-16 sm:px-8 md:grid-cols-[1fr_auto] md:py-20">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.11em] text-gold-300">A single workspace. A reasoned outcome.</p>
              <h2 className="mt-4 max-w-[16ch] font-display text-[clamp(2.25rem,4.4vw,4rem)] font-bold leading-[1.03] tracking-[-0.05em] text-cream-50">Prepare once. Review with confidence.</h2>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row md:flex-col">
              <Link to="/register" className="btn bg-gold-300 text-brand-950 hover:bg-gold-200 group">Start an application <ArrowRight size={17} className="transition-transform group-hover:translate-x-0.5" /></Link>
              <Link to="/calendar" className="btn border border-cream-50/40 bg-cream-50 text-brand-950 hover:bg-cream-100">Explore approved events</Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/15 bg-brand-950 text-cream-100">
        <div className="mx-auto grid max-w-[80rem] gap-10 px-5 py-12 sm:px-8 md:grid-cols-[1fr_auto] md:items-end">
          <div className="flex items-center gap-3">
            <img src={logoUrl} alt="" className="h-11 w-11 brightness-0 invert" />
            <div>
              <p className="font-display text-lg font-bold text-cream-50">STERAS</p>
              <p className="mt-1 text-sm text-cream-100/70">Smart Tourism Event Risk &amp; Approval System</p>
            </div>
          </div>
          <nav className="flex flex-wrap gap-x-7 gap-y-3 text-sm font-semibold" aria-label="Footer navigation">
            <a href="#how-it-works" className="hover:text-gold-300">How it works</a>
            <a href="#who-it-is-for" className="hover:text-gold-300">For organizers &amp; authorities</a>
            <Link to="/calendar" className="hover:text-gold-300">Approved events</Link>
            <Link to="/login" className="hover:text-gold-300">Sign in</Link>
          </nav>
        </div>
        <div className="mx-auto flex max-w-[80rem] flex-col gap-2 border-t border-white/10 px-5 py-5 text-xs text-cream-100/55 sm:px-8 md:flex-row md:items-center md:justify-between">
          <span>© 2026 STERAS. Public information is published only after approval.</span>
          <span>Malaysia tourism-event safety coordination</span>
        </div>
      </footer>
    </div>
  );
}

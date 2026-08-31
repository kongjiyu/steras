import { Check, FileCheck2, FileSearch, Files, ListChecks, MousePointer2, ScanText, Send, Sparkles } from 'lucide-react';

const STEPS = [
  ['Choose scenario', MousePointer2],
  ['Get recommendation', Sparkles],
  ['Preview templates', FileSearch],
  ['Prepare evidence', ListChecks],
  ['Start application', FileCheck2],
  ['Complete documents', Files],
  ['Auto-fill fields', ScanText],
  ['Review information', Check],
  ['Submit for review', Send],
] as const;

export default function ApplicationJourney({ activeStep = 2 }: { activeStep?: number }) {
  return (
    <section aria-labelledby="application-journey-title" className="overflow-hidden border-y border-[#d6ccb9] bg-brand-900 text-cream-50">
      <div className="px-5 py-5 sm:px-7">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.13em] text-gold-300">Your application journey</p>
            <h2 id="application-journey-title" className="mt-1 text-lg font-bold text-cream-50">Nine clear steps, from event idea to review</h2>
          </div>
          <p className="hidden text-sm text-brand-100 lg:block">You are at step {activeStep} of 9</p>
        </div>
        <ol className="mt-5 flex snap-x gap-0 overflow-x-auto pb-2" aria-label="Application progress">
          {STEPS.map(([label, Icon], index) => {
            const step = index + 1;
            const active = step === activeStep;
            const complete = step < activeStep;
            return (
              <li key={label} aria-current={active ? 'step' : undefined} className="relative min-w-[8rem] flex-1 snap-start pr-3 last:pr-0 lg:min-w-0">
                <div className="absolute left-8 right-0 top-[1.1rem] h-px bg-brand-700" aria-hidden="true" />
                <div className="relative flex items-center gap-2">
                  <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full border ${active ? 'border-gold-300 bg-gold-300 text-brand-950' : complete ? 'border-brand-300 bg-brand-700 text-cream-50' : 'border-brand-600 bg-brand-900 text-brand-200'}`}>
                    <Icon size={16} aria-hidden="true" />
                  </span>
                </div>
                <p className={`mt-3 max-w-[8rem] text-xs font-semibold leading-4 ${active ? 'text-gold-200' : 'text-brand-100'}`}>
                  <span className="mr-1 text-[10px] uppercase tracking-wider text-brand-300">{String(step).padStart(2, '0')}</span>
                  {label}
                </p>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

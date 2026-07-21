import type { ReactNode } from 'react';
import logoUrl from '../../assets/brand/steras-logo-horizontal.svg';
import inverseLogoUrl from '../../assets/brand/steras-logo-horizontal-inverse.svg';
import authVisualUrl from '../../assets/imagery/auth-event-planning.webp';

export default function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen bg-cream-50 lg:grid-cols-[minmax(0,1.15fr)_minmax(28rem,0.85fr)]">
      <section className="relative hidden min-h-screen overflow-hidden lg:block" aria-label="Malaysian event safety planning">
        <img src={authVisualUrl} alt="Malaysian event professionals reviewing a venue safety plan" className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-x-0 top-0 flex items-center justify-between border-b border-white/40 bg-[#34411c]/88 px-8 py-5">
          <img src={inverseLogoUrl} alt="STERAS" className="h-14 w-auto max-w-[21rem]" />
          <span className="text-xs font-semibold uppercase text-white">Authority-ready event approval</span>
        </div>
        <div className="absolute inset-x-0 bottom-0 bg-[#fffdf7]/92 px-8 py-6">
          <p className="max-w-2xl font-display text-xl font-semibold text-ink-800">Clear evidence. Coordinated review. Safer Malaysian tourism events.</p>
        </div>
      </section>

      <main className="relative flex min-h-screen items-center justify-center px-5 py-10 sm:px-10">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-[linear-gradient(90deg,#4f6120_0_68%,#f0c340_68%_84%,#2da44e_84%)]" />
        <div className="w-full max-w-md">
          <img src={logoUrl} alt="STERAS" className="mb-8 h-auto w-72 max-w-full lg:hidden" />
          {children}
        </div>
      </main>
    </div>
  );
}

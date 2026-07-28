import { AIAdvisoryAnalysis, RiskLevel } from '@shared/types';
import RiskMeter from '../ui/RiskMeter';

interface AIAdvisoryProps {
  advisory: AIAdvisoryAnalysis;
  officialRiskLevel: RiskLevel;
  showCategories?: boolean;
}
export default function AIAdvisory({ advisory, officialRiskLevel, showCategories = true }: AIAdvisoryProps) {
  const available = advisory.status === 'success';

  return (
    <div className="border-l-4 border-gold-300 bg-gold-50 p-4 sm:p-5" data-testid="ai-advisory">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.09em] text-gold-600">Advisory only · MiniMax M3</p>
          <h3 className="mt-1 font-display text-base font-semibold text-ink-800">AI evidence interpretation</h3>
        </div>
        <span className={`badge ${available ? 'badge-green' : 'badge-amber'}`}>{advisory.status}</span>
      </div>

      <p className="mt-3 text-sm leading-6 text-ink-700">
        {advisory.overallExplanation || 'AI advisory analysis is unavailable. The official deterministic result remains valid.'}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3 border-y border-gold-200 py-3 text-xs text-ink-600">
        {advisory.overallBand && <RiskMeter level={advisory.overallBand} size="compact" />}
        <span>Official result remains <strong>{officialRiskLevel}</strong>; this advisory cannot change it.</span>
      </div>

      {showCategories && advisory.categories.length > 0 && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {advisory.categories.map((category) => (
            <div key={category.categoryId} className="border-t border-gold-200 pt-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-semibold text-ink-800">{category.categoryId}</p>
                <RiskMeter level={category.advisoryBand} size="compact" />
              </div>
              <p className="mt-2 text-xs leading-5 text-ink-600">{category.explanation}</p>
            </div>
          ))}
        </div>
      )}

      {(advisory.keyConcerns.length > 0 || advisory.resourceConsiderations.length > 0) && (
        <div className="mt-4 grid gap-4 text-xs sm:grid-cols-2">
          <AdvisoryList title="Key concerns" items={advisory.keyConcerns} />
          <AdvisoryList title="Resource considerations" items={advisory.resourceConsiderations} />
        </div>
      )}
    </div>
  );
}

function AdvisoryList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="font-semibold text-ink-700">{title}</p>
      <ul className="mt-2 space-y-1.5 text-ink-600">
        {items.map((item) => <li key={item} className="flex gap-2"><span aria-hidden="true">—</span><span>{item}</span></li>)}
      </ul>
    </div>
  );
}

import { AIProposalAttempt, RiskLevel } from '@shared/types';
import RiskMeter from '../ui/RiskMeter';

interface AIAdvisoryProps {
  advisory: AIProposalAttempt | null;
  resultRiskLevel?: RiskLevel;
  showCategories?: boolean;
}

export default function AIAdvisory({ advisory, resultRiskLevel, showCategories = true }: AIAdvisoryProps) {
  const available = advisory?.status === 'success';
  return (
    <div className="border-l-4 border-gold-300 bg-gold-50 p-4 sm:p-5" data-testid="ai-advisory">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.09em] text-gold-600">AI proposal · MiniMax M3</p>
          <h3 className="mt-1 font-display text-base font-semibold text-ink-800">Hazard and category score proposal</h3>
        </div>
        <span className={`badge ${available ? 'badge-green' : 'badge-amber'}`}>{advisory?.status ?? 'not attempted'}</span>
      </div>
      {!available && (
        <p className="mt-3 text-sm leading-6 text-ink-700">
          {advisory?.errorSummary ?? 'AI assessment was not attempted because required evidence was insufficient.'}
        </p>
      )}
      {available && resultRiskLevel && (
        <div className="mt-4 flex flex-wrap items-center gap-3 border-y border-gold-200 py-3 text-xs text-ink-600">
          <RiskMeter level={resultRiskLevel} size="compact" />
          <span>Validated provisional result: <strong>{resultRiskLevel}</strong>. Authority confirmation is still required.</span>
        </div>
      )}
      {available && showCategories && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {advisory.categories.map((category) => (
            <div key={category.categoryId} className="border-t border-gold-200 pt-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-semibold text-ink-800">{category.categoryId.replaceAll('_', ' ')}</p>
                <span className="text-xs font-bold text-brand-700">L{category.likelihood} × S{category.severity}</span>
              </div>
              <p className="mt-2 text-xs leading-5 text-ink-600">{category.rationale}</p>
              <p className="mt-1 text-[11px] text-ink-500">Confidence: {category.confidence}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

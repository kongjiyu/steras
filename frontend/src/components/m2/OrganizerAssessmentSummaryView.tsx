import { OrganizerAssessmentSummary } from '@shared/types';
import RiskMeter from '../ui/RiskMeter';
import { RESOURCE_FIELDS } from './m2Presentation';

export default function OrganizerAssessmentSummaryView({ summary }: { summary: OrganizerAssessmentSummary }) {
  const hasResult = summary.overallScore !== undefined && summary.overallRiskLevel !== undefined;
  return (
    <div className="space-y-5" data-testid="organizer-assessment-summary">
      {hasResult ? (
        <>
          <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[#e3dacb] pb-5">
            <div><p className="mb-2 text-[11px] font-bold uppercase tracking-[0.09em] text-brand-700">Assessment summary</p><RiskMeter level={summary.overallRiskLevel!} /></div>
            <div className="text-right"><strong className="font-display text-4xl font-bold tabular-nums text-ink-900">{summary.overallScore}</strong><span className="ml-1 text-sm text-ink-500">/ 100 weighted</span></div>
          </div>
          <ol className="divide-y divide-[#e3dacb]">
            {summary.categories.map((category) => (
              <li key={category.categoryId} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <span className="font-display text-sm font-semibold text-ink-800">{category.categoryName}</span>
                <span className="text-xs text-ink-500">{category.riskLevel} · {category.normalizedScore}/100</span>
              </li>
            ))}
          </ol>
        </>
      ) : (
        <div className="border-l-4 border-gold-300 bg-gold-50 p-4 text-sm text-ink-700">
          <p className="font-semibold">{summary.status === 'failed' ? 'Assessment unavailable' : 'Manual Review Required'}</p>
          <p className="mt-1">No calculated risk result is available. An assigned authority can review or retry the assessment.</p>
        </div>
      )}
      {summary.authorityReviewRequired && <p className="border-l-4 border-gold-300 bg-gold-50 p-3 text-xs leading-5 text-ink-700">Authority review is required before this result can become official.</p>}
    </div>
  );
}

export function OrganizerResourceSummaryView({ summary }: { summary: OrganizerAssessmentSummary }) {
  if (!summary.resourceQuantities) return <p className="text-sm text-ink-500">Resources appear after a provisional assessment is available.</p>;
  return (
    <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="organizer-resource-summary">
      {RESOURCE_FIELDS.map(({ key, label }) => (
        <div key={key} className="border border-[#ded5c5] bg-cream-50 p-4">
          <dt className="text-xs text-ink-500">{label}</dt>
          <dd className="mt-1 font-display text-2xl font-bold text-ink-900">{summary.resourceQuantities![key]}</dd>
        </div>
      ))}
    </dl>
  );
}

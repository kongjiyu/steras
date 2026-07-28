import { RiskAssessment } from '@shared/types';
import RiskMeter from '../ui/RiskMeter';

interface CategoryProfileProps {
  assessment: RiskAssessment;
  density?: 'compact' | 'detailed';
  showVersion?: boolean;
}

export default function CategoryProfile({
  assessment,
  density = 'detailed',
  showVersion = true,
}: CategoryProfileProps) {
  const compact = density === 'compact';
  const isAllHazardsV2 = Boolean(assessment.hazards?.length && assessment.officialMatrixScore);

  return (
    <div className="space-y-5" data-testid="official-category-profile">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[#e3dacb] pb-5">
        <div>
          <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.09em] text-brand-700">Official deterministic result</p>
          <RiskMeter level={assessment.officialRiskLevel} />
        </div>
        <div className="text-right">
          <strong className="font-display text-4xl font-bold tabular-nums text-ink-900">{assessment.officialScore}</strong>
          <span className="ml-1 text-sm text-ink-500">/ 100 official</span>
        </div>
      </div>

      {isAllHazardsV2 && (
        <dl className="grid gap-3 sm:grid-cols-4">
          <StatusMeta label="HIRARC matrix" value={`${assessment.officialMatrixScore}/25`} />
          <StatusMeta label="Assessment readiness" value={humanize(assessment.assessmentReadiness)} />
          <StatusMeta label="Compliance" value={humanize(assessment.complianceStatus)} />
          <StatusMeta label="Data confidence" value={`${assessment.dataConfidenceScore}% · ${assessment.dataConfidenceLevel}`} />
        </dl>
      )}

      {isAllHazardsV2 && assessment.manualReviewRequired && (
        <p className="border-l-4 border-gold-300 bg-gold-50 p-3 text-xs leading-5 text-ink-700">
          Manual review required. Readiness and compliance are separate gates and are not overridden by the numerical risk result.
        </p>
      )}

      {showVersion && (
        <dl className="grid gap-x-5 gap-y-3 border-y border-[#e3dacb] py-3 text-xs sm:grid-cols-3">
          <Meta label="Category schema" value={assessment.categorySchemaVersion} />
          <Meta label="Scoring logic" value={assessment.scoringLogicVersion} />
          <Meta label="Schema status" value={assessment.categorySchemaStatus} />
        </dl>
      )}

      <ol className={compact ? 'divide-y divide-[#e3dacb]' : 'grid gap-3 sm:grid-cols-2'}>
        {assessment.categoryAssignments.map((category) => (
          <li key={category.categoryId} className={compact ? 'py-3 first:pt-0 last:pb-0' : 'border border-[#ded5c5] bg-cream-50 p-4'}>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-display text-sm font-semibold text-ink-800">{category.categoryName}</p>
                  <strong className="shrink-0 text-sm tabular-nums text-brand-700">{category.score}/100</strong>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden bg-[#e1dfd4]" aria-hidden="true">
                  <span className="block h-full bg-brand-600" style={{ width: `${Math.max(0, Math.min(100, category.score))}%` }} />
                </div>
              </div>
            </div>
            {!compact && <p className="mt-3 text-xs leading-5 text-ink-600">{category.rationale}</p>}
            <p className="mt-2 text-[11px] text-ink-500">
              {isAllHazardsV2
                ? `Dominant residual hazard · ${category.riskLevel}`
                : `Weight ${(category.weight * 100).toFixed(0)}% · contribution ${category.weightedContribution} · ${category.riskLevel}`}
            </p>
            {!compact && category.guidelineChecks.length > 0 && (
              <p className="mt-2 text-[11px] leading-5 text-ink-500">Checks: {category.guidelineChecks.join(' · ')}</p>
            )}
          </li>
        ))}
      </ol>

      {isAllHazardsV2 && !compact && (
        <details className="border-t border-[#e3dacb] pt-3">
          <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-brand-700">
            View residual hazard register
          </summary>
          <div className="mt-2 divide-y divide-[#e3dacb] border-y border-[#e3dacb]">
            {assessment.hazards!.map((hazard) => (
              <div key={hazard.hazardId} className="grid gap-2 py-3 text-xs sm:grid-cols-[minmax(0,1fr)_8rem_8rem]">
                <div>
                  <p className="font-semibold text-ink-800">{hazard.hazardName}</p>
                  <p className="mt-1 text-ink-500">{hazard.domain.replaceAll('_', ' ')}</p>
                </div>
                <p className="text-ink-600">Inherent {hazard.inherentLikelihood}×{hazard.inherentSeverity}</p>
                <p className="font-semibold text-brand-700">Residual {hazard.residualLikelihood}×{hazard.residualSeverity} · {hazard.riskLevel}</p>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-ink-500">{label}</dt>
      <dd className="mt-0.5 break-words font-semibold text-ink-800">{value}</dd>
    </div>
  );
}

function StatusMeta({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-t-2 border-brand-200 bg-cream-50 p-3">
      <dt className="text-[11px] uppercase tracking-[0.04em] text-ink-500">{label}</dt>
      <dd className="mt-1 font-semibold capitalize text-ink-800">{value}</dd>
    </div>
  );
}

function humanize(value: string | undefined): string {
  return value?.replaceAll('_', ' ') ?? 'Legacy record';
}

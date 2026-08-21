import { RiskAssessment } from '@shared/types';
import RiskMeter from '../ui/RiskMeter';
import { assessmentResult } from './m2Contract';

interface CategoryProfileProps {
  assessment: RiskAssessment;
  density?: 'compact' | 'detailed';
  showVersion?: boolean;
  audience?: 'authority' | 'organizer';
}

export default function CategoryProfile({ assessment, density = 'detailed', showVersion = true, audience = 'authority' }: CategoryProfileProps) {
  const compact = density === 'compact';
  const showInternalDetails = audience === 'authority';
  const result = assessmentResult(assessment);
  if (!result) {
    return (
      <div className="border-l-4 border-gold-300 bg-gold-50 p-4 text-sm text-ink-700">
        <p className="font-semibold">Manual Review Required</p>
        <p className="mt-1">{assessment.status === 'manual_review_required' ? assessment.manualReviewReason : 'No calculated result is available.'}</p>
      </div>
    );
  }

  return (
    <div className="space-y-5" data-testid="official-category-profile">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[#e3dacb] pb-5">
        <div>
          <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.09em] text-brand-700">
            {assessment.status === 'official_ready' ? 'Official result' : 'Validated provisional result'}
          </p>
          <RiskMeter level={result.overallRiskLevel} />
        </div>
        <div className="text-right">
          <strong className="font-display text-4xl font-bold tabular-nums text-ink-900">{result.overallScore}</strong>
          <span className="ml-1 text-sm text-ink-500">/ 100 weighted</span>
        </div>
      </div>

      <dl className={`grid gap-3 ${showInternalDetails ? 'sm:grid-cols-4' : 'sm:grid-cols-2'}`}>
        <StatusMeta label="Assessment readiness" value={humanize(assessment.assessmentReadiness)} />
        <StatusMeta label="Compliance" value={humanize(assessment.complianceStatus)} />
        {showInternalDetails && <StatusMeta label="Data confidence" value={`${assessment.dataConfidenceScore}% · ${assessment.dataConfidenceLevel}`} />}
        {showInternalDetails && <StatusMeta label="Warnings" value={String(assessment.warnings.length)} />}
      </dl>

      {assessment.authorityReviewRequired && (
        <p className="border-l-4 border-gold-300 bg-gold-50 p-3 text-xs leading-5 text-ink-700">
          Authority review is required. A provisional score cannot be used as the official approval result.
        </p>
      )}

      {showVersion && (
        <dl className="grid gap-x-5 gap-y-3 border-y border-[#e3dacb] py-3 text-xs sm:grid-cols-3">
          <Meta label="Assessment schema" value={assessment.schemaVersion} />
          <Meta label="Category schema" value={result.categorySchemaVersion} />
          <Meta label="Formula" value={result.formulaVersion} />
        </dl>
      )}

      <ol className={compact ? 'divide-y divide-[#e3dacb]' : 'grid gap-3 sm:grid-cols-2'}>
        {result.categories.map((category) => (
          <li key={category.categoryId} className={compact ? 'py-3 first:pt-0 last:pb-0' : 'border border-[#ded5c5] bg-cream-50 p-4'}>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-display text-sm font-semibold text-ink-800">{category.categoryName}</p>
                  <strong className="shrink-0 text-sm tabular-nums text-brand-700">{category.normalizedScore}/100</strong>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden bg-[#e1dfd4]" aria-hidden="true">
                  <span className="block h-full bg-brand-600" style={{ width: `${category.normalizedScore}%` }} />
                </div>
              </div>
            </div>
            {!compact && <p className="mt-3 text-xs leading-5 text-ink-600">{category.rationale}</p>}
            {showInternalDetails && !compact && 'missingInformation' in category && typeof category.missingInformation === 'string' && category.missingInformation && (
              <p className="mt-2 text-xs leading-5 text-gold-700">Missing information: {category.missingInformation}</p>
            )}
            <p className="mt-2 text-[11px] text-ink-500">
              {showInternalDetails
                ? `${'manualLikelihood' in category ? 'Admin input' : 'Proposed'} ${'manualLikelihood' in category ? category.manualLikelihood : category.proposedLikelihood}×${'manualSeverity' in category ? category.manualSeverity : category.proposedSeverity} · validated ${category.validatedLikelihood}×${category.validatedSeverity} · ${category.riskLevel}`
                : `${category.riskLevel} ${assessment.status === 'official_ready' ? 'official' : 'provisional'} category level`}
            </p>
            {showInternalDetails && !compact && category.appliedHardRules.length > 0 && <ul className="mt-2 space-y-1 text-[11px] leading-5 text-gold-700">{category.appliedHardRules.map((rule) => <li key={rule.ruleId}><strong>{rule.axis} uplift {rule.proposedValue}→{rule.constrainedValue}:</strong> {rule.rationale} ({rule.guidelineReferences.join(', ')})</li>)}</ul>}
          </li>
        ))}
      </ol>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-ink-500">{label}</dt><dd className="mt-0.5 break-words font-semibold text-ink-800">{value}</dd></div>;
}

function StatusMeta({ label, value }: { label: string; value: string }) {
  return <div className="border-t-2 border-brand-200 bg-cream-50 p-3"><dt className="text-[11px] uppercase tracking-[0.04em] text-ink-500">{label}</dt><dd className="mt-1 font-semibold capitalize text-ink-800">{value}</dd></div>;
}

function humanize(value: string): string {
  return value.replaceAll('_', ' ');
}

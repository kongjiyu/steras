import { ResourceRecommendation as ResourceRecommendationRecord } from '@shared/types';
import { formatM2Timestamp, RESOURCE_FIELDS } from './m2Presentation';

interface ResourceRecommendationProps {
  recommendation: ResourceRecommendationRecord;
  showRationales?: boolean;
  showOverrideProvenance?: boolean;
}

export default function ResourceRecommendation({
  recommendation,
  showRationales = true,
  showOverrideProvenance = false,
}: ResourceRecommendationProps) {
  const manualOfficial = recommendation.stage === 'official'
    && recommendation.assessmentReference.sourceKind === 'admin_manual';
  const override = recommendation as ResourceRecommendationRecord & {
    overriddenBy?: string;
    overrideRationale?: string;
    overriddenAt?: number;
  };
  return (
    <div className="space-y-5" data-testid="resource-recommendation">
      <div className="grid grid-cols-2 gap-x-5 border-y border-[#e3dacb] sm:grid-cols-4">
        {RESOURCE_FIELDS.map(({ key, label }) => (
          <div key={key} className="border-b border-[#e3dacb] py-4 sm:last:border-b-0">
            <p className="text-xs text-ink-500">{label}</p>
            <p className="mt-1 font-display text-2xl font-bold tabular-nums text-ink-900">{recommendation.items[key].baseline}</p>
            <p className="mt-1 text-[11px] text-ink-500">
              Planning range {recommendation.items[key].planningRange.min}–{recommendation.items[key].planningRange.max}
            </p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-ink-500">
        <span>Formula <strong className="text-ink-700">{recommendation.formulaVersion}</strong></span>
        <span>Config <strong className="text-ink-700">{recommendation.configVersion}</strong></span>
        <span>Revision <strong className="text-ink-700">{recommendation.revision}</strong></span>
        <span className={recommendation.confidenceLevel === 'authority_validated' ? 'text-status-approved' : 'text-gold-600'}>
          <strong>{recommendation.confidenceLevel === 'authority_validated' ? manualOfficial ? 'Admin manual risk input' : 'Official risk input only' : 'Prototype guidance'}</strong>
        </span>
      </div>

      {recommendation.notes && <p className="border-l-2 border-brand-200 pl-3 text-xs leading-5 text-ink-600">{recommendation.notes}</p>}

      {showOverrideProvenance && override.overriddenBy && (
        <div className="rounded-md border border-brand-200 bg-brand-50/50 p-3 text-xs leading-5 text-ink-700">
          <p className="font-semibold text-brand-800">Authority resource adjustment recorded</p>
          <p className="mt-1">Adjusted by <span className="font-mono">{override.overriddenBy}</span>{override.overriddenAt ? ` on ${formatM2Timestamp(override.overriddenAt)}` : ''}.</p>
          {override.overrideRationale && <p className="mt-1">Reason: {override.overrideRationale}</p>}
        </div>
      )}

      <p className="border-l-4 border-gold-300 bg-gold-50 p-3 text-xs leading-5 text-ink-700">
        These are internal prototype planning ranges, not statutory or authority-issued minimums. Finalising the risk score does not validate these resource ratios; they require a separate future resource-review workflow.
      </p>

      {showRationales && (
        <details>
          <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-brand-700">View quantity rationale</summary>
          <div className="mt-2 divide-y divide-[#e3dacb] border-y border-[#e3dacb]">
            {RESOURCE_FIELDS.map(({ key, label }) => {
              const item = recommendation.items[key];
              return (
                <div key={key} className="grid gap-2 py-3 text-xs sm:grid-cols-[9rem_minmax(0,1fr)]">
                  <div>
                    <p className="font-semibold text-ink-800">{label}</p>
                    <p className="mt-0.5 text-ink-500">Mapped authority: {item.reviewingAuthority}</p>
                  </div>
                  <div className="text-ink-600">
                    {item.assumptions.map((assumption) => <p key={assumption.assumptionId}>{assumption.statement}</p>)}
                    <p className="mt-1 text-ink-500">
                      Risk input: {item.authorityReviewRequired ? 'provisional' : 'finalized'} · resource ratio: prototype unverified
                    </p>
                    <ul className="mt-2 space-y-1 text-ink-500">
                      {item.inputReferences.map((input) => <li key={input.inputId}>Input {input.path}: <strong className="text-ink-700">{String(input.value)}</strong></li>)}
                    </ul>
                    <ul className="mt-2 space-y-1 text-ink-500">
                      {item.appliedRules.map((rule) => <li key={rule.ruleId}><strong className="text-ink-700">{rule.ruleId}</strong>: {rule.description} Contribution {rule.contribution}.</li>)}
                    </ul>
                    <ul className="mt-2 space-y-1 text-ink-500">
                      {item.sourceSnapshots.map((source) => (
                        <li key={source.sourceId}>
                          {source.title} · {source.issuer} · {source.kind} · version {source.version} · retrieved {formatM2Timestamp(source.retrievedAt)} · {source.locator || 'internal locator'} · {source.verificationStatus}
                        </li>
                      ))}
                    </ul>
                    {item.authoritySource.status === 'not_supplied'
                      ? <p className="mt-1 text-gold-600">Authority source not supplied: {item.authoritySource.reason}</p>
                      : <p className="mt-1 text-ink-500">
                          Authority source: {item.authoritySource.source.title} · {item.authoritySource.source.issuer} · {item.authoritySource.source.kind}
                          {' '}· version {item.authoritySource.source.version} · retrieved {formatM2Timestamp(item.authoritySource.source.retrievedAt)}
                          {' '}· {item.authoritySource.source.locator} · {item.authoritySource.source.verificationStatus}
                        </p>}
                  </div>
                </div>
              );
            })}
          </div>
        </details>
      )}

      {recommendation.supersedesResourceId && <p className="text-xs text-ink-500">Supersedes resource revision {recommendation.supersedesResourceId}.</p>}
    </div>
  );
}

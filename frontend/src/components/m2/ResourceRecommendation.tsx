import { ResourceRecommendation as ResourceRecommendationRecord } from '@shared/types';
import { RESOURCE_FIELDS } from './m2Presentation';

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
  return (
    <div className="space-y-5" data-testid="resource-recommendation">
      <div className="grid grid-cols-2 gap-x-5 border-y border-[#e3dacb] sm:grid-cols-4">
        {RESOURCE_FIELDS.map(({ key, label }) => (
          <div key={key} className="border-b border-[#e3dacb] py-4 sm:last:border-b-0">
            <p className="text-xs text-ink-500">{label}</p>
            <p className="mt-1 font-display text-2xl font-bold tabular-nums text-ink-900">{recommendation[key]}</p>
            {recommendation.items?.find((item) => item.resource === key) && (
              <p className="mt-1 text-[11px] text-ink-500">
                Planning range {recommendation.items.find((item) => item.resource === key)!.planningRange.min}–
                {recommendation.items.find((item) => item.resource === key)!.planningRange.max}
              </p>
            )}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-ink-500">
        <span>Formula <strong className="text-ink-700">{recommendation.formulaVersion}</strong></span>
        <span>Guideline <strong className="text-ink-700">{recommendation.guidelineVersion}</strong></span>
        <span className={recommendation.confidenceLevel === 'authorityValidated' ? 'text-status-approved' : 'text-gold-600'}>
          <strong>{recommendation.confidenceLevel === 'authorityValidated' ? 'Authority validated' : 'Prototype guidance'}</strong>
        </span>
      </div>

      {recommendation.notes && <p className="border-l-2 border-brand-200 pl-3 text-xs leading-5 text-ink-600">{recommendation.notes}</p>}

      {recommendation.items?.length && (
        <p className="border-l-4 border-gold-300 bg-gold-50 p-3 text-xs leading-5 text-ink-700">
          These are prototype planning ranges, not statutory minimums. PDRM, BOMBA, and KKM reviewers must validate the resources in their remit.
        </p>
      )}

      {showRationales && (
        <details>
          <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-brand-700">View quantity rationale</summary>
          <div className="mt-2 divide-y divide-[#e3dacb] border-y border-[#e3dacb]">
            {RESOURCE_FIELDS.map(({ key, label }) => {
              const rationale = recommendation.rationales?.[key];
              if (!rationale) return null;
              return (
                <div key={key} className="grid gap-2 py-3 text-xs sm:grid-cols-[9rem_minmax(0,1fr)]">
                  <div>
                    <p className="font-semibold text-ink-800">{label}</p>
                    <p className="mt-0.5 text-ink-500">Baseline {rationale.baselineQuantity}</p>
                  </div>
                  <div className="text-ink-600">
                    <p>{rationale.factors.join(' · ')}</p>
                    {rationale.guidelineReferences.length > 0 && <p className="mt-1 text-ink-500">Refs: {rationale.guidelineReferences.join(', ')}</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </details>
      )}

      {recommendation.aiConsiderations.length > 0 && (
        <div className="border-l-4 border-gold-300 bg-gold-50 p-4 text-xs text-ink-600">
          <p className="font-semibold text-gold-600">AI considerations · advisory only</p>
          <ul className="mt-2 space-y-1.5">
            {recommendation.aiConsiderations.map((item) => <li key={item}>— {item}</li>)}
          </ul>
        </div>
      )}

      {showOverrideProvenance && recommendation.overrideRationale && (
        <div className="border-l-4 border-brand-400 bg-brand-50 p-4 text-xs text-ink-600">
          <p className="font-semibold text-brand-700">Human authority adjustment</p>
          <p className="mt-1 leading-5">{recommendation.overrideRationale}</p>
        </div>
      )}
    </div>
  );
}

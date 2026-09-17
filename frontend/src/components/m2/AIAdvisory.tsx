import { AIProposalAttempt, RiskLevel, ScoreRating } from '@shared/types';
import type { ReactNode } from 'react';
import { Pencil } from 'lucide-react';
import RiskMeter from '../ui/RiskMeter';

interface AIAdvisoryProps {
  advisory: AIProposalAttempt | null;
  resultRiskLevel?: RiskLevel;
  showCategories?: boolean;
  official?: boolean;
  canEdit?: boolean;
  onEdit?: () => void;
  /** Action label used by authority pages to make the score-review intent explicit. */
  editLabel?: string;
  reviewStatus?: string;
  /** Current officer review scores, kept separate from the immutable AI proposal. */
  reviewedCategories?: Array<{ categoryId: string; likelihood: ScoreRating; severity: ScoreRating }>;
  /** Embedded authority editor rendered inside this proposal card. */
  editor?: ReactNode;
}

export default function AIAdvisory({ advisory, resultRiskLevel, showCategories = true, official = false, canEdit = false, onEdit, editLabel, reviewStatus, reviewedCategories, editor }: AIAdvisoryProps) {
  const available = advisory?.status === 'success';
  const reviewedByCategory = new Map((reviewedCategories ?? []).map((category) => [category.categoryId, category]));
  return (
    <div className="border-l-4 border-gold-300 bg-gold-50 p-4 sm:p-5" data-testid="ai-advisory">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.09em] text-gold-600">AI proposal · MiniMax AI</p>
          <h3 className="mt-1 font-display text-base font-semibold text-ink-800">Hazard and category score proposal</h3>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`badge ${available ? 'badge-green' : 'badge-amber'}`}>{advisory?.status ?? 'not attempted'}</span>
          {reviewStatus && <span className="badge bg-green-100 text-status-approved" data-testid="score-review-status">{reviewStatus}</span>}
          {canEdit && onEdit && <button type="button" className="btn-secondary !min-h-9 !px-3 !py-1.5 text-xs" onClick={onEdit} data-testid="ai-proposal-edit"><Pencil size={13} /> {editLabel ?? 'Edit'}</button>}
        </div>
      </div>
      {!available && (
        <p className="mt-3 text-sm leading-6 text-ink-700">
          {advisory?.errorSummary ?? 'AI assessment was not attempted because required evidence was insufficient.'}
        </p>
      )}
      {available && resultRiskLevel && (
        <div className="mt-4 flex flex-wrap items-center gap-3 border-y border-gold-200 py-3 text-xs text-ink-600">
          <RiskMeter level={resultRiskLevel} size="compact" />
          <span>{official ? 'Official AI-assisted result' : 'Validated provisional result'}: <strong>{resultRiskLevel}</strong>{official ? '.' : '. Authority confirmation is still required.'}</span>
        </div>
      )}
      {available && editor && (
        <div className="mt-4" data-testid="ai-advisory-editor">
          {editor}
        </div>
      )}
      {available && showCategories && !editor && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {advisory.categories.map((category) => (
            <div key={category.categoryId} className="border-t border-gold-200 pt-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-semibold text-ink-800">{category.categoryId.replaceAll('_', ' ')}</p>
                <span className="text-xs font-bold text-brand-700">L{reviewedByCategory.get(category.categoryId)?.likelihood ?? category.likelihood} × S{reviewedByCategory.get(category.categoryId)?.severity ?? category.severity}</span>
              </div>
              {reviewedByCategory.has(category.categoryId) && <p className="mt-1 text-[11px] text-brand-700">Officer review · AI proposal L{category.likelihood} × S{category.severity}</p>}
              <p className="mt-2 text-xs leading-5 text-ink-600">{category.rationale}</p>
              <p className="mt-1 text-[11px] text-ink-500">Confidence: {category.confidence}</p>
              {category.concerns.length > 0 && <p className="mt-2 text-[11px] leading-5 text-gold-700">Concerns: {category.concerns.join('; ')}</p>}
              {category.missingInformation.length > 0 && <p className="mt-1 text-[11px] leading-5 text-gold-700">Missing information: {category.missingInformation.join('; ')}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

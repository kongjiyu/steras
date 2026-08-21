import { ValidationWarning } from '@shared/types';

export default function AuthorityAssessmentWarnings({ warnings }: { warnings: ValidationWarning[] }) {
  if (warnings.length === 0) return null;
  return (
    <div className="rounded-md border border-gold-200 bg-gold-50 p-4" data-testid="assessment-warning-details">
      <h3 className="font-display text-sm font-semibold text-ink-800">Validation warnings</h3>
      <ul className="mt-3 space-y-3">
        {warnings.map((warning) => (
          <li key={warning.warningId} className="text-xs leading-5 text-ink-700">
            <p><span className="font-semibold text-ink-800">{formatWorkflowValue(warning.code)}</span>{warning.categoryId ? ` · ${formatWorkflowValue(warning.categoryId)}` : ''}</p>
            <p>{warning.message}</p>
            {warning.evidenceReferences.length > 0 && <p className="text-ink-500">Evidence: {warning.evidenceReferences.map(formatWorkflowValue).join(', ')}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function formatWorkflowValue(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

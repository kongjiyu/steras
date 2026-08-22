import { RiskAssessment } from '@shared/types';
import { formatM2Timestamp } from './m2Presentation';

export default function ContextEvidence({ assessment }: { assessment: RiskAssessment }) {
  const { contextSnapshot } = assessment;
  const weather = contextSnapshot.weather;
  const calendar = contextSnapshot.calendar;
  const venue = contextSnapshot.venue;
  const history = contextSnapshot.incidentHistory;

  return (
    <div data-testid="context-evidence">
      <div className="grid gap-3 sm:grid-cols-2">
        <EvidenceCell
          label="Weather"
          status={`${weather.source} · ${weather.freshness}`}
          value={weather.data ? `${weather.data.forecast}; ${weather.data.precipitationProbability}% precipitation` : `Measurements unavailable · ${weather.unavailableReason ?? 'provider unavailable'}`}
          timestamp={weather.fetchedAt}
        />
        <EvidenceCell
          label="Calendar"
          status={calendar.coverageStatus === 'unsupported_year' ? 'Dataset year unsupported' : calendar.isHolidayOrAdjacent ? 'Holiday context matched' : calendar.isWeekend ? 'Weekend context' : 'Standard weekday'}
          value={`${calendar.localDate} · ${calendar.dayOfWeek}${calendar.holidayName ? ` · ${calendar.holidayName}` : ''}${calendar.coverageStatus === 'unsupported_year' ? ' · public-holiday status unavailable' : ''}`}
          timestamp={calendar.sourceTimestamp}
        />
        <EvidenceCell
          label="Venue"
          status={venue.matched ? 'Registry matched' : 'Submitted data only'}
          value={venue.matched && venue.registeredCapacity
            ? `${venue.submittedCapacity.toLocaleString()} submitted · ${venue.registeredCapacity.toLocaleString()} registered`
            : `${venue.submittedCapacity.toLocaleString()} submitted capacity`}
          timestamp={venue.fetchedAt}
        />
        <EvidenceCell
          label="Comparable history"
          status={history.syntheticStatus === 'all' || history.syntheticEvidence
            ? 'Synthetic demo evidence'
            : history.syntheticStatus === 'partial' ? 'Mixed real and synthetic evidence'
            : history.matched ? 'Venue history matched' : 'No stable venue match'}
          value={history.historicalEventCount !== undefined
            ? `${history.historicalEventCount} comparable events · ${history.total} eligible incidents · ${formatRate(history.patientPresentationRatePerThousand)} patient presentations/1,000`
            : `${history.total} eligible incidents · ${history.bySeverity.high} high severity`}
          timestamp={history.fetchedAt}
        />
      </div>

      {(history.syntheticEvidence || history.syntheticStatus === 'all' || history.syntheticStatus === 'partial') && (
        <p className="mt-3 border-l-4 border-gold-300 bg-gold-50 p-3 text-xs leading-5 text-ink-700">
          {history.syntheticStatus === 'partial'
            ? 'This history mixes verified records with generated demo data. Synthetic items are identified in the provenance ledger and do not count as verified controls.'
            : 'This history is generated demo data. It supports retrieval and UI testing only; it is not evidence of real incidents or predictive accuracy.'}
        </p>
      )}

      {assessment.evidence.length > 0 && (
        <details className="mt-4 border-t border-[#e3dacb] pt-3">
          <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-brand-700">View score evidence ledger</summary>
          <dl className="mt-2 divide-y divide-[#e3dacb] text-xs">
            {assessment.evidence.map((item) => (
              <div key={item.key} className="grid gap-1 py-3 sm:grid-cols-[7rem_minmax(0,1fr)_10rem] sm:gap-3">
                <dt className="font-semibold capitalize text-ink-800">{item.key}</dt>
                <dd className="text-ink-600">{item.description}</dd>
                <dd className="text-ink-500 sm:text-right">{item.source} · {item.status}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
      {assessment.contextEvidence.length > 0 && (
        <details className="mt-4 border-t border-[#e3dacb] pt-3">
          <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-brand-700">View contextual provenance</summary>
          <ul className="mt-2 divide-y divide-[#e3dacb] text-xs">
            {assessment.contextEvidence.map((item) => <li key={item.evidenceId} className="grid gap-1 py-3 sm:grid-cols-[8rem_minmax(0,1fr)_8rem]"><strong>{item.evidenceKey}</strong><span className="break-all text-ink-600">{item.sourceKind} · {item.sourceLocator} · {item.sourceVersion}</span><span className="sm:text-right">{item.eligibility} · {item.synthetic ? 'synthetic' : 'non-synthetic'}</span>{item.eligibilityReason && <span className="text-gold-700 sm:col-span-3">{item.eligibilityReason}</span>}</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}

function formatRate(value: number | undefined): string {
  return value === undefined ? 'n/a' : value.toFixed(2);
}

function EvidenceCell({ label, status, value, timestamp }: { label: string; status: string; value: string; timestamp: number }) {
  return (
    <div className="border-t-2 border-brand-200 bg-cream-50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="font-display text-sm font-semibold text-ink-800">{label}</p>
        <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-brand-700">{status}</span>
      </div>
      <p className="mt-2 text-xs leading-5 text-ink-600">{value}</p>
      <p className="mt-2 text-[11px] text-ink-500">Captured {formatM2Timestamp(timestamp)}</p>
    </div>
  );
}

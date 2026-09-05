import { useEffect, useState } from 'react';
import { ExternalLink, FileText, ImageIcon, RefreshCw } from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../config/firebase';
import type { M4IncidentRecord } from '@shared/m4';

type EvidenceItem = M4IncidentRecord['evidence'][number];
type PreviewState = { status: 'loading' | 'ready' | 'error'; url?: string };
type CachedUrl = { url: string; expiresAt: number };

const evidenceUrlCache = new Map<string, CachedUrl>();

export function IncidentEvidenceGallery({ incidentId, evidence, setError }: {
  incidentId: string;
  evidence: M4IncidentRecord['evidence'];
  setError: (message: string) => void;
}) {
  const [previews, setPreviews] = useState<Record<string, PreviewState>>({});

  useEffect(() => {
    let active = true;
    setPreviews(Object.fromEntries(evidence.map((item) => [item.path, { status: 'loading' }])));
    evidence.forEach((item) => {
      void loadEvidenceUrl(incidentId, item.path)
        .then((url) => {
          if (active) setPreviews((current) => ({ ...current, [item.path]: { status: 'ready', url } }));
        })
        .catch((error: unknown) => {
          if (!active) return;
          setPreviews((current) => ({ ...current, [item.path]: { status: 'error' } }));
          setError(error instanceof Error ? error.message : 'Evidence preview could not be loaded.');
        });
    });
    return () => { active = false; };
  }, [evidence, incidentId, setError]);

  if (!evidence.length) return null;

  const retry = (item: EvidenceItem) => {
    evidenceUrlCache.delete(cacheKey(incidentId, item.path));
    setPreviews((current) => ({ ...current, [item.path]: { status: 'loading' } }));
    void loadEvidenceUrl(incidentId, item.path)
      .then((url) => setPreviews((current) => ({ ...current, [item.path]: { status: 'ready', url } })))
      .catch((error: unknown) => {
        setPreviews((current) => ({ ...current, [item.path]: { status: 'error' } }));
        setError(error instanceof Error ? error.message : 'Evidence preview could not be loaded.');
      });
  };

  return (
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      {evidence.map((item) => {
        const preview = previews[item.path] ?? { status: 'loading' as const };
        const isImage = item.mimeType.startsWith('image/');
        return (
          <figure key={item.path} className="overflow-hidden rounded-lg border border-[#ded6c8] bg-cream-50">
            {preview.status === 'loading' && (
              <div role="status" aria-label={`Loading ${item.name}`} className="flex aspect-[16/9] items-center justify-center gap-2 text-xs font-semibold text-ink-500">
                {isImage ? <ImageIcon size={18} /> : <FileText size={18} />} Loading preview…
              </div>
            )}
            {preview.status === 'ready' && preview.url && isImage && (
              <a href={preview.url} target="_blank" rel="noopener noreferrer" aria-label={`Open full-size ${item.name}`}>
                <img src={preview.url} alt={item.name} className="aspect-[16/9] w-full bg-ink-100 object-cover" loading="lazy" />
              </a>
            )}
            {preview.status === 'ready' && preview.url && !isImage && (
              <a href={preview.url} target="_blank" rel="noopener noreferrer" className="flex aspect-[16/9] items-center justify-center gap-2 text-sm font-semibold text-brand-700">
                <FileText size={20} /> Open document <ExternalLink size={14} />
              </a>
            )}
            {preview.status === 'error' && (
              <button type="button" className="flex aspect-[16/9] w-full items-center justify-center gap-2 text-sm font-semibold text-red-700" onClick={() => retry(item)}>
                <RefreshCw size={16} /> Retry preview
              </button>
            )}
            <figcaption className="flex items-center justify-between gap-2 border-t border-[#ded6c8] bg-white px-3 py-2 text-xs">
              <span className="min-w-0 truncate font-semibold text-ink-700">{item.name}</span>
              <span className="shrink-0 text-ink-500">{formatFileSize(item.size)}</span>
            </figcaption>
          </figure>
        );
      })}
    </div>
  );
}

async function loadEvidenceUrl(incidentId: string, path: string): Promise<string> {
  const key = cacheKey(incidentId, path);
  const cached = evidenceUrlCache.get(key);
  if (cached && cached.expiresAt > Date.now() + 30_000) return cached.url;
  const callable = httpsCallable<{ incidentId: string; path: string }, { url: string; expiresAt: number }>(functions, 'getIncidentEvidenceDownloadUrl');
  const result = await callable({ incidentId, path });
  if (typeof result.data.url !== 'string' || !result.data.url.startsWith('https://')) throw new Error('Invalid evidence URL returned.');
  const expiresAt = Number.isFinite(result.data.expiresAt) ? result.data.expiresAt : Date.now() + 60_000;
  evidenceUrlCache.set(key, { url: result.data.url, expiresAt });
  return result.data.url;
}

function cacheKey(incidentId: string, path: string) {
  return `${incidentId}:${path}`;
}

function formatFileSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return 'File';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

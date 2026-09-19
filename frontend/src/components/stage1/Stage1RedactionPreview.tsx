import { useMemo, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import type { Stage1RedactionMask } from '@shared/types';

export interface Stage1RedactionPreviewProps {
  source?: string;
  mimeType?: string;
  pageCount: number;
  masks: Stage1RedactionMask[];
  onMasksChange: (masks: Stage1RedactionMask[]) => void;
}

type Point = { x: number; y: number };

export default function Stage1RedactionPreview({ source, mimeType, pageCount, masks, onMasksChange }: Stage1RedactionPreviewProps) {
  const [draftStart, setDraftStart] = useState<{ page: number; point: Point } | null>(null);
  const [draftEnd, setDraftEnd] = useState<Point | null>(null);
  const isPdf = mimeType === 'application/pdf' || source?.startsWith('data:application/pdf') || source?.toLowerCase().includes('.pdf');
  const pages = useMemo(() => Array.from({ length: Math.max(1, pageCount) }, (_, index) => index + 1), [pageCount]);

  const startMask = (page: number, event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setDraftStart({ page, point: { x: clamp((event.clientX - rect.left) / rect.width), y: clamp((event.clientY - rect.top) / rect.height) } });
    setDraftEnd(null);
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveMask = (event: PointerEvent<HTMLDivElement>) => {
    if (!draftStart) return;
    const rect = event.currentTarget.getBoundingClientRect();
    setDraftEnd({ x: clamp((event.clientX - rect.left) / rect.width), y: clamp((event.clientY - rect.top) / rect.height) });
  };
  const finishMask = (event: PointerEvent<HTMLDivElement>) => {
    if (!draftStart) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const end = draftEnd ?? { x: clamp((event.clientX - rect.left) / rect.width), y: clamp((event.clientY - rect.top) / rect.height) };
    const x = Math.min(draftStart.point.x, end.x);
    const y = Math.min(draftStart.point.y, end.y);
    const width = Math.abs(end.x - draftStart.point.x);
    const height = Math.abs(end.y - draftStart.point.y);
    if (width >= 0.01 && height >= 0.01) onMasksChange([...masks, { page: draftStart.page, x, y, width, height, category: 'other', source: 'admin' }]);
    setDraftStart(null);
    setDraftEnd(null);
  };

  if (!source) return <div className="rounded border border-ink-200 bg-ink-50 p-3 text-xs text-ink-600">The source document is unavailable for visual redaction. Review every page before publishing.</div>;
  return <div className="space-y-3" data-testid="stage1-redaction-preview">
    <p className="text-xs leading-5 text-ink-600">Drag over sensitive content to add an opaque redaction mask. Click a mask to remove it. The saved public copy permanently covers these regions.</p>
    {isPdf ? pages.map((page) => <PreviewPage key={page} page={page} pdfSource={source} masks={masks} draftStart={draftStart} draftEnd={draftEnd} onPointerDown={startMask} onPointerMove={moveMask} onPointerUp={finishMask} onMasksChange={onMasksChange} />)
      : <PreviewPage page={1} imageSource={source} masks={masks} draftStart={draftStart} draftEnd={draftEnd} onPointerDown={startMask} onPointerMove={moveMask} onPointerUp={finishMask} onMasksChange={onMasksChange} />}
  </div>;
}

function PreviewPage({ page, imageSource, pdfSource, masks, draftStart, draftEnd, onPointerDown, onPointerMove, onPointerUp, onMasksChange }: {
  page: number;
  imageSource?: string;
  pdfSource?: string;
  masks: Stage1RedactionMask[];
  draftStart: { page: number; point: Point } | null;
  draftEnd: Point | null;
  onPointerDown: (page: number, event: PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLDivElement>) => void;
  onMasksChange: (masks: Stage1RedactionMask[]) => void;
}) {
  const pageRef = useRef<HTMLDivElement>(null);
  const [maskDrag, setMaskDrag] = useState<{ index: number; mode: 'move' | 'resize'; origin: Point; mask: Stage1RedactionMask } | null>(null);
  const didDrag = useRef(false);
  const pageMasks = masks.filter((mask) => mask.page === page);
  const draft = draftStart?.page === page && draftEnd ? {
    x: Math.min(draftStart.point.x, draftEnd.x),
    y: Math.min(draftStart.point.y, draftEnd.y),
    width: Math.abs(draftEnd.x - draftStart.point.x),
    height: Math.abs(draftEnd.y - draftStart.point.y),
  } : null;
  const pointFromEvent = (event: PointerEvent<HTMLElement>): Point => {
    const rect = pageRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: clamp((event.clientX - rect.left) / rect.width), y: clamp((event.clientY - rect.top) / rect.height) };
  };
  const beginMaskEdit = (index: number, mode: 'move' | 'resize', event: PointerEvent<HTMLElement>) => {
    event.stopPropagation();
    const mask = masks[index];
    if (!mask) return;
    didDrag.current = false;
    setMaskDrag({ index, mode, origin: pointFromEvent(event), mask });
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveMaskEdit = (event: PointerEvent<HTMLElement>) => {
    if (!maskDrag) return;
    event.stopPropagation();
    const point = pointFromEvent(event);
    const dx = point.x - maskDrag.origin.x;
    const dy = point.y - maskDrag.origin.y;
    if (Math.abs(dx) < 0.002 && Math.abs(dy) < 0.002) return;
    didDrag.current = true;
    const nextMask = maskDrag.mode === 'move'
      ? { ...maskDrag.mask, x: clamp(maskDrag.mask.x + dx, 0, 1 - maskDrag.mask.width), y: clamp(maskDrag.mask.y + dy, 0, 1 - maskDrag.mask.height) }
      : { ...maskDrag.mask, width: clamp(maskDrag.mask.width + dx, 0.01, 1 - maskDrag.mask.x), height: clamp(maskDrag.mask.height + dy, 0.01, 1 - maskDrag.mask.y) };
    onMasksChange(masks.map((candidate, candidateIndex) => candidateIndex === maskDrag.index ? nextMask : candidate));
    setMaskDrag({ ...maskDrag, origin: point, mask: nextMask });
  };
  const finishMaskEdit = (event: PointerEvent<HTMLElement>) => {
    event.stopPropagation();
    setMaskDrag(null);
  };
  return <div className="rounded border border-ink-200 bg-white p-2">
    <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-500">Page {page}</p>
    <div ref={pageRef} className="relative mx-auto w-fit max-w-full select-none" onPointerDown={(event) => onPointerDown(page, event)} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
      {imageSource ? <img src={imageSource} alt={`Stage 1 document page ${page}`} className="block max-h-[70vh] max-w-full object-contain" draggable={false} /> : pdfSource ? <iframe title={`Stage 1 document page ${page}`} src={`${pdfSource}#page=${page}`} className="pointer-events-none h-[70vh] min-h-[520px] w-[680px] max-w-full border-0" /> : null}
      <div className="pointer-events-none absolute inset-0">
        {pageMasks.map((mask, pageMaskIndex) => {
          const maskIndex = masks.indexOf(mask);
          return <div key={`${mask.page}-${pageMaskIndex}`} role="button" tabIndex={0} aria-label={`Move or remove redaction ${pageMaskIndex + 1} on page ${page}`} className="pointer-events-auto absolute cursor-move bg-black/95" style={{ left: `${mask.x * 100}%`, top: `${mask.y * 100}%`, width: `${mask.width * 100}%`, height: `${mask.height * 100}%` }} onPointerDown={(event) => beginMaskEdit(maskIndex, 'move', event)} onPointerMove={moveMaskEdit} onPointerUp={finishMaskEdit} onClick={(event) => { event.stopPropagation(); if (!didDrag.current) onMasksChange(masks.filter((candidate) => candidate !== mask)); didDrag.current = false; }}>
            <span role="button" tabIndex={0} aria-label={`Resize redaction ${pageMaskIndex + 1} on page ${page}`} className="absolute bottom-0 right-0 h-3 w-3 cursor-se-resize bg-white/80" onPointerDown={(event) => beginMaskEdit(maskIndex, 'resize', event)} onPointerMove={moveMaskEdit} onPointerUp={finishMaskEdit} onClick={(event) => event.stopPropagation()} />
          </div>;
        })}
        {draft && <span className="absolute border-2 border-red-500 bg-black/50" style={{ left: `${draft.x * 100}%`, top: `${draft.y * 100}%`, width: `${draft.width * 100}%`, height: `${draft.height * 100}%` }} />}
      </div>
    </div>
  </div>;
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

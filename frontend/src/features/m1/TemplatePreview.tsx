import { useEffect, useRef, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { ChevronLeft, ChevronRight, Columns3, Download, FileText, Rows3 } from 'lucide-react';
import type { M1TemplateDefinition } from './templateRegistry';
import { templateDownloadUrl, templatePreviewUrl } from './templateRegistry';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

interface TemplatePreviewProps {
  core: M1TemplateDefinition;
  scenario: M1TemplateDefinition;
}

export default function TemplatePreview({ core, scenario }: TemplatePreviewProps) {
  const [selectedId, setSelectedId] = useState(core.templateId);
  const [view, setView] = useState<'single' | 'overview'>('single');
  const [page, setPage] = useState(1);
  const [reportedPages, setReportedPages] = useState<number>();
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(760);
  const template = selectedId === core.templateId ? core : scenario;
  const pageCount = reportedPages ?? template.pageCount;

  useEffect(() => {
    setPage(1);
    setReportedPages(undefined);
  }, [selectedId]);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(([entry]) => setContainerWidth(entry.contentRect.width));
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const singleWidth = Math.max(260, Math.min(760, containerWidth - 32));
  const overviewWidth = Math.max(210, Math.min(310, containerWidth / (containerWidth > 960 ? 3 : containerWidth > 620 ? 2 : 1) - 28));

  return (
    <section className="overflow-hidden border border-[#d8cebd] bg-[#f0eadc]" aria-labelledby="template-preview-heading">
      <div className="flex flex-col gap-4 border-b border-[#d8cebd] bg-[#fffdf8] px-4 py-4 lg:flex-row lg:items-center lg:justify-between lg:px-6">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.1em] text-gold-600">Document preview</p>
          <h2 id="template-preview-heading" className="mt-1 text-lg font-bold">Read every page before you begin</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-md border border-ink-200 bg-cream-50 p-1" role="group" aria-label="Preview layout">
            <button type="button" aria-pressed={view === 'single'} onClick={() => setView('single')} className={`btn min-h-9 px-3 py-1.5 ${view === 'single' ? 'bg-brand-700 text-cream-50' : 'text-ink-600 hover:bg-cream-100'}`}>
              <Rows3 size={15} /> One page
            </button>
            <button type="button" aria-pressed={view === 'overview'} onClick={() => setView('overview')} className={`btn min-h-9 px-3 py-1.5 ${view === 'overview' ? 'bg-brand-700 text-cream-50' : 'text-ink-600 hover:bg-cream-100'}`}>
              <Columns3 size={15} /> Page overview
            </button>
          </div>
          <a className="btn-secondary" href={templateDownloadUrl(template)} download>
            <Download size={16} /> Download Word
          </a>
        </div>
      </div>

      <div className="grid min-h-[38rem] lg:grid-cols-[17rem_minmax(0,1fr)]">
        <div className="border-b border-[#d8cebd] bg-[#faf6ec] p-3 lg:border-b-0 lg:border-r">
          <p className="px-2 pb-2 text-xs font-bold uppercase tracking-[0.08em] text-ink-500">Document tabs</p>
          {[core, scenario].map((item) => (
            <button
              key={item.templateId}
              type="button"
              onClick={() => setSelectedId(item.templateId)}
              aria-pressed={selectedId === item.templateId}
              className={`mb-2 flex min-h-14 w-full items-start gap-3 rounded-md px-3 py-3 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${selectedId === item.templateId ? 'bg-brand-100 text-brand-900' : 'text-ink-700 hover:bg-cream-100'}`}
            >
              <FileText className="mt-0.5 shrink-0" size={18} aria-hidden="true" />
              <span>
                <span className="block text-sm font-bold leading-5">{item.kind === 'core' ? 'Core template' : 'Scenario template'}</span>
                <span className="mt-0.5 block text-xs leading-4 text-ink-500">{item.title}</span>
              </span>
            </button>
          ))}
          <div className="mt-4 border-t border-[#d8cebd] px-2 pt-4 text-xs leading-5 text-ink-500">
            <p className="font-semibold text-ink-700">{template.templateId}</p>
            <p>Version {template.version} · {pageCount} pages</p>
          </div>
        </div>

        <div ref={containerRef} className="min-w-0 overflow-auto p-4 sm:p-6" aria-live="polite">
          <Document
            file={templatePreviewUrl(template)}
            onLoadSuccess={({ numPages }) => setReportedPages(numPages)}
            loading={<PreviewMessage title="Opening document" detail="Preparing the page preview…" />}
            error={<PreviewMessage title="Preview unavailable" detail="Download the Word template to continue." />}
          >
            {view === 'single' ? (
              <div className="mx-auto w-fit">
                <div className="overflow-hidden bg-white shadow-[0_12px_32px_rgba(53,48,37,0.14)]">
                  <Page pageNumber={page} width={singleWidth} renderAnnotationLayer renderTextLayer />
                </div>
                <div className="sticky bottom-3 mx-auto mt-4 flex w-fit items-center gap-3 rounded-full border border-[#cfc3ad] bg-[#fffdf8] px-2 py-1.5 shadow-card">
                  <button type="button" className="btn min-h-9 rounded-full px-2" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft size={18} /></button>
                  <span className="min-w-20 text-center text-sm font-semibold tabular-nums">{page} / {pageCount}</span>
                  <button type="button" className="btn min-h-9 rounded-full px-2" aria-label="Next page" disabled={page >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}><ChevronRight size={18} /></button>
                </div>
              </div>
            ) : (
              <div className="grid justify-center gap-5 sm:grid-cols-2 2xl:grid-cols-3">
                {Array.from({ length: pageCount }, (_, index) => (
                  <button key={index} type="button" onClick={() => { setPage(index + 1); setView('single'); }} className="group text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-4">
                    <span className="block overflow-hidden bg-white shadow-[0_6px_20px_rgba(53,48,37,0.12)] transition-transform group-hover:-translate-y-0.5">
                      <Page pageNumber={index + 1} width={overviewWidth} renderAnnotationLayer={false} renderTextLayer={false} />
                    </span>
                    <span className="mt-2 block text-center text-xs font-semibold text-ink-500">Page {index + 1}</span>
                  </button>
                ))}
              </div>
            )}
          </Document>
        </div>
      </div>
    </section>
  );
}

function PreviewMessage({ title, detail }: { title: string; detail: string }) {
  return <div className="grid min-h-80 place-items-center text-center"><div><p className="font-semibold text-ink-700">{title}</p><p className="mt-1 text-sm text-ink-500">{detail}</p></div></div>;
}

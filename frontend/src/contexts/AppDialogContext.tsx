import { createContext, ReactNode, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, HelpCircle, X } from 'lucide-react';

type DialogTone = 'default' | 'danger';

interface ConfirmDialogOptions {
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: DialogTone;
}

interface PromptDialogOptions extends ConfirmDialogOptions {
  inputLabel: string;
  placeholder?: string;
  initialValue?: string;
  minLength?: number;
  maxLength?: number;
}

interface DialogApi {
  confirm: (options: ConfirmDialogOptions) => Promise<boolean>;
  prompt: (options: PromptDialogOptions) => Promise<string | null>;
}

type DialogRequest =
  | ({ kind: 'confirm'; resolve: (value: boolean) => void } & ConfirmDialogOptions)
  | ({ kind: 'prompt'; resolve: (value: string | null) => void } & PromptDialogOptions);

const fallbackApi: DialogApi = {
  confirm: async () => false,
  prompt: async () => null,
};

const AppDialogContext = createContext<DialogApi>(fallbackApi);

export function useAppDialog() {
  return useContext(AppDialogContext);
}

export function AppDialogProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<DialogRequest | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const confirm = useCallback((options: ConfirmDialogOptions) => new Promise<boolean>((resolve) => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setRequest((current) => {
      if (current?.kind === 'confirm') current.resolve(false);
      else if (current) current.resolve(null);
      return { ...options, kind: 'confirm', resolve };
    });
  }), []);

  const prompt = useCallback((options: PromptDialogOptions) => new Promise<string | null>((resolve) => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setRequest((current) => {
      if (current?.kind === 'confirm') current.resolve(false);
      else if (current) current.resolve(null);
      return { ...options, kind: 'prompt', resolve };
    });
  }), []);

  const close = useCallback((value: boolean | string | null) => {
    setRequest((current) => {
      if (!current) return null;
      if (current.kind === 'confirm') current.resolve(Boolean(value));
      else current.resolve(typeof value === 'string' ? value : null);
      window.setTimeout(() => returnFocusRef.current?.focus(), 0);
      return null;
    });
  }, []);

  return (
    <AppDialogContext.Provider value={{ confirm, prompt }}>
      {children}
      {request && <AppDialog request={request} onClose={close} />}
    </AppDialogContext.Provider>
  );
}

function AppDialog({ request, onClose }: { request: DialogRequest; onClose: (value: boolean | string | null) => void }) {
  const titleId = useId();
  const descriptionId = useId();
  const inputId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const [inputValue, setInputValue] = useState(request.kind === 'prompt' ? request.initialValue ?? '' : '');
  const trimmedValue = inputValue.trim();
  const promptValid = request.kind !== 'prompt'
    || ((!request.minLength || trimmedValue.length >= request.minLength)
      && (!request.maxLength || trimmedValue.length <= request.maxLength));

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    (request.kind === 'prompt' ? inputRef.current : cancelRef.current)?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose(request.kind === 'confirm' ? false : null);
      if (event.key === 'Tab' && dialogRef.current) {
        const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), textarea:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex="-1"])')];
        const first = focusable[0];
        const last = focusable.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose, request.kind]);

  const submit = () => {
    if (!promptValid) return;
    onClose(request.kind === 'prompt' ? trimmedValue : true);
  };

  const Icon = request.tone === 'danger' ? AlertTriangle : HelpCircle;
  const iconTone = request.tone === 'danger' ? 'bg-red-100 text-red-700' : 'bg-brand-100 text-brand-800';
  const confirmClass = request.tone === 'danger' ? 'btn-danger' : 'btn-primary';

  return createPortal(
    <div className="fixed inset-0 z-[120] grid place-items-center bg-ink-900/60 p-4 backdrop-blur-[2px]" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(request.kind === 'confirm' ? false : null); }}>
      <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} className="w-full max-w-md overflow-hidden rounded-xl border border-[#d8cebd] bg-[#fffdf8] shadow-[0_24px_70px_rgba(30,38,18,0.28)]">
        <div className="flex items-start gap-4 px-5 pb-4 pt-5 sm:px-6 sm:pt-6">
          <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-full ${iconTone}`}><Icon size={21} aria-hidden="true" /></span>
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="font-display text-xl font-bold text-ink-900">{request.title}</h2>
            <p id={descriptionId} className="mt-2 text-sm leading-6 text-ink-600">{request.description}</p>
          </div>
          <button type="button" aria-label="Close dialog" onClick={() => onClose(request.kind === 'confirm' ? false : null)} className="grid h-11 w-11 shrink-0 place-items-center rounded-md text-ink-500 hover:bg-cream-100 hover:text-ink-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"><X size={19} /></button>
        </div>

        {request.kind === 'prompt' && (
          <div className="px-5 pb-5 sm:px-6">
            <label htmlFor={inputId} className="field-label">{request.inputLabel}</label>
            <textarea ref={inputRef} id={inputId} className="input mt-1 min-h-28 resize-y" placeholder={request.placeholder} minLength={request.minLength} maxLength={request.maxLength} value={inputValue} onChange={(event) => setInputValue(event.target.value)} />
            {(request.minLength || request.maxLength) && <p className={`mt-1 text-xs ${promptValid || trimmedValue.length === 0 ? 'text-ink-500' : 'font-semibold text-red-700'}`}>{request.minLength ? `Use at least ${request.minLength} characters` : ''}{request.minLength && request.maxLength ? ` and no more than ${request.maxLength}` : request.maxLength ? `Use no more than ${request.maxLength} characters` : ''}. {trimmedValue.length}{request.maxLength ? `/${request.maxLength}` : ''}</p>}
          </div>
        )}

        <div className="flex flex-col-reverse gap-2 border-t border-[#e4dac7] bg-cream-50 px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
          <button ref={cancelRef} type="button" className="btn-secondary min-h-11" onClick={() => onClose(request.kind === 'confirm' ? false : null)}>{request.cancelLabel ?? 'Keep working'}</button>
          <button type="button" className={`${confirmClass} min-h-11`} disabled={!promptValid || (request.kind === 'prompt' && trimmedValue.length === 0)} onClick={submit}>{request.confirmLabel}</button>
        </div>
      </section>
    </div>,
    document.body,
  );
}

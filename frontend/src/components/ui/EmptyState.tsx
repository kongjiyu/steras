import emptyStateUrl from '../../assets/imagery/system-empty-state.webp';

interface Props {
  title: string;
  description?: string;
  children?: React.ReactNode;
}

export default function EmptyState({ title, description, children }: Props) {
  return (
    <div className="rounded-lg border border-dashed border-[#cfc5b3] bg-[#fffaf0]">
      <div className="px-5 py-10 text-center sm:py-12">
        <img src={emptyStateUrl} alt="" className="mx-auto mb-5 h-32 w-40 object-contain" />
        <h3 className="font-display text-base font-bold text-ink-800">{title}</h3>
        {description && <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-ink-500">{description}</p>}
        {children && <div className="mt-4">{children}</div>}
      </div>
    </div>
  );
}

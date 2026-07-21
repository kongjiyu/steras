interface Props {
  title: string;
  description?: string;
  action?: React.ReactNode;
  eyebrow?: string;
}

export default function PageHeader({ title, description, action, eyebrow = 'Organizer workspace' }: Props) {
  return (
    <header className="mb-7 flex flex-col gap-4 border-b border-[#ded5c5] pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <p className="page-eyebrow">{eyebrow}</p>
        <h1 className="font-display text-[clamp(1.5rem,3vw,1.875rem)] font-bold leading-tight tracking-[-0.025em] text-ink-900">{title}</h1>
        {description && <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-500">{description}</p>}
      </div>
      {action && <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>}
    </header>
  );
}

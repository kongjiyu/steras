interface Props {
  title: string;
  description?: string;
  children?: React.ReactNode;
}

export default function EmptyState({ title, description, children }: Props) {
  return (
    <div className="card">
      <div className="card-body text-center py-12">
        <h3 className="text-base font-semibold text-slate-900">{title}</h3>
        {description && <p className="mt-2 text-sm text-slate-600">{description}</p>}
        {children && <div className="mt-4">{children}</div>}
      </div>
    </div>
  );
}

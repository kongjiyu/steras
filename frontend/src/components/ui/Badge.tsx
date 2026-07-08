import { ReactNode } from 'react';

type Color = 'green' | 'blue' | 'amber' | 'orange' | 'red' | 'gray' | 'slate';

const colorClass: Record<Color, string> = {
  green: 'bg-green-100 text-green-800',
  blue: 'bg-blue-100 text-blue-800',
  amber: 'bg-amber-100 text-amber-800',
  orange: 'bg-orange-100 text-orange-800',
  red: 'bg-red-100 text-red-800',
  gray: 'bg-slate-100 text-slate-700',
  slate: 'bg-slate-100 text-slate-700',
};

interface Props {
  children: ReactNode;
  color?: Color;
}

export default function Badge({ children, color = 'gray' }: Props) {
  return <span className={`badge ${colorClass[color]}`}>{children}</span>;
}

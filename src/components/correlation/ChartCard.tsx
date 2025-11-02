'use client';

import { type ReactNode } from 'react';

type ChartCardProps = {
  title: string;
  description: string;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function ChartCard({
  title,
  description,
  icon,
  children,
  className = '',
}: ChartCardProps): JSX.Element {
  return (
    <div
      className={`rounded-2xl border border-slate-200 bg-white p-6 shadow-sm backdrop-blur-sm transition-all duration-300 hover:shadow-lg ${className}`}
    >
      <div className="mb-6 flex items-start gap-3">
        {icon && (
          <div className="rounded-xl bg-gradient-to-br from-blue-50 to-cyan-50 p-2.5 text-blue-600">
            {icon}
          </div>
        )}
        <div className="flex-1">
          <h3 className="text-lg font-bold text-slate-900">{title}</h3>
          <p className="mt-1 text-sm leading-relaxed text-slate-600">{description}</p>
        </div>
      </div>
      <div className="relative">{children}</div>
    </div>
  );
}

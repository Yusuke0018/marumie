'use client';

import { type ReactNode } from 'react';

type MetricCardProps = {
  icon: ReactNode;
  label: string;
  value: string;
  helper?: string;
  trend?: 'up' | 'down' | 'neutral';
  iconColor?: string;
};

export function MetricCard({
  icon,
  label,
  value,
  helper,
  trend,
  iconColor = 'text-blue-500',
}: MetricCardProps): JSX.Element {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg">
      {/* Background Gradient */}
      <div className="absolute right-0 top-0 h-32 w-32 opacity-0 transition-opacity duration-300 group-hover:opacity-10">
        <div className="h-full w-full rounded-full bg-gradient-to-br from-blue-400 to-cyan-400 blur-3xl" />
      </div>

      <div className="relative flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className={`${iconColor} transition-transform duration-300 group-hover:scale-110`}>
              {icon}
            </span>
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {label}
            </span>
          </div>
          <div className="mt-3 text-3xl font-bold text-slate-900 transition-colors duration-300 group-hover:text-blue-600">
            {value}
          </div>
          {helper && (
            <div className="mt-2 flex items-center gap-1 text-xs text-slate-500">
              {trend === 'up' && <span className="text-emerald-500">↗</span>}
              {trend === 'down' && <span className="text-rose-500">↘</span>}
              {trend === 'neutral' && <span className="text-slate-400">→</span>}
              <span>{helper}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

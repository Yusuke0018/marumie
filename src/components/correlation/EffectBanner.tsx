'use client';

import { AlertCircle, CheckCircle, Info, TrendingUp, XCircle } from 'lucide-react';

export type EffectStatus = 'positive' | 'moderate' | 'weak' | 'negative' | 'unknown';

type EffectBannerProps = {
  status: EffectStatus;
  headline: string;
  message: string;
  badge: string;
};

const EFFECT_CONFIG: Record<
  EffectStatus,
  {
    bg: string;
    border: string;
    text: string;
    badgeBg: string;
    icon: typeof CheckCircle;
    iconColor: string;
  }
> = {
  positive: {
    bg: 'bg-gradient-to-r from-emerald-50 via-green-50 to-teal-50',
    border: 'border-emerald-300',
    text: 'text-emerald-900',
    badgeBg: 'bg-emerald-600',
    icon: CheckCircle,
    iconColor: 'text-emerald-600',
  },
  moderate: {
    bg: 'bg-gradient-to-r from-blue-50 via-cyan-50 to-sky-50',
    border: 'border-blue-300',
    text: 'text-blue-900',
    badgeBg: 'bg-blue-600',
    icon: TrendingUp,
    iconColor: 'text-blue-600',
  },
  weak: {
    bg: 'bg-gradient-to-r from-amber-50 via-yellow-50 to-orange-50',
    border: 'border-amber-300',
    text: 'text-amber-900',
    badgeBg: 'bg-amber-600',
    icon: AlertCircle,
    iconColor: 'text-amber-600',
  },
  negative: {
    bg: 'bg-gradient-to-r from-rose-50 via-red-50 to-pink-50',
    border: 'border-rose-300',
    text: 'text-rose-900',
    badgeBg: 'bg-rose-600',
    icon: XCircle,
    iconColor: 'text-rose-600',
  },
  unknown: {
    bg: 'bg-gradient-to-r from-slate-50 via-gray-50 to-zinc-50',
    border: 'border-slate-300',
    text: 'text-slate-700',
    badgeBg: 'bg-slate-600',
    icon: Info,
    iconColor: 'text-slate-600',
  },
};

export function EffectBanner({ status, headline, message, badge }: EffectBannerProps): JSX.Element {
  const config = EFFECT_CONFIG[status];
  const Icon = config.icon;

  return (
    <div
      className={`relative overflow-hidden rounded-3xl border-2 ${config.border} ${config.bg} p-8 shadow-lg transition-all duration-300 hover:shadow-xl`}
    >
      {/* Decorative circles */}
      <div className="absolute -right-12 -top-12 h-48 w-48 rounded-full bg-white/30 blur-2xl" />
      <div className="absolute -bottom-12 -left-12 h-48 w-48 rounded-full bg-white/30 blur-2xl" />

      <div className="relative flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
        <div className="flex items-start gap-4">
          <div className={`rounded-2xl bg-white p-3 shadow-sm ${config.iconColor}`}>
            <Icon className="h-8 w-8" />
          </div>
          <div className="flex-1">
            <p className="mb-1 text-xs font-bold uppercase tracking-wider text-slate-500">
              インクリメンタリティ評価
            </p>
            <h2 className={`text-2xl font-bold ${config.text}`}>{headline}</h2>
            <p className={`mt-2 text-sm ${config.text}`}>{message}</p>
          </div>
        </div>
        <div className="flex-shrink-0">
          <span
            className={`inline-flex items-center rounded-full ${config.badgeBg} px-5 py-2.5 text-xs font-bold uppercase tracking-wide text-white shadow-lg`}
          >
            {badge}
          </span>
        </div>
      </div>
    </div>
  );
}

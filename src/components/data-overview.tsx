"use client";

import { clsx } from "clsx";
import { Database, FileBarChart2, FileCheck2, Layers3 } from "lucide-react";

interface DataOverviewProps {
  reservationCount: number;
  listingCount: number;
  surveyCount: number;
  availableMonths: number;
}

const cards = [
  {
    key: "reservations",
    label: "予約ログ",
    icon: Database,
    tone: "from-primary/15 to-primary/5 text-primary-strong",
  },
  {
    key: "listing",
    label: "リスティングログ",
    icon: FileBarChart2,
    tone: "from-indigo-200/50 to-indigo-50 text-indigo-600",
  },
  {
    key: "survey",
    label: "アンケートログ",
    icon: FileCheck2,
    tone: "from-emerald-200/50 to-emerald-50 text-emerald-600",
  },
  {
    key: "months",
    label: "利用可能な月",
    icon: Layers3,
    tone: "from-slate-200/60 to-slate-50 text-slate-700",
  },
];

export function DataOverview({
  reservationCount,
  listingCount,
  surveyCount,
  availableMonths,
}: DataOverviewProps) {
  const values: Record<string, number> = {
    reservations: reservationCount,
    listing: listingCount,
    survey: surveyCount,
    months: availableMonths,
  };

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <div
            key={card.key}
            className={clsx(
              "rounded-3xl border border-border bg-gradient-to-br p-6 shadow-sm",
              card.tone,
            )}
          >
            <Icon className="h-5 w-5" />
            <p className="mt-4 text-xs uppercase tracking-widest text-muted/70">
              {card.label}
            </p>
            <p className="mt-2 text-3xl font-semibold">
              {values[card.key].toLocaleString()}
            </p>
          </div>
        );
      })}
    </div>
  );
}

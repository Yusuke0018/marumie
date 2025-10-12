"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { RefreshCw, ArrowLeft } from "lucide-react";
import {
  type Reservation,
  loadReservationsFromStorage,
  loadReservationTimestamp,
  RESERVATION_STORAGE_KEY,
  RESERVATION_TIMESTAMP_KEY,
} from "@/lib/reservationData";

const GeoDistributionMap = dynamic(
  () =>
    import("@/components/reservations/GeoDistributionMap").then((m) => ({
      default: m.GeoDistributionMap,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[520px] items-center justify-center rounded-3xl border border-slate-200 bg-white text-slate-500">
        地図コンポーネントを読み込み中です...
      </div>
    ),
  },
);

const formatMonthLabel = (value: string): string => {
  const [yearStr, monthStr] = value.split("-");
  const year = Number.parseInt(yearStr ?? "", 10);
  const month = Number.parseInt(monthStr ?? "", 10);
  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    return value;
  }
  return `${year}年${month}月`;
};

const buildPeriodLabel = (months: string[]): string => {
  if (months.length === 0) {
    return "データ未取得";
  }
  const sorted = [...months].sort();
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  if (first === last) {
    return formatMonthLabel(first);
  }
  return `${formatMonthLabel(first)}〜${formatMonthLabel(last)}`;
};

const MapAnalysisPage = () => {
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const refreshReservations = () => {
      const stored = loadReservationsFromStorage();
      setReservations(stored);
      const timestamp = loadReservationTimestamp();
      setLastUpdated(timestamp);
    };

    refreshReservations();

    const handleStorage = (event: StorageEvent) => {
      if (
        event.key === RESERVATION_STORAGE_KEY ||
        event.key === RESERVATION_TIMESTAMP_KEY
      ) {
        refreshReservations();
      }
    };

    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  const availableMonths = useMemo(() => {
    const months = new Set<string>();
    reservations.forEach((reservation) => {
      if (reservation.reservationMonth) {
        months.add(reservation.reservationMonth);
      }
    });
    return Array.from(months);
  }, [reservations]);

  const periodLabel = useMemo(
    () => buildPeriodLabel(availableMonths),
    [availableMonths],
  );

  const isEmpty = reservations.length === 0;

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-12">
        <section className="relative overflow-hidden rounded-3xl border border-emerald-200 bg-gradient-to-br from-white via-emerald-50 to-sky-100 p-8 shadow-card">
          <div className="pointer-events-none absolute -right-16 top-0 h-48 w-48 rounded-full bg-gradient-to-br from-emerald-200/50 via-sky-200/40 to-purple-200/40 blur-3xl" />
          <div className="pointer-events-none absolute -left-20 bottom-0 h-52 w-52 rounded-full bg-gradient-to-br from-sky-200/45 via-emerald-200/30 to-white/0 blur-3xl" />
          <div className="relative flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div className="space-y-3">
              <p className="text-sm font-semibold text-emerald-600">
                Map Analytics Dashboard
              </p>
              <h1 className="text-3xl font-bold text-slate-900 md:text-4xl">
                マップ分析
              </h1>
              <p className="max-w-2xl text-sm leading-6 text-slate-600">
                予約CSVから取り込んだ患者の年代・診療科・住所データをもとに、来院エリアを町丁目レベルで可視化します。診療科や年代を切り替えながら、来院傾向の偏りや新規獲得余地を探索できます。
              </p>
            </div>
            <div className="flex flex-col items-start gap-3 text-sm text-slate-600">
              <Link
                href="/reservations"
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
              >
                <ArrowLeft className="h-4 w-4" />
                予約分析に戻る
              </Link>
              {lastUpdated && (
                <p className="text-xs font-medium text-slate-500">
                  最終更新: {new Date(lastUpdated).toLocaleString("ja-JP")}
                </p>
              )}
            </div>
          </div>
        </section>

        {isEmpty ? (
          <section className="rounded-3xl border border-slate-200 bg-white p-8 text-sm text-slate-700 shadow-sm">
            <div className="flex items-center gap-3 text-indigo-600">
              <RefreshCw className="h-5 w-5 animate-spin" />
              <p className="text-sm font-semibold">地図に表示できる予約データがありません。</p>
            </div>
            <p className="mt-4 text-sm">
              まずは「予約分析」ページで予約CSVを取り込み、診療科や期間を選んだ上で来院データを保存してください。保存後にこのページを再読み込みすると、最新情報が反映されます。
            </p>
          </section>
        ) : (
          <section className="space-y-6">
            <div className="rounded-3xl border border-indigo-200 bg-white/80 p-6 text-slate-700 shadow-sm">
              <h2 className="text-base font-semibold text-slate-900">分析サマリ</h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-3">
                <div className="rounded-2xl border border-indigo-100 bg-indigo-50/70 px-4 py-3">
                  <p className="text-xs font-semibold text-indigo-500">
                    期間サマリ
                  </p>
                  <p className="mt-1 text-lg font-bold text-indigo-800">
                    {periodLabel}
                  </p>
                </div>
                <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 px-4 py-3">
                  <p className="text-xs font-semibold text-emerald-500">
                    予約件数
                  </p>
                  <p className="mt-1 text-lg font-bold text-emerald-700">
                    {reservations.length.toLocaleString("ja-JP")}件
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                  <p className="text-xs font-semibold text-slate-500">
                    最終更新
                  </p>
                  <p className="mt-1 text-lg font-bold text-slate-700">
                    {lastUpdated
                      ? new Date(lastUpdated).toLocaleDateString("ja-JP")
                      : "不明"}
                  </p>
                </div>
              </div>
            </div>

            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-card">
              <GeoDistributionMap reservations={reservations} periodLabel={periodLabel} />
            </section>
          </section>
        )}
      </div>
    </main>
  );
};

export default MapAnalysisPage;

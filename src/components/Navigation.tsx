"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { CalendarRange, Menu, X } from "lucide-react";
import {
  ANALYSIS_FILTER_SLOT_ID,
  ANALYSIS_PERIOD_EVENT,
  getAnalysisPeriodLabel,
} from "@/lib/analysisPeriod";

export default function Navigation() {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const [analysisPeriodLabel, setAnalysisPeriodLabelState] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    setAnalysisPeriodLabelState(getAnalysisPeriodLabel());

    const handlePeriodChange = (event: Event) => {
      const detail = (event as CustomEvent<{ label?: string | null }>).detail;
      setAnalysisPeriodLabelState(detail?.label ?? null);
    };

    window.addEventListener(
      ANALYSIS_PERIOD_EVENT,
      handlePeriodChange as EventListener,
    );

    return () => {
      window.removeEventListener(
        ANALYSIS_PERIOD_EVENT,
        handlePeriodChange as EventListener,
      );
    };
  }, []);

  const links = [
    { href: "/" as const, label: "ホーム" },
    { href: "/patients" as const, label: "患者分析" },
    { href: "/patients/lifestyle" as const, label: "生活習慣病分析" },
    { href: "/reservations" as const, label: "予約分析" },
    { href: "/map-analysis" as const, label: "マップ分析" },
    // { href: "/survey" as const, label: "アンケート分析" },
    // { href: "/listing" as const, label: "リスティング分析" },
    // { href: "/correlation" as const, label: "相関分析" },
    { href: "/ab-test" as const, label: "ABテスト" },
  ];

  const toggleMenu = () => setIsOpen((value) => !value);
  const closeMenu = () => setIsOpen(false);

  const isFilterablePage = useMemo(
    () =>
      [
        "/patients",
        "/reservations",
        // "/survey",
        // "/listing",
        // "/correlation",
        "/map-analysis",
      ].some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)),
    [pathname],
  );
  const showPeriodBadge = isFilterablePage && analysisPeriodLabel;

  return (
    <>
      <nav className="z-50 border-b border-brand-100/70 bg-white shadow-sm md:sticky md:top-0 md:bg-white/95 md:backdrop-blur supports-[backdrop-filter]:md:bg-white/70">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 sm:px-6">
          <div className="flex flex-col gap-4 py-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
                <div className="flex items-center gap-3">
                  <h1 className="text-lg sm:text-xl font-bold tracking-wide text-brand-600 whitespace-nowrap">
                    マルミエ
                  </h1>
                </div>
                {isFilterablePage && (
                  <div
                    id={ANALYSIS_FILTER_SLOT_ID}
                    className="w-full rounded-2xl border border-brand-200 bg-white/95 px-4 py-3 shadow-sm sm:w-auto sm:min-w-[320px]"
                  />
                )}
              </div>
              {showPeriodBadge && (
                <div className="flex justify-start sm:justify-end">
                  <span className="inline-flex items-center gap-4 rounded-full border-2 border-accent-400 bg-accent-50/90 px-5 py-2 text-accent-600 shadow-lg shadow-accent-400/40">
                    <span className="period-pulse flex h-10 w-10 items-center justify-center rounded-full bg-accent-500 text-white shadow-inner">
                      <CalendarRange className="h-5 w-5" />
                    </span>
                    <span className="flex flex-col gap-1">
                      <span className="text-xs font-semibold tracking-[0.3em] text-accent-500">
                        表示期間
                      </span>
                      <span className="inline-flex w-full items-center justify-start rounded-md bg-white px-3 py-1 text-sm font-bold text-slate-900">
                        {analysisPeriodLabel}
                      </span>
                    </span>
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between gap-6 pb-2">
            <div className="hidden md:flex gap-2 py-2">
              {links.map((link) => {
                const isActive =
                  link.href === "/"
                    ? pathname === "/"
                    : link.href === "/patients"
                      ? pathname === "/patients" ||
                        (pathname.startsWith("/patients/") && !pathname.startsWith("/patients/lifestyle"))
                      : pathname === link.href || pathname.startsWith(`${link.href}/`);
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                      isActive
                        ? "bg-brand-500 text-white shadow-soft"
                        : "text-slate-500 hover:bg-brand-50 hover:text-brand-600"
                    }`}
                  >
                    {link.label}
                  </Link>
                );
              })}
            </div>

            <button
              onClick={toggleMenu}
              className="md:hidden p-4 sm:p-5 rounded-2xl bg-brand-500 text-white hover:bg-brand-600 active:scale-95 transition-all shadow-lg"
              aria-label="メニュー"
            >
              {isOpen ? (
                <X className="h-8 w-8 sm:h-9 sm:w-9" />
              ) : (
                <Menu className="h-8 w-8 sm:h-9 sm:w-9" />
              )}
            </button>
          </div>
        </div>

        {isOpen && (
          <div className="md:hidden fixed inset-0 bg-black/30 z-40" onClick={closeMenu} />
        )}

        <div
          className={`md:hidden fixed inset-0 bg-white z-50 transform transition-transform duration-300 ease-in-out ${
            isOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="flex flex-col h-full">
            <div className="flex items-center justify-between p-6 border-b border-slate-200 shadow-sm">
              <h2 className="text-2xl font-bold text-brand-600">メニュー</h2>
              <button
                onClick={closeMenu}
                className="p-3 rounded-xl bg-slate-100 text-slate-600 hover:bg-slate-200 active:scale-95 transition-all"
                aria-label="閉じる"
              >
                <X className="h-7 w-7" />
              </button>
            </div>
            <div className="flex-1 flex flex-col p-6">
              <nav className="flex flex-col flex-1 justify-around gap-3">
              {links.map((link) => {
                const isActive =
                  link.href === "/"
                    ? pathname === "/"
                    : link.href === "/patients"
                        ? pathname === "/patients" ||
                          (pathname.startsWith("/patients/") && !pathname.startsWith("/patients/lifestyle"))
                        : pathname === link.href || pathname.startsWith(`${link.href}/`);
                  return (
                    <Link
                      key={link.href}
                      href={link.href}
                      onClick={closeMenu}
                      className={`flex items-center justify-center flex-1 px-6 text-2xl font-bold rounded-2xl transition-all shadow-lg ${
                        isActive
                          ? "bg-gradient-to-r from-brand-500 to-brand-600 text-white shadow-xl scale-105"
                          : "bg-slate-100 text-slate-700 hover:bg-brand-50 hover:text-brand-600 hover:scale-105 hover:shadow-xl active:scale-95"
                      }`}
                    >
                      {link.label}
                    </Link>
                  );
                })}
              </nav>
            </div>
          </div>
        </div>

        <div className="h-1 bg-gradient-to-r from-brand-500/80 via-accent-400/80 to-brand-500/80" />
      </nav>

    </>
  );
}

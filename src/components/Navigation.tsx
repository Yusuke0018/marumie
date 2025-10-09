"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Menu, X } from "lucide-react";

export default function Navigation() {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);

  const links = [
    { href: "/" as const, label: "患者分析" },
    { href: "/reservations" as const, label: "予約分析" },
    { href: "/survey" as const, label: "アンケート分析" },
    { href: "/listing" as const, label: "リスティング分析" },
    { href: "/correlation" as const, label: "相関分析" },
  ];

  const toggleMenu = () => setIsOpen(!isOpen);
  const closeMenu = () => setIsOpen(false);

  return (
    <nav className="sticky top-0 z-50 border-b border-brand-100/70 bg-white/95 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-white/70">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-4 sm:px-6">
        <h1 className="py-4 text-lg sm:text-xl font-bold tracking-wide text-brand-600">マルミエ</h1>

        {/* デスクトップナビゲーション */}
        <div className="hidden md:flex gap-2 py-2">
          {links.map((link) => {
            const isActive =
              link.href === "/"
                ? pathname === "/" || pathname.startsWith("/patients")
                : pathname === link.href;
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

        {/* モバイルハンバーガーボタン - 大幅に拡大 */}
        <button
          onClick={toggleMenu}
          className="md:hidden p-4 sm:p-5 rounded-2xl bg-brand-500 text-white hover:bg-brand-600 active:scale-95 transition-all shadow-lg"
          aria-label="メニュー"
        >
          {isOpen ? <X className="h-8 w-8 sm:h-9 sm:w-9" /> : <Menu className="h-8 w-8 sm:h-9 sm:w-9" />}
        </button>
      </div>

      {/* モバイルメニュー背景オーバーレイ */}
      {isOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/30 z-40"
          onClick={closeMenu}
        />
      )}

      {/* モバイル全画面メニュー */}
      <div
        className={`md:hidden fixed inset-0 bg-white z-50 transform transition-transform duration-300 ease-in-out ${
          isOpen ? "translate-x-0" : "translate-x-full"
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
          <div className="flex-1 overflow-y-auto p-6">
            <nav className="flex flex-col gap-4">
              {links.map((link) => {
                const isActive =
                  link.href === "/"
                    ? pathname === "/" || pathname.startsWith("/patients")
                    : pathname === link.href;
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={closeMenu}
                    className={`flex items-center justify-center px-8 py-7 text-xl font-bold rounded-2xl transition-all shadow-lg ${
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
  );
}

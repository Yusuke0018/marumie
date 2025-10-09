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
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-6">
        <h1 className="py-4 text-lg font-bold tracking-wide text-brand-600">マルミエ</h1>

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

        {/* モバイルハンバーガーボタン */}
        <button
          onClick={toggleMenu}
          className="md:hidden p-2 rounded-lg text-slate-600 hover:bg-brand-50 hover:text-brand-600 transition"
          aria-label="メニュー"
        >
          {isOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </div>

      {/* モバイルドロワーメニュー */}
      <div
        className={`md:hidden fixed inset-y-0 left-0 w-64 bg-white shadow-2xl transform transition-transform duration-300 ease-in-out ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex flex-col h-full">
          <div className="p-6 border-b border-slate-200">
            <h2 className="text-xl font-bold text-brand-600">マルミエ</h2>
          </div>
          <div className="flex-1 overflow-y-auto py-4">
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
                  className={`flex items-center px-6 py-3 text-sm font-semibold transition ${
                    isActive
                      ? "bg-brand-50 text-brand-600 border-l-4 border-brand-500"
                      : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </div>
        </div>
      </div>

      {/* オーバーレイ */}
      {isOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/50 z-40"
          onClick={closeMenu}
        />
      )}

      <div className="h-1 bg-gradient-to-r from-brand-500/80 via-accent-400/80 to-brand-500/80" />
    </nav>
  );
}

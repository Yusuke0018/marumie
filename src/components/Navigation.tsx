"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function Navigation() {
  const pathname = usePathname();

  const links = [
    { href: "/" as const, label: "予約分析" },
    { href: "/survey" as const, label: "アンケート分析" },
    { href: "/listing" as const, label: "リスティング分析" },
    { href: "/correlation" as const, label: "相関分析" },
  ];

  return (
    <nav className="sticky top-0 z-50 border-b border-brand-100/70 bg-white/95 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-white/70">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-6">
        <h1 className="py-4 text-lg font-bold tracking-wide text-brand-600">マルミエ</h1>
        <div className="flex gap-2 py-2">
          {links.map((link) => {
            const isActive = pathname === link.href;
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
      </div>
      <div className="h-1 bg-gradient-to-r from-brand-500/80 via-accent-400/80 to-brand-500/80" />
    </nav>
  );
}

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
    <nav className="border-b border-slate-200 bg-white">
      <div className="mx-auto max-w-6xl px-6">
        <div className="flex items-center gap-8">
          <h1 className="py-4 text-lg font-bold text-slate-900">マルミエ</h1>
          <div className="flex gap-1">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                  pathname === link.href
                    ? "bg-brand-50 text-brand-600"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                }`}
              >
                {link.label}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </nav>
  );
}

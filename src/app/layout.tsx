import type { Metadata } from "next";
import { Noto_Sans_JP } from "next/font/google";
import type { ReactNode } from "react";
import Navigation from "@/components/Navigation";
import "./globals.css";

const notoSans = Noto_Sans_JP({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  display: "swap",
  variable: "--font-sans",
});

export const metadata: Metadata = {
  title: "マルミエ",
  description:
    "診療科ごとの予約傾向を可視化するチームみらいの分析ダッシュボード「マルミエ」。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
return (
    <html lang="ja">
      <body
        className={`${notoSans.variable} min-h-screen bg-white text-slate-900 antialiased`}
      >
        <Navigation />
        {children}
      </body>
    </html>
  );
}

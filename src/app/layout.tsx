import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Clinic Reservations Analytics",
  description:
    "予約ログCSVから診療科ごとの予約傾向を可視化するダッシュボード。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="ja">
      <body className="min-h-screen bg-midnight-950 text-midnight-50 antialiased">
        {children}
      </body>
    </html>
  );
}

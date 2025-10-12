# 要件整理
アプリは予約ログやカルテCSVをブラウザに読み込み、初診／再診や診療科別の指標を可視化することが主目的です。[src/app/reservations/page.tsx:720-839]
カルテデータを地図と年代で分析する追加ページがあり、町丁目単位での来院傾向把握を求めています。[src/app/map-analysis/page.tsx:96-210]

## 機能要件
- 予約CSVと共有データの取り込み・LocalStorage保存・差分表示。[src/app/reservations/page.tsx:720-839]
- カルテ記録を集約しトップKPIとグラフへ反映するホームダッシュボード。[src/app/page.tsx:114-176]
- Cloudflare Worker を介したCSV共有APIでのアップロード／取得とCORS対応。[cloudflare-worker/src/index.ts:1-154]
- 地図分析ページで科目・年代フィルタを切り替えつつ町丁目ヒートマップを描画する。[src/app/map-analysis/page.tsx:244-340][src/components/reservations/GeoDistributionMap.tsx:640-928]

## 非機能要件
- Next.js 14 (App Router) と React 18 を使用したSSR/SSG対応とTypeScript型安全性。[package.json:1-40]
- Lint/Build/Preview をnpm scripts経由で提供し、CI/CDで自動実行できる構成にする。[package.json:5-11]
- R2バケットを用いた共有APIはCORS制御とエラー応答を実装済みで、可用性を保つ必要がある。[cloudflare-worker/src/index.ts:15-154]

## 質問
- 質問: Cloudflare Workerで許可するオリジンとVercel本番URLの最終リストはこれで確定でしょうか？
  - 提案A: Vercel本番ドメイン決定後にallowedOriginsへ明示的に追加する。
  - 提案B: Secretsから許可ドメインを読み込めるようにし、デプロイ先ごとに変更不要にする。 

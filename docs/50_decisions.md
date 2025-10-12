# 意思決定ログ
- 予約・カルテ・アンケートCSVはブラウザのLocalStorageへ圧縮保存し、端末ローカル分析を優先する方針とした。[src/lib/storageCompression.ts:1-120][src/app/reservations/page.tsx:720-839]
- 共有機能はCloudflare Worker + R2でID付きURLを返すアーキテクチャを採用し、Vercel本体からはHTTP経由で連携する。[cloudflare-worker/src/index.ts:48-114][src/app/reservations/page.tsx:720-807]
- 地図分析はLeafletベースの独立ページへ切り出し、予約ページ本体からはリンクで案内する構成にした。[src/app/reservations/page.tsx:1410-1499][src/app/map-analysis/page.tsx:244-340]

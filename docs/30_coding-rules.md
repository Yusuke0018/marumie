# コーディング規約
TypeScriptはstrictモードでビルド出力を禁止し、Next.js用パスエイリアス`@/*`を利用します。[tsconfig.json:1-26]
Next.js App Router構成ではクライアントコンポーネントを `\"use client\"` 冒頭宣言の上でフックを利用し、データ圧縮は共通ライブラリ経由で呼び出します。[src/app/page.tsx:1-69][src/lib/storageCompression.ts:1-120]
Lint/Build/Previewは既存のnpm scriptsに統一し、CIも同じコマンドを使用します。[package.json:5-11]

## 推奨パターン
- データ共有は`cloudflare-worker`のREST API経由で行い、直接R2へアクセスしない。[cloudflare-worker/src/index.ts:48-134]
- 地図表示は `GeoDistributionMap` の集約ロジックを再利用し、直接Leafletへアクセスしない。[src/components/reservations/GeoDistributionMap.tsx:320-928]

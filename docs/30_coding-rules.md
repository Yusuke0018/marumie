# コーディング規約
TypeScriptはstrictモードでビルド出力を禁止し、Next.js用パスエイリアス`@/*`を利用します。[tsconfig.json:1-26]
Next.js App Router構成ではクライアントコンポーネントを `\"use client\"` 冒頭宣言の上でフックを利用し、データ圧縮は共通ライブラリ経由で呼び出します。[src/app/page.tsx:1-69][src/lib/storageCompression.ts:1-120]
Lint/Build/Previewは既存のnpm scriptsに統一し、CIも同じコマンドを使用します。[package.json:5-11]
ローカルストレージへの読込・保存は予約・リスティング・アンケートなどの型付きヘルパーを経由し、生データへ直接アクセスしません。[src/lib/reservationData.ts:1-320][src/lib/listingData.ts:1-200][src/lib/surveyData.ts:1-220]
Cloudflare Worker との連携は `src/lib/dataShare.ts` のヘルパーを介して行い、`NEXT_PUBLIC_WORKER_URL` でエンドポイントを切り替えます。[src/lib/dataShare.ts:1-50]
Heavyなチャートやグラフは `React.lazy` と `Suspense` で遅延読み込みし、初期バンドルを抑えます。[src/app/patients/page.tsx:53-132]
期間フィルタとラベル制御は `AnalysisFilterPortal` と `useAnalysisPeriodRange` を共通利用し、`setAnalysisPeriodLabel` で表示を同期させます。[src/app/listing/page.tsx:23-140][src/app/correlation/page.tsx:9-150][src/app/survey/page.tsx:19-160]

## 推奨パターン
- データ共有は`cloudflare-worker`のREST API経由で行い、直接R2へアクセスしない。[cloudflare-worker/src/index.ts:48-134]
- 地図表示は `GeoDistributionMap` の集約ロジックを再利用し、直接Leafletへアクセスしない。[src/components/reservations/GeoDistributionMap.tsx:320-928]
 - 遅延読み込みでは Next の `dynamic()` も適宜活用し、初期バンドルを抑える。[src/app/map-analysis/page.tsx:131-134]

## 実行環境
- Node.js は CI と同じ v20 系を推奨します。`.nvmrc` か `package.json#engines` でバージョンを固定し、ローカル差異を抑制します。[.github/workflows/deploy.yml:1-120]

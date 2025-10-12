# 画面・データ仕様
ホーム(`/`)は保存済みカルテやアンケートデータを読み込み、月次KPIと更新日をカード表示します。[src/app/page.tsx:114-189]
予約分析(`/reservations`)は予約CSVをアップロードしてLocalStorageへ保持し、時間帯・曜日・診療科ごとのグラフと差分を表示します。[src/app/reservations/page.tsx:720-1045]
マップ分析(`/map-analysis`)はカルテ記録をロードして町丁目別・年代別のヒートマップと統計サマリを描画します。[src/app/map-analysis/page.tsx:96-360]
期間比較サンキー図はノードをビビッドカラーで表示し、帯は反転した淡色とアウトラインを重ねた曲線で描画して縮尺を補正し、0.1%の変化でも幅とハイライトで視認できるようにしています。[src/app/map-analysis/page.tsx:728-910]
Cloudflare Worker は `/api/upload` と `/api/data/:id` を提供し、R2バケットでデータ共有を行います。[cloudflare-worker/src/index.ts:48-134]
地図表示は大阪府町丁目データと全国市区町村座標を組み合わせ、町丁目未特定の場合は市区町村代表点を描画します。[public/data/osaka_towns.json:1][public/data/municipalities.json:1][src/components/reservations/GeoDistributionMap.tsx:538-940]

## データ入力/出力
- フロントCSV: 予約ログ・カルテ・アンケートをブラウザ圧縮保存する。[src/lib/storageCompression.ts:1-120]
- 共有API: JSON文字列をR2へ保存しID付きURLを返却する。[cloudflare-worker/src/index.ts:48-75]
- 地理マスター: `public/data/osaka_towns.json` と `public/data/municipalities.json` をロードし、町丁目と市区町村代表点を使い分ける。[src/components/reservations/GeoDistributionMap.tsx:538-940]

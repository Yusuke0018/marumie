# 画面・データ仕様
ホーム(`/`)は保存済みカルテやアンケートデータを読み込み、月次KPIと更新日をカード表示します。生活習慣病患者数と内科紹介件数のカードは診断・アンケートの最新期間を集計し、期間ラベルと最終更新日時を添えて提示します。[src/app/page.tsx:114-189][src/app/page.tsx:253][src/app/page.tsx:290][src/app/page.tsx:366][src/app/page.tsx:377]
予約分析(`/reservations`)は予約CSVをアップロードしてLocalStorageへ保持し、時間帯・曜日・診療科ごとのグラフと差分を表示します。[src/app/reservations/page.tsx:720-1045]
マップ分析(`/map-analysis`)はカルテ記録をロードして町丁目別・年代別のヒートマップと統計サマリを描画します。[src/app/map-analysis/page.tsx:96-360]
期間比較ビューは町丁目ごとの期間A・期間Bの割合を縦棒グラフで並置し、地図クリックで地区を追加しつつ差分バーと破線基準線で増減率を明示します。[src/app/map-analysis/page.tsx:960-1140]
リスティング分析(`/listing`)は広告CSVをカテゴリ別（内科・発熱外来・胃カメラ・大腸カメラ）に取り込み、金額・CV推移と時間帯別CVを可視化します。[src/app/listing/page.tsx:1-360][src/lib/listingData.ts:1-200]
広告と予約の相関分析(`/correlation`)はListingデータと予約データを読み込み、Pearson相関と散布図・時間帯比較で関係性を評価します。発熱訴求のCSVは発熱外来カテゴリとして扱い、診療科「発熱外来」との相関を算出します。[src/app/correlation/page.tsx:1-400]
患者分析(`/patients`)はカルテ・予約・診断・アンケート・リスティングを統合し、月次トレンドや診療科別指標、データ共有を提供します。多変量解析タブでは全体・総合診療・発熱外来の各セグメントを切り替え、曜日カードを展開すると時間帯グラフと年齢別サマリが表示されます。[src/app/patients/page.tsx:1-540]
生活習慣病フォーカス分析(`/patients/lifestyle`)は `LifestyleViewContext` を `true` にして `/patients` 画面のロジックを再利用し、診断CSVから生活習慣病カテゴリに該当する直近6か月の患者数と期間ラベルを抽出します。[src/app/patients/lifestyle/page.tsx:1-12][src/app/patients/page.tsx:105][src/app/patients/page.tsx:995-1150]
データ管理からはカルテ・予約・アンケート・リスティング・傷病名のCSVを個別またはまとめて取り込める一括アップロードを提供します。ファイル名のキーワードで自動振り分けします。[src/app/patients/page.tsx:5620]
アンケート分析(`/survey`)は流入チャネル別の円グラフと比較ビューでアンケート回答を分析します。[src/app/survey/page.tsx:1-240]
Cloudflare Worker は `/api/upload` と `/api/data/:id` を提供し、R2バケットでデータ共有を行います。[cloudflare-worker/src/index.ts:48-134]
地図表示は大阪府町丁目データと全国市区町村座標を組み合わせ、町丁目未特定の場合は市区町村代表点を描画します。[public/data/osaka_towns.json:1][public/data/municipalities.json:1][src/components/reservations/GeoDistributionMap.tsx:538-940]

## データ入力/出力
- フロントCSV: 予約ログ・カルテ・アンケートをブラウザ圧縮保存する。[src/lib/storageCompression.ts:1-120]
- 共有API: JSON文字列をR2へ保存しID付きURLを返却する。[cloudflare-worker/src/index.ts:48-75]
- 地理マスター: `public/data/osaka_towns.json` と `public/data/municipalities.json` をロードし、町丁目と市区町村代表点を使い分ける。[src/components/reservations/GeoDistributionMap.tsx:538-940]

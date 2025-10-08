# マルミエ

マルミエは Next.js 14（App Router）+ TypeScript + Tailwind CSS で構築した予約ログ解析ダッシュボードです。  
CSV をアップロードするとブラウザに保存され、初診/再診や診療科別の傾向を可視化します。

## セットアップ

```bash
npm install
npm run dev
```

開発サーバー: http://localhost:3000

## 主な機能

- CSV アップロードと LocalStorage への自動保存
- 全体の時間帯別・日別予約数のグラフ表示
- 診療科別 × 初診/再診の時間帯分布
- 月次サマリと最新アップロード差分の月次集計

## 本番ビルド

```bash
npm run build
npm start # out ディレクトリを静的ホスト
```

## Vercel デプロイ

ビルドコマンドは `npm run build`（静的サイト出力 = `out/`）。  
環境変数や追加のビルドステップは不要です。

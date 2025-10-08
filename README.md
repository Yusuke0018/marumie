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
npm start # 本番構成のサーバーモード
# GitHub Pages 用静的プレビューは npm run preview
```

## Vercel デプロイ

ビルドコマンドは `npm run build`、出力は Next.js の既定（/.next）を利用します。  
GitHub Pages 用の静的書き出しは CI 側で `GITHUB_PAGES=true npm run build` を実行してください。  
それ以外の環境変数や追加ステップは不要です。

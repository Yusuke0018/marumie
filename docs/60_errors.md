# 既知のリスクと対策
- CSV共有データが不正形式の場合、予約ページはフォールバック処理に失敗しエラーメッセージを出す。共有APIのレスポンス検証と再試行ガイドを整備する。[src/app/reservations/page.tsx:720-820]
- Cloudflare Worker の許可オリジンが不足するとCORSでフロントからのアップロードが拒否される。Secrets化したドメイン一覧を読み込み、ローカルと本番を定期的に検証する。[cloudflare-worker/src/index.ts:15-82]
- ブラウザ保存データが破損するとJSON.parseで例外が発生する。try/catchと空データ復旧パスを保持し、削除インストラクションをUIに掲載する。[src/app/page.tsx:118-176][src/lib/storageCompression.ts:17-125]
- 住所未入力のレコードは市区町村推定ができず地図に表示されない。CSV整形時に住所必須チェックを行い、空欄データは別途リスト化して補完するフローを検討する。[src/components/reservations/GeoDistributionMap.tsx:538-940]

- Node バージョン差異によりローカルとCIで再現性が崩れる恐れがある。CIは Node 20 を使用しており、ローカルも v20 系へ固定する。（`.nvmrc` または `package.json#engines` で統一）[.github/workflows/deploy.yml:1-120]
- Vercel Secrets 未設定時はデプロイステップがスキップされ、本番反映されないままになる可能性。main push 時にSecretsの有無をチェックするジョブや通知を追加して検知を強化する。[.github/workflows/deploy-vercel.yml:1-160]
 - ローカル Node v24.x での `npm ci` 実行時に `EBADENGINE` 警告が出るが、ビルドは成功する。再現性のため `nvm use 20` を徹底し、必要があれば `engines` の許容範囲拡大を検討する（当面は CI=20 を維持）。[package.json:39][.nvmrc:1]
- `eslint@8.57.1` に EOL 警告が出る。`eslint-config-next@14.2.33` との互換性を確認し、v9 系への段階的アップグレードとCIでの lint 監視を検討する。[package.json:1-40]
- `glob@10.2.0-10.4.5` に GHSA-5j98-mcp5-4vw2（コマンドインジェクション脆弱性、severity: high）が報告されている。`@next/eslint-plugin-next` 経由で導入されており、`eslint-config-next@16.1.1` へのメジャーアップグレードで解消可能だが、Next.js 14 との互換性を確認する必要がある。[package.json:30-40]
- `js-yaml@4.0.0-4.1.0` に GHSA-mh29-5h37-fv8m（prototype pollution、severity: moderate）が報告されている。直接の依存ではないが、eslint関連パッケージ経由で導入されている。[package.json:30-40]
- `npm audit` で5件の脆弱性（1 moderate, 4 high）が検出される。主に eslint-config-next / glob / js-yaml に起因し、`npm audit fix --force` でメジャーバージョンアップが必要。CI環境での定期的な監視を推奨する。(2026-01-02検証)
 - LocalStorage のクォータ超過（QuotaExceededError）でカルテ保存に失敗する場合がある。対策として圧縮データの動的チャンク保存（4MB→128KBまで段階縮小）と、カルテ保存時のフォールバック（直近18/12/9/6/3ヶ月のみ保存）を実装。全件保存が必要な場合は共有URL（R2）をご利用ください。[src/lib/storageCompression.ts:1-220][src/app/patients/page.tsx:1316]
- ネットワーク制限環境での `npm run build` 時に Google Fonts（Noto Sans JP）のフェッチが3回リトライ後に失敗し、ビルドエラー（NextFontError）となる。CI環境（GitHub Actions / Vercel）では問題なく動作するが、ローカル環境でネットワーク制限がある場合は `next/font/local` への切り替えやフォールバック処理を検討する。[src/app/layout.tsx:1-36]

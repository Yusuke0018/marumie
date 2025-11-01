# 既知のリスクと対策
- CSV共有データが不正形式の場合、予約ページはフォールバック処理に失敗しエラーメッセージを出す。共有APIのレスポンス検証と再試行ガイドを整備する。[src/app/reservations/page.tsx:720-820]
- Cloudflare Worker の許可オリジンが不足するとCORSでフロントからのアップロードが拒否される。Secrets化したドメイン一覧を読み込み、ローカルと本番を定期的に検証する。[cloudflare-worker/src/index.ts:15-82]
- ブラウザ保存データが破損するとJSON.parseで例外が発生する。try/catchと空データ復旧パスを保持し、削除インストラクションをUIに掲載する。[src/app/page.tsx:118-176][src/lib/storageCompression.ts:17-125]
- 住所未入力のレコードは市区町村推定ができず地図に表示されない。CSV整形時に住所必須チェックを行い、空欄データは別途リスト化して補完するフローを検討する。[src/components/reservations/GeoDistributionMap.tsx:538-940]

- Node バージョン差異によりローカルとCIで再現性が崩れる恐れがある。CIは Node 20 を使用しており、ローカルも v20 系へ固定する。（`.nvmrc` または `package.json#engines` で統一）[.github/workflows/deploy.yml:1-120]
- Vercel Secrets 未設定時はデプロイステップがスキップされ、本番反映されないままになる可能性。main push 時にSecretsの有無をチェックするジョブや通知を追加して検知を強化する。[.github/workflows/deploy-vercel.yml:1-160]

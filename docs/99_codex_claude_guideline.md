# AI支援ガイドライン
AIはNext.js 14/TypeScriptのstrict設定を尊重し、既存のnpm scriptsを経由して検証コマンドを提案します。[tsconfig.json:2-26][package.json:5-11]
ローカル保存データや共有APIを変更する場合は、Cloudflare Workerとフロント間の契約を確認し、CORS設定を壊さないよう注意してください。[cloudflare-worker/src/index.ts:15-134][src/app/reservations/page.tsx:720-807]
PR作成時はdocs更新とワークフロー変更を必ず含め、Secrets設定の手順をREADMEへ追記した上でレビュー依頼を出すこと。[README.md:1-40][docs/10_requirements.md:1-17]

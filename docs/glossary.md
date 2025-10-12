# 用語集
- LocalStorage圧縮: ブラウザ保存データをpakoとLZ互換方式で圧縮・分割するメカニズム。[src/lib/storageCompression.ts:1-125]
- R2バケット: Cloudflare WorkerがCSV共有データを保存するオブジェクトストレージ。[cloudflare-worker/src/index.ts:48-107]
- Leafletマップ: 来院エリアを可視化するための地図コンポーネントで、CircleMarkerとヒート色分けを利用する。[src/components/reservations/GeoDistributionMap.tsx:640-928]
- 予約差分集計: 最新アップロードと既存データの差異を月単位で表示する仕組み。[src/app/reservations/page.tsx:880-1045]

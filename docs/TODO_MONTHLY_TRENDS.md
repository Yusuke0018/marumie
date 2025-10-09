# 月次推移機能の実装TODO

## 概要
全ページで開始月・終了月を選択し、選択期間内の月次推移グラフを表示できるようにする機能の実装状況と残タスク。

## 実装済み ✅

### 患者分析ページ (`src/app/patients/page.tsx`)
- ✅ 開始月・終了月の選択UI
- ✅ 最新月サマリー：選択期間の月次推移グラフ（総患者、純初診、再初診、再診）
- ✅ 診療科別集計：診療科ドロップダウン選択による月次推移グラフ
- ✅ 月次推移セクション：全体の推移グラフ
- ✅ セクションタイトルに選択期間を表示

**実装詳細**:
- `MonthlySummaryChart`: 単月棒グラフ → 月次推移折れ線グラフに変更
- `DepartmentChart`: 診療科選択ドロップダウン + 月次推移折れ線グラフ

### 予約分析ページ (`src/app/reservations/page.tsx`)
- ✅ 開始月・終了月の選択UI（期間プリセットから変更）
- ✅ 月次サマリー：選択期間の月次推移グラフ（総予約数、初診、再診、当日予約）
- ✅ 期間フィルタリングが全セクション（曜日別、日付タイプ別、時間帯別、日別）に適用

**実装詳細**:
- 新規コンポーネント: `src/components/reservations/MonthlyTrendChart.tsx`
- `selectedPeriod`, `selectedMonth` → `startMonth`, `endMonth` に変更
- `filteredReservations` で期間フィルタリング
- `monthlyOverview` を `filteredReservations` から計算

### アンケート分析ページ (`src/app/survey/page.tsx`)
- ✅ 開始月・終了月の選択UI（カスタム期間フィルターから変更）
- ✅ 期間フィルタリングが外来・内視鏡の両方に適用
- ❌ 月次推移グラフ（未実装）

**実装詳細**:
- `selectedPeriod`, `customStartDate`, `customEndDate` → `startMonth`, `endMonth` に変更
- `gairaiData`, `naishikyoData` で期間フィルタリング

---

## 未実装 ⏳

### 1. アンケート分析ページ - 月次推移グラフの追加

**ファイル**: `src/app/survey/page.tsx`

**実装内容**:
1. 月次集計関数の追加
   ```typescript
   const aggregateSurveyMonthly = (data: SurveyData[]) => {
     // 月ごとに各チャネルの回答数を集計
     const monthlyMap = new Map<string, Record<string, number>>();
     // ... 実装
     return sortedMonthlyData;
   };
   ```

2. 月次推移グラフコンポーネントの作成
   - ファイル: `src/components/survey/MonthlyTrendChart.tsx`
   - Chart.js の折れ線グラフを使用
   - 各チャネル（Google検索、Googleマップ、看板、紹介など）を別々の折れ線で表示

3. UIの追加
   - 外来セクションに月次推移グラフ表示ボタンとグラフ追加
   - 内視鏡セクションに月次推移グラフ表示ボタンとグラフ追加

**参考実装**: `src/components/reservations/MonthlyTrendChart.tsx`

---

### 2. リスティング分析ページ

**ファイル**: `src/app/listing/page.tsx`

**現状**:
- 期間フィルター: `selectedPeriod` (all/3months/6months/1year)
- カテゴリ別フィルター: 内科、胃カメラ、大腸カメラ

**実装内容**:

#### A. 開始月・終了月選択UIの追加
1. State変更
   ```typescript
   // 変更前
   const [selectedPeriod, setSelectedPeriod] = useState<PeriodType>("all");
   
   // 変更後
   const [startMonth, setStartMonth] = useState<string>("");
   const [endMonth, setEndMonth] = useState<string>("");
   ```

2. `availableMonths` の算出
   ```typescript
   const availableMonths = useMemo(() => {
     const months = new Set(listingData.map(d => d.month));
     return Array.from(months).sort();
   }, [listingData]);
   ```

3. `useEffect` で最新月を自動選択
   ```typescript
   useEffect(() => {
     if (availableMonths.length === 0) return;
     const latestMonth = availableMonths[availableMonths.length - 1];
     if (!startMonth && !endMonth) {
       setStartMonth(latestMonth);
       setEndMonth(latestMonth);
     }
   }, [availableMonths, startMonth, endMonth]);
   ```

4. UI追加（患者分析ページと同様）
   ```tsx
   <div className="flex items-center gap-2">
     <label className="text-sm font-semibold text-slate-700">開始月:</label>
     <select value={startMonth} onChange={(e) => setStartMonth(e.target.value)}>
       <option value="">選択してください</option>
       {availableMonths.map((month) => (
         <option key={month} value={month}>{formatMonthLabel(month)}</option>
       ))}
     </select>
   </div>
   <div className="flex items-center gap-2">
     <label className="text-sm font-semibold text-slate-700">終了月:</label>
     <select value={endMonth} onChange={(e) => setEndMonth(e.target.value)}>
       <option value="">選択してください</option>
       {availableMonths.map((month) => (
         <option key={month} value={month}>{formatMonthLabel(month)}</option>
       ))}
     </select>
   </div>
   ```

#### B. フィルタリングロジックの更新
```typescript
const filteredData = useMemo(() => {
  let filtered = listingData;
  
  // カテゴリフィルター
  if (selectedCategory !== "all") {
    filtered = filtered.filter(d => d.category === selectedCategory);
  }
  
  // 期間フィルター
  if (startMonth && endMonth) {
    filtered = filtered.filter(d => d.month >= startMonth && d.month <= endMonth);
  } else if (startMonth) {
    filtered = filtered.filter(d => d.month >= startMonth);
  } else if (endMonth) {
    filtered = filtered.filter(d => d.month <= endMonth);
  }
  
  return filtered;
}, [listingData, selectedCategory, startMonth, endMonth]);
```

#### C. 月次推移グラフの追加
1. 月次集計関数の追加
   ```typescript
   const monthlyMetrics = useMemo(() => {
     // 月ごとにクリック数、インプレッション数、費用などを集計
     const monthlyMap = new Map();
     // ... 実装
     return sortedMonthlyData;
   }, [filteredData]);
   ```

2. グラフコンポーネントの作成
   - ファイル: `src/components/listing/MonthlyTrendChart.tsx`
   - クリック数、インプレッション数、費用、CTR、CPCなどを折れ線グラフで表示
   - 複数のY軸を使用（左: 数値、右: 金額）

3. UIの追加
   - グラフ表示ボタンとグラフエリアを追加
   - カテゴリごとの推移を表示

**参考実装**: `src/components/reservations/MonthlyTrendChart.tsx`

---

### 3. 相関分析ページ

**ファイル**: `src/app/correlation/page.tsx`

**現状**:
- 予約データとリスティングデータの相関を分析
- 期間フィルター: `selectedPeriod` (all/3months/6months/1year)

**実装内容**:

#### A. 開始月・終了月選択UIの追加
（リスティング分析ページと同様の実装）

#### B. フィルタリングロジックの更新
```typescript
const filteredReservations = useMemo(() => {
  let filtered = reservations;
  
  if (startMonth && endMonth) {
    filtered = filtered.filter(r => r.reservationMonth >= startMonth && r.reservationMonth <= endMonth);
  } else if (startMonth) {
    filtered = filtered.filter(r => r.reservationMonth >= startMonth);
  } else if (endMonth) {
    filtered = filtered.filter(r => r.reservationMonth <= endMonth);
  }
  
  return filtered;
}, [reservations, startMonth, endMonth]);

const filteredListingData = useMemo(() => {
  let filtered = listingData;
  
  if (startMonth && endMonth) {
    filtered = filtered.filter(d => d.month >= startMonth && d.month <= endMonth);
  } else if (startMonth) {
    filtered = filtered.filter(d => d.month >= startMonth);
  } else if (endMonth) {
    filtered = filtered.filter(d => d.month <= endMonth);
  }
  
  return filtered;
}, [listingData, startMonth, endMonth]);
```

#### C. 月次推移グラフの追加
1. 相関分析用の月次集計
   ```typescript
   const monthlyCorrelation = useMemo(() => {
     // 月ごとに予約数とリスティング指標を結合
     const correlationMap = new Map();
     // ... 実装
     return sortedData;
   }, [filteredReservations, filteredListingData]);
   ```

2. グラフコンポーネントの作成
   - ファイル: `src/components/correlation/MonthlyCorrelationChart.tsx`
   - 予約数とクリック数/費用などを同時に表示
   - 2軸グラフ（左: 予約数、右: リスティング指標）

3. UIの追加
   - 相関指標の月次推移グラフ
   - 散布図で相関を視覚化

**参考実装**: `src/components/reservations/MonthlyTrendChart.tsx`

---

## 実装パターン

全ページで統一されたパターンを使用：

### 1. State管理
```typescript
const [startMonth, setStartMonth] = useState<string>("");
const [endMonth, setEndMonth] = useState<string>("");
```

### 2. 利用可能な月の取得
```typescript
const availableMonths = useMemo(() => {
  const months = new Set(data.map(d => d.month)); // またはreservationMonth
  return Array.from(months).sort();
}, [data]);
```

### 3. 最新月の自動選択
```typescript
useEffect(() => {
  if (availableMonths.length === 0) return;
  const latestMonth = availableMonths[availableMonths.length - 1];
  if (!startMonth && !endMonth) {
    setStartMonth(latestMonth);
    setEndMonth(latestMonth);
  }
}, [availableMonths, startMonth, endMonth]);
```

### 4. フィルタリング
```typescript
const filteredData = useMemo(() => {
  let filtered = data;
  
  if (startMonth && endMonth) {
    filtered = filtered.filter(d => d.month >= startMonth && d.month <= endMonth);
  } else if (startMonth) {
    filtered = filtered.filter(d => d.month >= startMonth);
  } else if (endMonth) {
    filtered = filtered.filter(d => d.month <= endMonth);
  }
  
  return filtered;
}, [data, startMonth, endMonth]);
```

### 5. UI（共通パターン）
```tsx
<div className="flex flex-wrap items-center gap-4">
  <div className="flex items-center gap-2">
    <label className="text-sm font-semibold text-slate-700">開始月:</label>
    <select
      value={startMonth}
      onChange={(e) => setStartMonth(e.target.value)}
      disabled={availableMonths.length === 0}
      className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 shadow-sm transition hover:border-brand-300 focus:border-brand-400 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
    >
      <option value="">選択してください</option>
      {availableMonths.map((month) => (
        <option key={month} value={month}>
          {formatMonthLabel(month)}
        </option>
      ))}
    </select>
  </div>
  <div className="flex items-center gap-2">
    <label className="text-sm font-semibold text-slate-700">終了月:</label>
    <select
      value={endMonth}
      onChange={(e) => setEndMonth(e.target.value)}
      disabled={availableMonths.length === 0}
      className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 shadow-sm transition hover:border-brand-300 focus:border-brand-400 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
    >
      <option value="">選択してください</option>
      {availableMonths.map((month) => (
        <option key={month} value={month}>
          {formatMonthLabel(month)}
        </option>
      ))}
    </select>
  </div>
</div>
```

### 6. 月次推移グラフコンポーネント（テンプレート）
```typescript
import { useMemo } from "react";
import dynamic from "next/dynamic";

const Chart = dynamic(() => import("react-chartjs-2").then((mod) => mod.Chart), {
  ssr: false,
});

if (typeof window !== "undefined") {
  import("chart.js").then((ChartJS) => {
    ChartJS.Chart.register(
      ChartJS.CategoryScale,
      ChartJS.LinearScale,
      ChartJS.LineElement,
      ChartJS.PointElement,
      ChartJS.Tooltip,
      ChartJS.Legend,
      ChartJS.Title,
    );
  });
}

type MonthlyData = {
  month: string;
  // ... 必要なフィールド
};

type MonthlyTrendChartProps = {
  monthlyData: MonthlyData[];
};

const formatMonthLabel = (month: string): string => {
  const [year, monthNum] = month.split("-");
  return `${year}年${monthNum}月`;
};

export const MonthlyTrendChart = ({ monthlyData }: MonthlyTrendChartProps) => {
  const chartData = useMemo(() => {
    const sortedData = [...monthlyData].sort((a, b) => a.month.localeCompare(b.month));
    
    return {
      labels: sortedData.map((data) => formatMonthLabel(data.month)),
      datasets: [
        {
          label: "指標1",
          data: sortedData.map((data) => data.metric1),
          borderColor: "#3b82f6",
          backgroundColor: "#3b82f6",
          tension: 0.3,
        },
        // ... 他の指標
      ],
    };
  }, [monthlyData]);

  return (
    <div className="h-[400px]">
      <Chart
        type="line"
        data={chartData}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: "top",
            },
            tooltip: {
              callbacks: {
                label: (context) => {
                  return `${context.dataset.label}: ${context.parsed.y.toLocaleString("ja-JP")}`;
                },
              },
            },
          },
          scales: {
            y: {
              beginAtZero: true,
              ticks: {
                callback: (value) => `${value}`,
              },
            },
          },
        }}
      />
    </div>
  );
};
```

---

## テスト項目

実装後、以下を確認してください：

### 機能テスト
- [ ] 開始月・終了月の選択ができる
- [ ] 期間を変更すると全セクションのデータが更新される
- [ ] グラフが正しく表示される
- [ ] グラフの表示/非表示が切り替えられる
- [ ] 月の範囲が正しくフィルタリングされる（開始月 ≤ データ ≤ 終了月）
- [ ] 単一月選択時も正しく動作する（開始月 = 終了月）

### UI/UXテスト
- [ ] セクションタイトルに選択期間が表示される
- [ ] グラフが読みやすく、適切なサイズで表示される
- [ ] モバイルでも正しく表示される
- [ ] グラフの凡例が適切に配置される
- [ ] ツールチップが正しく動作する

### エッジケースのテスト
- [ ] データが0件の場合の表示
- [ ] 1ヶ月のみのデータの場合
- [ ] 開始月が未選択の場合の動作
- [ ] 終了月が未選択の場合の動作

---

## 参考資料

### 実装済みファイル
- `src/app/patients/page.tsx` - 患者分析ページ（完全実装済み）
- `src/app/reservations/page.tsx` - 予約分析ページ（完全実装済み）
- `src/components/patients/MonthlySummaryChart.tsx` - 月次サマリーグラフ
- `src/components/patients/DepartmentChart.tsx` - 診療科別グラフ
- `src/components/reservations/MonthlyTrendChart.tsx` - 予約月次推移グラフ

### ライブラリドキュメント
- [Chart.js](https://www.chartjs.org/docs/latest/) - グラフライブラリ
- [react-chartjs-2](https://react-chartjs-2.js.org/) - React用Chart.jsラッパー

---

## 作成日
2025年1月現在

## 最終更新
2025年1月（患者分析、予約分析、アンケート分析の一部実装完了）

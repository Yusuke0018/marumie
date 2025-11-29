/**
 * 経費データの型定義とパース処理
 */

// 勘定科目の型
export type AccountCategory =
  | '仕入高'
  | '広告宣伝費'
  | '地代家賃'
  | '支払手数料'
  | '通信費'
  | '水道光熱費'
  | '備品・消耗品費'
  | 'その他';

// 仕入高のカテゴリ
export type PurchaseCategory =
  | '検査キット'
  | 'AGA・ED治療薬'
  | '内視鏡関連'
  | 'その他医療材料'
  | '注射器・針類'
  | 'CPAP・呼吸器'
  | 'ワクチン・予防接種'
  | '消化器系薬剤'
  | '消毒・衛生材'
  | '糖尿病薬'
  | '麻酔・鎮静剤'
  | 'その他';

// 支払手数料の分類
export type FeeCategory =
  | 'システム利用料'
  | '振込・カード手数料'
  | '決済手数料'
  | '保守契約'
  | '外注検査料'
  | 'その他';

// 経費レコードの型
export interface ExpenseRecord {
  id: string;
  transactionNo: string;
  date: string;
  accountCategory: AccountCategory;
  subAccount: string;
  department: string;
  vendor: string;
  taxCategory: string;
  amount: number;
  creditAccount: string;
  description: string;
  // 分類用の追加フィールド
  purchaseCategory?: PurchaseCategory;
  feeCategory?: FeeCategory;
}

// 勘定科目別サマリー
export interface AccountSummary {
  category: AccountCategory;
  amount: number;
  ratio: number;
  count: number;
}

// 仕入高の取引先別サマリー
export interface VendorSummary {
  vendor: string;
  amount: number;
  ratio: number;
  count: number;
}

// 仕入高のカテゴリ別サマリー
export interface PurchaseCategorySummary {
  category: PurchaseCategory;
  amount: number;
  ratio: number;
  items: string[];
}

// 支払手数料の分類別サマリー
export interface FeeCategorySummary {
  category: FeeCategory;
  amount: number;
  ratio: number;
  count: number;
}

// 月次経費サマリー
export interface MonthlyExpenseSummary {
  yearMonth: string;
  totalAmount: number;
  accountSummaries: AccountSummary[];
  vendorSummaries: VendorSummary[];
  purchaseCategorySummaries: PurchaseCategorySummary[];
  feeCategorySummaries: FeeCategorySummary[];
  records: ExpenseRecord[];
}

// 勘定科目のマッピング
const accountCategoryMap: Record<string, AccountCategory> = {
  '仕入高': '仕入高',
  '広告宣伝費': '広告宣伝費',
  '地代家賃': '地代家賃',
  '支払手数料': '支払手数料',
  '通信費': '通信費',
  '水道光熱費': '水道光熱費',
  '備品・消耗品費': '備品・消耗品費',
};

// 仕入高カテゴリの判定キーワード
const purchaseCategoryKeywords: { category: PurchaseCategory; keywords: string[] }[] = [
  {
    category: '検査キット',
    keywords: ['クイックチェイサー', 'ピロリテック', 'HbA1c', 'フィニオン', 'SpotFire', 'BioFire', 'クイックナビ', 'テストキット', '検査', 'CRP'],
  },
  {
    category: 'AGA・ED治療薬',
    keywords: ['デュタステリド', 'ミノアップ', 'バイアグラ', 'タダラフィル', 'Dutasteride'],
  },
  {
    category: '内視鏡関連',
    keywords: ['ポリペクトミー', 'シュアクリップ', 'ムコアップ', 'ラディアルジョー', '回収ネット', 'エンドフラッシュ', '吸引ボタン', 'スネア'],
  },
  {
    category: 'CPAP・呼吸器',
    keywords: ['ジーパップ', 'CPAP', '酸素ボンベ', '亜酸化窒素', 'AirSense'],
  },
  {
    category: 'ワクチン・予防接種',
    keywords: ['シルガード', 'ワクシルガード', 'コミナティ', 'シングリックス', 'ワクチン', 'おたふく', 'ヘプタバックス', 'シダキュア', 'ワジェーピック', 'DTピック', 'トリビック'],
  },
  {
    category: '消化器系薬剤',
    keywords: ['モビプレップ', 'ニフレック', 'ピコスルファート', 'プリンペラン', 'ガスコン', 'プロナーゼ', 'ブスコパン'],
  },
  {
    category: '消毒・衛生材',
    keywords: ['エタワイパー', 'アルショット', 'ガウン', 'CPE', '消毒', 'エタノール', 'マスク'],
  },
  {
    category: '糖尿病薬',
    keywords: ['マンジャロ', 'GLP-1', 'メディセーフ', '血糖'],
  },
  {
    category: '麻酔・鎮静剤',
    keywords: ['ドルミカム', 'ペチジン', 'キシロカイン', 'ケタラール'],
  },
  {
    category: '注射器・針類',
    keywords: ['シリンジ', '採血針', '翼状針', '注射針', 'ベノジェクト', 'ホルダー', 'ルアーアダプタ', 'FNシリンジ'],
  },
  {
    category: 'その他医療材料',
    keywords: ['ディスポシーツ', 'サポートパンツ', '対極板', 'スーパーキャス', 'エクステンションチューブ', '活栓', '洗浄ブラシ', 'ガーゼ', '舌圧子'],
  },
];

// 支払手数料カテゴリの判定キーワード
const feeCategoryKeywords: { category: FeeCategory; keywords: string[] }[] = [
  {
    category: 'システム利用料',
    keywords: ['システム利用料', 'ダスキン', 'マーソ', 'フリーストレージ', 'AirSense', 'レスポンド'],
  },
  {
    category: '振込・カード手数料',
    keywords: ['振込手数料', 'カード手数料', '総合振込'],
  },
  {
    category: '決済手数料',
    keywords: ['決済手数料'],
  },
  {
    category: '保守契約',
    keywords: ['保守契約', 'FCR', 'ファインアシスト'],
  },
  {
    category: '外注検査料',
    keywords: ['検査料', '病理', 'ゾーン', '日本医学臨床', 'ティディワイ', '無呼吸検査'],
  },
];

// 仕入高カテゴリを判定
function detectPurchaseCategory(description: string): PurchaseCategory {
  for (const { category, keywords } of purchaseCategoryKeywords) {
    if (keywords.some((kw) => description.includes(kw))) {
      return category;
    }
  }
  return 'その他';
}

// 支払手数料カテゴリを判定
function detectFeeCategory(description: string): FeeCategory {
  for (const { category, keywords } of feeCategoryKeywords) {
    if (keywords.some((kw) => description.includes(kw))) {
      return category;
    }
  }
  return 'その他';
}

// CSVをパースして経費レコードを生成
export function parseExpenseCsv(csvText: string): ExpenseRecord[] {
  const lines = csvText.split('\n');
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map((h) => h.trim());
  const records: ExpenseRecord[] = [];

  // ヘッダーのインデックスを取得
  const idxId = headers.indexOf('id');
  const idxTransNo = headers.indexOf('取引No');
  const idxDate = headers.indexOf('取引日');
  const idxDebitAccount = headers.indexOf('借方勘定科目');
  const idxDebitSub = headers.indexOf('借方補助科目');
  const idxDebitDept = headers.indexOf('借方部門');
  const idxDebitVendor = headers.indexOf('借方取引先');
  const idxDebitTax = headers.indexOf('借方税区分');
  const idxDebitAmount = headers.indexOf('借方金額(円)');
  const idxCreditAccount = headers.indexOf('貸方勘定科目');
  const idxDescription = headers.indexOf('摘要');

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // CSVの行をパース（カンマ区切り、ダブルクォート対応）
    const values = parseCsvLine(line);
    if (values.length < Math.max(idxDebitAccount, idxDebitAmount, idxDescription) + 1) continue;

    const debitAccount = values[idxDebitAccount]?.trim() || '';
    const creditAccount = values[idxCreditAccount]?.trim() || '';
    const amountStr = values[idxDebitAmount]?.trim() || '0';
    const amount = parseInt(amountStr.replace(/,/g, ''), 10) || 0;

    // 借方が経費科目の場合のみ処理（貸方が経費科目の場合は戻し処理なので除外）
    const accountCategory = accountCategoryMap[debitAccount];
    if (!accountCategory || amount <= 0) continue;

    const description = values[idxDescription]?.trim() || '';
    const record: ExpenseRecord = {
      id: values[idxId] || `${i}`,
      transactionNo: values[idxTransNo] || '',
      date: values[idxDate] || '',
      accountCategory,
      subAccount: values[idxDebitSub] || '',
      department: values[idxDebitDept] || '',
      vendor: values[idxDebitVendor] || '',
      taxCategory: values[idxDebitTax] || '',
      amount,
      creditAccount,
      description,
    };

    // カテゴリ分類
    if (accountCategory === '仕入高') {
      record.purchaseCategory = detectPurchaseCategory(description);
    } else if (accountCategory === '支払手数料') {
      record.feeCategory = detectFeeCategory(description);
    }

    records.push(record);
  }

  return records;
}

// CSVの1行をパース（ダブルクォート対応）
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

// 取引先名を正規化
function normalizeVendor(description: string, creditAccount: string): string {
  // 摘要から取引先を抽出
  const vendorPatterns = [
    /^(?:\d+年\d+月\s*)?([^：:]+)[：:]/, // "2025年10月 ㈱ケーエスケー：..."
    /^([㈱株式会社][^\s：:]+)/, // "㈱XXX"
    /^([^\s]+㈱)/, // "XXX㈱"
  ];

  for (const pattern of vendorPatterns) {
    const match = description.match(pattern);
    if (match) {
      return match[1].trim();
    }
  }

  // 貸方補助科目から取引先を取得
  if (creditAccount && creditAccount !== '請求書分' && creditAccount !== '引落し分') {
    return creditAccount;
  }

  return 'その他';
}

// 経費サマリーを生成
export function generateExpenseSummary(records: ExpenseRecord[]): MonthlyExpenseSummary {
  if (records.length === 0) {
    return {
      yearMonth: '',
      totalAmount: 0,
      accountSummaries: [],
      vendorSummaries: [],
      purchaseCategorySummaries: [],
      feeCategorySummaries: [],
      records: [],
    };
  }

  // 年月を取得
  const dates = records.map((r) => r.date).filter(Boolean);
  const yearMonth = dates.length > 0 ? dates[0].substring(0, 7) : '';

  // 総額
  const totalAmount = records.reduce((sum, r) => sum + r.amount, 0);

  // 勘定科目別サマリー
  const accountMap = new Map<AccountCategory, { amount: number; count: number }>();
  records.forEach((r) => {
    const current = accountMap.get(r.accountCategory) || { amount: 0, count: 0 };
    accountMap.set(r.accountCategory, {
      amount: current.amount + r.amount,
      count: current.count + 1,
    });
  });
  const accountSummaries: AccountSummary[] = Array.from(accountMap.entries())
    .map(([category, data]) => ({
      category,
      amount: data.amount,
      ratio: totalAmount > 0 ? data.amount / totalAmount : 0,
      count: data.count,
    }))
    .sort((a, b) => b.amount - a.amount);

  // 仕入高の取引先別サマリー
  const purchaseRecords = records.filter((r) => r.accountCategory === '仕入高');
  const purchaseTotal = purchaseRecords.reduce((sum, r) => sum + r.amount, 0);
  const vendorMap = new Map<string, { amount: number; count: number }>();
  purchaseRecords.forEach((r) => {
    const vendor = normalizeVendor(r.description, r.creditAccount);
    const current = vendorMap.get(vendor) || { amount: 0, count: 0 };
    vendorMap.set(vendor, {
      amount: current.amount + r.amount,
      count: current.count + 1,
    });
  });
  const vendorSummaries: VendorSummary[] = Array.from(vendorMap.entries())
    .map(([vendor, data]) => ({
      vendor,
      amount: data.amount,
      ratio: purchaseTotal > 0 ? data.amount / purchaseTotal : 0,
      count: data.count,
    }))
    .sort((a, b) => b.amount - a.amount);

  // 仕入高のカテゴリ別サマリー
  const purchaseCategoryMap = new Map<PurchaseCategory, { amount: number; items: Set<string> }>();
  purchaseRecords.forEach((r) => {
    const cat = r.purchaseCategory || 'その他';
    const current = purchaseCategoryMap.get(cat) || { amount: 0, items: new Set() };
    current.amount += r.amount;
    // 品目名を抽出（：の後ろ）
    const itemMatch = r.description.match(/[：:]([^（(]+)/);
    if (itemMatch) {
      current.items.add(itemMatch[1].trim().substring(0, 20));
    }
    purchaseCategoryMap.set(cat, current);
  });
  const purchaseCategorySummaries: PurchaseCategorySummary[] = Array.from(purchaseCategoryMap.entries())
    .map(([category, data]) => ({
      category,
      amount: data.amount,
      ratio: purchaseTotal > 0 ? data.amount / purchaseTotal : 0,
      items: Array.from(data.items).slice(0, 5),
    }))
    .sort((a, b) => b.amount - a.amount);

  // 支払手数料の分類別サマリー
  const feeRecords = records.filter((r) => r.accountCategory === '支払手数料');
  const feeTotal = feeRecords.reduce((sum, r) => sum + r.amount, 0);
  const feeCategoryMap = new Map<FeeCategory, { amount: number; count: number }>();
  feeRecords.forEach((r) => {
    const cat = r.feeCategory || 'その他';
    const current = feeCategoryMap.get(cat) || { amount: 0, count: 0 };
    feeCategoryMap.set(cat, {
      amount: current.amount + r.amount,
      count: current.count + 1,
    });
  });
  const feeCategorySummaries: FeeCategorySummary[] = Array.from(feeCategoryMap.entries())
    .map(([category, data]) => ({
      category,
      amount: data.amount,
      ratio: feeTotal > 0 ? data.amount / feeTotal : 0,
      count: data.count,
    }))
    .sort((a, b) => b.amount - a.amount);

  return {
    yearMonth,
    totalAmount,
    accountSummaries,
    vendorSummaries,
    purchaseCategorySummaries,
    feeCategorySummaries,
    records,
  };
}

// LocalStorage キー
const EXPENSE_STORAGE_KEY = 'marumie_expense_data';
const EXPENSE_TIMESTAMP_KEY = 'expense_timestamp';

// 経費データを保存
export function saveExpenseData(records: ExpenseRecord[], timestamp?: string): void {
  try {
    localStorage.setItem(EXPENSE_STORAGE_KEY, JSON.stringify(records));
    if (timestamp) {
      localStorage.setItem(EXPENSE_TIMESTAMP_KEY, timestamp);
    }
  } catch (e) {
    console.error('経費データの保存に失敗しました:', e);
  }
}

// 経費データを読み込み
export function loadExpenseData(): ExpenseRecord[] {
  try {
    const data = localStorage.getItem(EXPENSE_STORAGE_KEY);
    if (data) {
      return JSON.parse(data);
    }
  } catch (e) {
    console.error('経費データの読み込みに失敗しました:', e);
  }
  return [];
}

// 経費データをクリア
export function clearExpenseData(): void {
  localStorage.removeItem(EXPENSE_STORAGE_KEY);
  localStorage.removeItem(EXPENSE_TIMESTAMP_KEY);
}

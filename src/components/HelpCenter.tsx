/**
 * ヘルプ／ドキュメントセクション
 */

import './HelpCenter.css';

const workflowSteps = [
  'CSVテンプレートを更新し、2025-10-02以降のデータのみを保存します。',
  '画面上部の「CSVファイル読み込み」で各ファイルを選択し、ステータスが緑になることを確認します。',
  '月次フィルタで対象月を切り替え、リスティング・予約・アンケート・相関の各セクションで指標を確認します。',
  '必要に応じてCSVを差し替え、データステータスの警告／エラーを解消してからダッシュボードを共有します。'
];

const csvRequirements = [
  {
    title: 'リスティング（内科／胃カメラ／大腸カメラ）',
    sample: '例: リスティング - 内科.csv',
    columns: ['日付', '金額', 'CV', 'CVR', 'CPA', '0時〜23時の時間帯別CV'],
    notes: 'CVRは%形式（例: 16%）で入力してください。欠損値は空欄にすると警告扱いになります。'
  },
  {
    title: '予約ログ',
    sample: '例: 予約確認 - 予約ログ.csv',
    columns: ['予約日時', '診療科', '初再診', '当日予約', '必要に応じて件数列'],
    notes: '初診・再診を判定し、診療科名から自動でグルーピングします。同日予約の判定には当日予約列を利用します。'
  },
  {
    title: 'アンケート（外来・内視鏡）',
    sample: '例: アンケート調査 - 外来.csv',
    columns: ['日付', 'チャネル名の列（複数）'],
    notes: '空欄列や不要チャネルは自動除外されます。発熱外来(Google)は参考値として別枠集計します。'
  }
];

const cautions = [
  'ブラウザ内でのみ処理を行うため、個人情報はアップロード後も外部送信されません。',
  'エラーが発生したCSVはダッシュボードに反映されないため、ステータスで内容を確認の上、再アップロードしてください。',
  '集計は選択月に応じて自動更新されます。データ期間をまたぐ分析を行う場合は「全期間」を選択してください。',
  'GitHub Pagesにデプロイする際は、`dist`をコミットし、Actions経由で公開してください。'
];

export function HelpCenter() {
  return (
    <div className="help-center">
      <section className="help-section">
        <h3>利用フロー</h3>
        <ol className="help-steps">
          {workflowSteps.map((step, index) => (
            <li key={index}>
              <span className="step-index">{index + 1}</span>
              <p>{step}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="help-section">
        <h3>CSV要件とサンプル</h3>
        <div className="help-cards">
          {csvRequirements.map((item, index) => (
            <article key={index} className="help-card">
              <h4>{item.title}</h4>
              <span className="help-card__sample">{item.sample}</span>
              <div className="help-card__columns">
                <span>必須列</span>
                <ul>
                  {item.columns.map(column => (
                    <li key={column}>{column}</li>
                  ))}
                </ul>
              </div>
              <p className="help-card__note">{item.notes}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="help-section">
        <h3>運用メモ</h3>
        <ul className="help-notes">
          {cautions.map((note, index) => (
            <li key={index}>{note}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}

import { DataProvider } from './contexts/DataContext';
import { FileUpload } from './components/FileUpload';
import { MonthFilter } from './components/MonthFilter';
import { ListingView } from './components/ListingView';
import { SurveyView } from './components/SurveyView';
import { ReservationView } from './components/ReservationView';
import { CorrelationView } from './components/CorrelationView';
import { HelpCenter } from './components/HelpCenter';
import { DataStatusSummary } from './components/DataStatusSummary';
import './App.css';

function App() {
  return (
    <DataProvider>
      <div className="app-shell">
        <header className="app-hero">
          <div className="hero-inner">
            <div className="hero-main">
              <div className="hero-brand">
                <span className="brand-badge">Marumie</span>
                <h1>医療DXを加速する視認性の高い指標ダッシュボード</h1>
                <p className="brand-description">
                  2025年10月以降の広告・予約・顧客体験データを統合し、クリニックの意思決定をリアルタイムに支援します。
                </p>
              </div>
              <div className="hero-controls">
                <MonthFilter />
                <DataStatusSummary />
              </div>
            </div>
            <div className="hero-highlights">
              <div className="highlight-card">
                <span className="highlight-icon">📈</span>
                <div>
                  <p className="highlight-title">広告 × 予約の相関</p>
                  <p className="highlight-text">同日CVと初診予約を連動し、効果の高いチャネルを特定。</p>
                </div>
              </div>
              <div className="highlight-card">
                <span className="highlight-icon">🕒</span>
                <div>
                  <p className="highlight-title">時間帯ヒートマップ</p>
                  <p className="highlight-text">診療科別に混雑時間帯を把握し、スタッフ配置を最適化。</p>
                </div>
              </div>
              <div className="highlight-card">
                <span className="highlight-icon">🗂️</span>
                <div>
                  <p className="highlight-title">ブラウザ完結フロー</p>
                  <p className="highlight-text">CSVアップロードのみで安全に分析を完結できます。</p>
                </div>
              </div>
            </div>
          </div>
        </header>

        <nav className="primary-nav">
          <ul>
            <li><a href="#upload">データ投入</a></li>
            <li><a href="#listing">リスティング分析</a></li>
            <li><a href="#reservations">予約分析</a></li>
            <li><a href="#surveys">アンケート分析</a></li>
            <li><a href="#correlation">相関分析</a></li>
            <li><a href="#docs">ヘルプ</a></li>
          </ul>
        </nav>

        <main className="app-main">
          <section id="upload" className="dashboard-section">
            <div className="section-header">
              <div className="section-heading">
                <span className="section-eyebrow">INGEST</span>
                <h2>データ投入</h2>
                <p className="section-description">
                  CSVテンプレートから広告・予約・アンケートデータを読み込み、ダッシュボードへ反映します。
                </p>
              </div>
            </div>
            <FileUpload />
          </section>

          <section id="listing" className="dashboard-section">
            <div className="section-header">
              <div className="section-heading">
                <span className="section-eyebrow">LISTING</span>
                <h2>リスティング分析</h2>
                <p className="section-description">
                  内科・胃カメラ・大腸カメラの広告指標を日別／時間帯で可視化し、成果と費用対効果を俯瞰します。
                </p>
              </div>
            </div>
            <ListingView />
          </section>

          <section id="reservations" className="dashboard-section">
            <div className="section-header">
              <div className="section-heading">
                <span className="section-eyebrow">RESERVATION</span>
                <h2>予約分析</h2>
                <p className="section-description">
                  診療科 × 初診・再診の予約動向をヒートマップとタイムラインで把握し、需要の高まりに即応します。
                </p>
              </div>
            </div>
            <ReservationView />
          </section>

          <section id="surveys" className="dashboard-section">
            <div className="section-header">
              <div className="section-heading">
                <span className="section-eyebrow">VOICE</span>
                <h2>アンケート分析</h2>
                <p className="section-description">
                  外来・内視鏡の流入チャネルと満足度指標を集計し、マーケティング施策の質を把握します。
                </p>
              </div>
            </div>
            <SurveyView />
          </section>

          <section id="correlation" className="dashboard-section">
            <div className="section-header">
              <div className="section-heading">
                <span className="section-eyebrow">INSIGHT</span>
                <h2>相関分析</h2>
                <p className="section-description">
                  リスティングCVと初診予約件数をマッピングし、同日の成果をハイライト表示します。
                </p>
              </div>
            </div>
            <CorrelationView />
          </section>

          <section id="docs" className="dashboard-section">
            <div className="section-header">
              <div className="section-heading">
                <span className="section-eyebrow">GUIDE</span>
                <h2>ヘルプとドキュメント</h2>
                <p className="section-description">
                  CSVフォーマット、利用手順、指標定義を確認し、運用チームと情報を共有します。
                </p>
              </div>
            </div>
            <HelpCenter />
          </section>
        </main>

        <footer className="app-footer">
          <div className="footer-inner">
            <p>© 2025 Marumie Dashboard | All data stays on your browser.</p>
            <span className="footer-link">UI reference: team-mirai</span>
          </div>
        </footer>
      </div>
    </DataProvider>
  );
}

export default App;

import { DataProvider } from './contexts/DataContext';
import { FileUpload } from './components/FileUpload';
import { MonthFilter } from './components/MonthFilter';
import { ListingView } from './components/ListingView';
import { SurveyView } from './components/SurveyView';
import './App.css';

function App() {
  return (
    <DataProvider>
      <div className="App">
        <header className="App-header">
          <div className="header-content">
            <h1>📊 マルミエ</h1>
            <p className="header-subtitle">医療機関 広告分析ダッシュボード</p>
          </div>
        </header>

        <MonthFilter />

        <main className="App-main">
          <FileUpload />

          <div className="views-container">
            <ListingView />
            <SurveyView />
          </div>
        </main>

        <footer className="App-footer">
          <p>© 2025 マルミエ - すべてのデータ処理はブラウザ内で完結します</p>
        </footer>
      </div>
    </DataProvider>
  );
}

export default App;

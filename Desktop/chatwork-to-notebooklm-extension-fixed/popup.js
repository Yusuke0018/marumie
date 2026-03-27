/**
 * Chatwork to NotebookLM - Popup v5
 * 新規作成/既存選択を並列タブで切り替え
 */

document.addEventListener('DOMContentLoaded', async () => {
  const el = {
    screens: {
      notChatwork: document.getElementById('screen-not-chatwork'),
      main: document.getElementById('screen-main'),
      processing: document.getElementById('screen-processing'),
      complete: document.getElementById('screen-complete')
    },
    periodBtns: document.querySelectorAll('.period-btn'),
    customDates: document.getElementById('custom-dates'),
    startDate: document.getElementById('start-date'),
    endDate: document.getElementById('end-date'),
    optSender: document.getElementById('opt-sender'),
    optTime: document.getElementById('opt-time'),
    optReaction: document.getElementById('opt-reaction'),
    destTabs: document.querySelectorAll('.dest-tab'),
    notebookSelect: document.getElementById('notebook-select'),
    notebookBtn: document.getElementById('notebook-btn'),
    notebookList: document.getElementById('notebook-list'),
    notebookItems: document.getElementById('notebook-items'),
    notebookSearch: document.getElementById('notebook-search'),
    selectedEmoji: document.getElementById('selected-emoji'),
    selectedTitle: document.getElementById('selected-title'),
    dropdownArrow: document.getElementById('dropdown-arrow'),
    errorMsg: document.getElementById('error-msg'),
    btnStart: document.getElementById('btn-start'),
    btnCopyOnly: document.getElementById('btn-copy-only'),
    processingSubtitle: document.getElementById('processing-subtitle'),
    processingIcon: document.getElementById('processing-icon'),
    processingTitle: document.getElementById('processing-title'),
    processingDetail: document.getElementById('processing-detail'),
    resultCard: document.getElementById('result-card'),
    resultIcon: document.getElementById('result-icon'),
    resultTitle: document.getElementById('result-title'),
    resultDetail: document.getElementById('result-detail'),
    btnCopy: document.getElementById('btn-copy'),
    btnNew: document.getElementById('btn-new'),
    btnBulkSave: document.getElementById('btn-bulk-save')
  };

  let state = {
    selectedDays: 0,
    notebooks: [],
    selectedNotebook: null,
    destMode: 'select', // 'select' or 'new'
    collectedData: null,
    dropdownOpen: false
  };

  // 初期化
  const isChatwork = await checkChatwork();
  if (!isChatwork) {
    showScreen('notChatwork');
    return;
  }

  setupDates();
  setupListeners();
  showScreen('main');
  loadNotebooks();

  async function checkChatwork() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab.url?.includes('chatwork.com') && !tab.url?.includes('kcw.kddi.ne.jp')) {
        return false;
      }
      try {
        const res = await chrome.tabs.sendMessage(tab.id, { action: 'checkChatwork' });
        return res?.isChatworkRoom;
      } catch {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
        await sleep(300);
        const res = await chrome.tabs.sendMessage(tab.id, { action: 'checkChatwork' });
        return res?.isChatworkRoom;
      }
    } catch {
      return false;
    }
  }

  function setupDates() {
    const today = formatDate(new Date());
    el.startDate.value = today;
    el.endDate.value = today;
  }

  function setupListeners() {
    // 期間ボタン
    el.periodBtns.forEach(btn => {
      btn.addEventListener('click', () => selectPeriod(parseInt(btn.dataset.days)));
    });

    // インポート先タブ
    el.destTabs.forEach(tab => {
      tab.addEventListener('click', () => selectDestMode(tab.dataset.dest));
    });

    // ノートブックドロップダウン
    el.notebookBtn.addEventListener('click', toggleDropdown);
    el.notebookSearch.addEventListener('input', filterNotebooks);

    document.addEventListener('click', (e) => {
      if (!el.notebookBtn.contains(e.target) && !el.notebookList.contains(e.target)) {
        closeDropdown();
      }
    });

    // 開始ボタン
    el.btnStart.addEventListener('click', startProcess);
    
    // コピーだけボタン
    el.btnCopyOnly.addEventListener('click', copyOnlyProcess);

    // 全ログ一括保存ボタン
    el.btnBulkSave.addEventListener('click', bulkSaveProcess);

    // 完了画面
    el.btnCopy.addEventListener('click', copyToClipboard);
    el.btnNew.addEventListener('click', () => {
      state.collectedData = null;
      showScreen('main');
    });
  }

  function selectDestMode(mode) {
    state.destMode = mode;
    el.destTabs.forEach(tab => {
      tab.classList.toggle('active', tab.dataset.dest === mode);
    });
    el.notebookSelect.classList.toggle('show', mode === 'select');
  }

  async function loadNotebooks() {
    el.notebookItems.innerHTML = '<div style="padding:20px;text-align:center;color:#999;font-size:12px">接続中...</div>';
    
    try {
      const tabResult = await chrome.runtime.sendMessage({ action: 'ensureNLMTab' });
      if (!tabResult.success) throw new Error(tabResult.error);
      
      const result = await chrome.runtime.sendMessage({ action: 'getNotebooks' });
      if (!result.success) throw new Error(result.error);
      
      state.notebooks = result.notebooks || [];
      renderNotebooks();
    } catch (error) {
      el.notebookItems.innerHTML = `<div style="padding:20px;text-align:center;color:#dc2626;font-size:12px">${error.message}</div>`;
    }
  }

  function renderNotebooks(filter = '') {
    const filtered = state.notebooks.filter(nb => 
      nb.title.toLowerCase().includes(filter.toLowerCase())
    );

    if (filtered.length === 0) {
      el.notebookItems.innerHTML = '<div style="padding:20px;text-align:center;color:#999;font-size:12px">見つかりません</div>';
      return;
    }

    el.notebookItems.innerHTML = filtered.slice(0, 50).map(nb => `
      <div class="notebook-item ${state.selectedNotebook?.id === nb.id ? 'selected' : ''}" data-id="${nb.id}">
        <span class="check">${state.selectedNotebook?.id === nb.id ? '✓' : ''}</span>
        <span class="emoji">${esc(nb.emoji)}</span>
        <span class="title">${esc(nb.title)}</span>
      </div>
    `).join('');

    el.notebookItems.querySelectorAll('.notebook-item').forEach(item => {
      item.addEventListener('click', () => selectNotebook(item.dataset.id));
    });
  }

  function selectNotebook(id) {
    const nb = state.notebooks.find(n => n.id === id);
    if (!nb) return;
    state.selectedNotebook = nb;
    el.selectedEmoji.textContent = nb.emoji || '📓';
    el.selectedTitle.textContent = nb.title;
    closeDropdown();
    renderNotebooks(el.notebookSearch.value);
  }

  function toggleDropdown() {
    state.dropdownOpen = !state.dropdownOpen;
    el.notebookList.classList.toggle('show', state.dropdownOpen);
    el.dropdownArrow.classList.toggle('open', state.dropdownOpen);
  }

  function closeDropdown() {
    state.dropdownOpen = false;
    el.notebookList.classList.remove('show');
    el.dropdownArrow.classList.remove('open');
  }

  function filterNotebooks() {
    renderNotebooks(el.notebookSearch.value);
  }

  function selectPeriod(days) {
    state.selectedDays = days;
    el.periodBtns.forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.days) === days);
    });

    if (days === -1) {
      el.customDates.classList.add('show');
      return;
    }
    el.customDates.classList.remove('show');

    const today = new Date();
    const start = new Date(today);
    const end = new Date(today);

    if (days === 1) {
      start.setDate(start.getDate() - 1);
      end.setDate(end.getDate() - 1);
    } else if (days > 1) {
      start.setDate(start.getDate() - days);
    }

    el.startDate.value = formatDate(start);
    el.endDate.value = formatDate(end);
  }

  async function startProcess() {
    // バリデーション
    if (state.destMode === 'select' && !state.selectedNotebook) {
      showError('ノートブックを選択してください');
      return;
    }

    hideError();
    showScreen('processing');

    try {
      // Step 1: チャット収集
      updateProgress('チャットを収集中...', '📥', '超高速スクロールでメッセージを取得しています');
      
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const options = {
        startDate: el.startDate.value,
        endDate: el.endDate.value,
        includeSender: el.optSender.checked,
        includeTimestamp: el.optTime.checked,
        includeReactions: el.optReaction.checked
      };

      const collectResult = await chrome.tabs.sendMessage(tab.id, { action: 'collectMessages', options });
      
      if (!collectResult.success) throw new Error(collectResult.error || '収集に失敗');
      if (collectResult.count === 0) throw new Error('指定期間にメッセージがありません');

      state.collectedData = collectResult;

      // クリップボードにバックアップ
      try { await navigator.clipboard.writeText(collectResult.formattedText); } catch {}

      // Step 2: インポート
      if (state.destMode === 'new') {
        updateProgress('ノートブックを作成中...', '✨', '新しいノートブックを作成しています');
        
        const createResult = await chrome.runtime.sendMessage({ action: 'createAndImport', 
          title: collectResult.roomName || 'Chatworkログ',
          text: collectResult.formattedText
        });

        if (createResult.success) {
          showComplete(true, `${collectResult.count}件を新規ノートブックにインポートしました`);
        } else {
          showComplete(false, `自動インポートに失敗。テキストはコピー済みです。\n${createResult.error || ''}`);
        }
      } else {
        updateProgress('インポート中...', '📤', `${state.selectedNotebook.title}に送信中`);
        
        const importResult = await chrome.runtime.sendMessage({
          action: 'importToNotebook',
          notebookId: state.selectedNotebook.id,
          title: collectResult.roomName || 'Chatworkログ',
          text: collectResult.formattedText
        });

        if (importResult.success) {
          showComplete(true, `${collectResult.count}件を「${state.selectedNotebook.title}」にインポートしました`);
        } else {
          showComplete(false, `自動インポートに失敗。テキストはコピー済みです。\n${importResult.error || ''}`);
        }
      }

    } catch (error) {
      showError(error.message);
      showScreen('main');
    }
  }

  async function copyOnlyProcess() {
    hideError();
    showScreen('processing');

    try {
      updateProgress('チャットを収集中...', '📥', 'メッセージを取得しています');
      
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const options = {
        startDate: el.startDate.value,
        endDate: el.endDate.value,
        includeSender: el.optSender.checked,
        includeTimestamp: el.optTime.checked,
        includeReactions: el.optReaction.checked
      };

      const collectResult = await chrome.tabs.sendMessage(tab.id, { action: 'collectMessages', options });
      
      if (!collectResult.success) throw new Error(collectResult.error || '収集に失敗');
      if (collectResult.count === 0) throw new Error('指定期間にメッセージがありません');

      state.collectedData = collectResult;

      // クリップボードにコピー
      await navigator.clipboard.writeText(collectResult.formattedText);
      
      showComplete(true, `${collectResult.count}件のメッセージをクリップボードにコピーしました`);

    } catch (error) {
      showError(error.message);
      showScreen('main');
    }
  }

  async function copyToClipboard() {
    if (!state.collectedData) return;
    try {
      await navigator.clipboard.writeText(state.collectedData.formattedText);
      el.btnCopy.textContent = '✓ コピー完了';
      setTimeout(() => { el.btnCopy.textContent = '📋 コピー'; }, 2000);
    } catch {}
  }

  function showScreen(name) {
    Object.values(el.screens).forEach(s => s.classList.remove('active'));
    el.screens[name]?.classList.add('active');
  }

  function updateProgress(title, icon, detail) {
    el.processingTitle.textContent = title;
    el.processingIcon.textContent = icon;
    el.processingDetail.textContent = detail;
    el.processingSubtitle.textContent = title;
  }

  function showComplete(success, detail) {
    el.resultCard.classList.toggle('error', !success);
    el.resultIcon.textContent = success ? '✅' : '⚠️';
    el.resultTitle.textContent = success ? 'インポート完了' : '手動で完了してください';
    el.resultDetail.textContent = detail;
    showScreen('complete');
  }

  function showError(msg) {
    el.errorMsg.textContent = msg;
    el.errorMsg.classList.add('show');
  }

  function hideError() {
    el.errorMsg.classList.remove('show');
  }

  function formatDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }

  function esc(s) {
    if (!s) return '';
    return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  async function bulkSaveProcess() {
    hideError();
    showScreen('processing');

    try {
      updateProgress('全ログ一括収集を開始...', '📁', 'スクロールしながら2000件ごとにファイル保存します');

      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const options = {
        startDate: el.startDate.value,
        endDate: el.endDate.value,
        includeSender: el.optSender.checked,
        includeTimestamp: el.optTime.checked,
        includeReactions: el.optReaction.checked
      };

      const result = await chrome.tabs.sendMessage(tab.id, { action: 'bulkCollectAndSave', options });

      if (!result.success) throw new Error(result.error || '収集に失敗');

      showComplete(true, `合計${result.totalCount}件を${result.fileCount}個のファイルに保存しました`);

    } catch (error) {
      showError(error.message);
      showScreen('main');
    }
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
});

document.addEventListener('DOMContentLoaded', async () => {
  const el = {
    screens: {
      notChatwork: document.getElementById('screen-not-chatwork'),
      main: document.getElementById('screen-main'),
      processing: document.getElementById('screen-processing'),
      complete: document.getElementById('screen-complete')
    },
    modeTabs: document.querySelectorAll('.mode-tab'),
    dateRow: document.getElementById('date-row'),
    startDate: document.getElementById('start-date'),
    endDate: document.getElementById('end-date'),
    optSender: document.getElementById('opt-sender'),
    optTime: document.getElementById('opt-time'),
    optReaction: document.getElementById('opt-reaction'),
    errorMsg: document.getElementById('error-msg'),
    btnStart: document.getElementById('btn-start'),
    btnCancel: document.getElementById('btn-cancel'),
    btnBack: document.getElementById('btn-back'),
    procIcon: document.getElementById('proc-icon'),
    procTitle: document.getElementById('proc-title'),
    procFill: document.getElementById('proc-fill'),
    procDetail: document.getElementById('proc-detail'),
    resultCard: document.getElementById('result-card'),
    resultIcon: document.getElementById('result-icon'),
    resultTitle: document.getElementById('result-title'),
    resultDetail: document.getElementById('result-detail')
  };

  let mode = 'all'; // 'all' or 'range'

  // Chatworkチェック
  const isChatwork = await checkChatwork();
  if (!isChatwork) {
    showScreen('notChatwork');
    return;
  }
  setupDates();
  showScreen('main');

  // モード切替
  el.modeTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      mode = tab.dataset.mode;
      el.modeTabs.forEach(t => t.classList.toggle('active', t.dataset.mode === mode));
      el.dateRow.classList.toggle('show', mode === 'range');
    });
  });

  el.btnStart.addEventListener('click', startExport);
  el.btnCancel.addEventListener('click', cancelExport);
  el.btnBack.addEventListener('click', () => showScreen('main'));

  async function checkChatwork() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab.url?.includes('chatwork.com') && !tab.url?.includes('kcw.kddi.ne.jp')) return false;
      try {
        const res = await chrome.tabs.sendMessage(tab.id, { action: 'ping' });
        return res?.ok;
      } catch {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
        await new Promise(r => setTimeout(r, 300));
        const res = await chrome.tabs.sendMessage(tab.id, { action: 'ping' });
        return res?.ok;
      }
    } catch { return false; }
  }

  function setupDates() {
    const today = new Date();
    const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    el.endDate.value = fmt(today);
    const monthAgo = new Date(today);
    monthAgo.setMonth(monthAgo.getMonth() - 1);
    el.startDate.value = fmt(monthAgo);
  }

  async function startExport() {
    hideError();
    showScreen('processing');
    updateProc('📥', '収集開始...', 'スクロールしてメッセージを取得しています', 0);

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const options = {
        mode,
        startDate: mode === 'range' ? el.startDate.value : null,
        endDate: mode === 'range' ? el.endDate.value : null,
        includeSender: el.optSender.checked,
        includeTimestamp: el.optTime.checked,
        includeReactions: el.optReaction.checked
      };

      const result = await chrome.tabs.sendMessage(tab.id, { action: 'exportLogs', options });

      if (!result.success) throw new Error(result.error || '収集に失敗しました');

      el.resultCard.className = 'result-card success';
      el.resultIcon.textContent = '✅';
      el.resultTitle.textContent = '保存完了';
      el.resultDetail.textContent = `${result.totalCount}件を${result.fileCount}個のファイルに保存しました`;
      showScreen('complete');

    } catch (error) {
      showError(error.message);
      showScreen('main');
    }
  }

  async function cancelExport() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await chrome.tabs.sendMessage(tab.id, { action: 'cancel' });
    } catch {}
    showScreen('main');
  }

  function showScreen(name) {
    Object.values(el.screens).forEach(s => s.classList.remove('active'));
    el.screens[name]?.classList.add('active');
  }

  function updateProc(icon, title, detail, pct) {
    el.procIcon.textContent = icon;
    el.procTitle.textContent = title;
    el.procDetail.textContent = detail;
    if (pct != null) el.procFill.style.width = `${pct}%`;
  }

  function showError(msg) {
    el.errorMsg.textContent = msg;
    el.errorMsg.classList.add('show');
  }
  function hideError() { el.errorMsg.classList.remove('show'); }
});

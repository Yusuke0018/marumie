/**
 * kakehashi - Side Panel v2
 * おすすめ/履歴/検索 + ピン留め・タグ・展開・右クリックメニュー・ショートカット
 */
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

const statusDot = $('#status-dot'), statusText = $('#status-text');
const contextBar = $('#context-bar'), contextInfo = $('#context-info'), keywordsArea = $('#keywords');
const searchBar = $('#search-bar'), searchInput = $('#search-input'), searchClear = $('#search-clear');
const suggestCount = $('#suggest-count'), historyCount = $('#history-count');
const tabSuggest = $('#tab-suggest'), tabHistory = $('#tab-history'), tabSearch = $('#tab-search');
const toastEl = $('#toast'), ctxMenu = $('#ctx-menu');

let activeTab = 'suggest', lastContextUrl = '', lastKeywordsHash = '';
let searchFilter = 'all', historyLoaded = false;
let suggestResults = [], searchResults = [], historyConvs = [];
let ctxConv = null;
let favSet = new Set();

function sendMsg(type, payload = {}) {
  return new Promise(r => chrome.runtime.sendMessage({ type, payload }, res => r(res || { ok: false })));
}

// Load favorites
(async () => {
  const res = await sendMsg('GET_FAVORITES');
  if (res.ok && res.favorites) res.favorites.forEach(f => favSet.add(f.conversationId));
})();

// ── Tabs ──
$$('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const name = tab.dataset.tab;
    if (name === activeTab) return;
    $$('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    $$('.tab-content').forEach(tc => tc.classList.remove('active'));
    $(`#tab-${name}`).classList.add('active');
    activeTab = name;
    contextBar.classList.toggle('visible', name === 'suggest');
    searchBar.classList.toggle('visible', name === 'search');
    if (name === 'history' && !historyLoaded) loadHistory();
    if (name === 'search') searchInput.focus();
  });
});

// ── Keyboard shortcuts ──
document.addEventListener('keydown', e => {
  if (e.key === '/' && !e.ctrlKey && !e.metaKey && document.activeElement.tagName !== 'INPUT') {
    e.preventDefault();
    $$('.tab').forEach(t => t.classList.remove('active'));
    $$('.tab-content').forEach(tc => tc.classList.remove('active'));
    $('[data-tab="search"]').classList.add('active');
    $('#tab-search').classList.add('active');
    activeTab = 'search';
    contextBar.classList.remove('visible');
    searchBar.classList.add('visible');
    searchInput.focus();
  }
  if (e.key === 'Escape') {
    ctxMenu.classList.remove('open');
    if (document.activeElement === searchInput) { searchInput.blur(); searchInput.value = ''; searchClear.classList.remove('visible'); }
  }
});

// ── おすすめ: Context polling ──
async function pollContext() {
  try {
    const res = await sendMsg('GET_CONTEXT');
    if (!res.ok || !res.context) return;
    const ctx = res.context;
    if (Date.now() - ctx.updatedAt > 60000) { statusDot.className = 'status-dot'; statusText.textContent = '待機中'; return; }
    statusDot.className = 'status-dot active';
    statusText.textContent = ctx.service || 'active';
    const kwHash = ctx.keywords.join(',');
    const urlChanged = ctx.url !== lastContextUrl;
    if (kwHash === lastKeywordsHash && !urlChanged) return;
    lastContextUrl = ctx.url; lastKeywordsHash = kwHash;

    // URL変更（ルーム切替・会話切替）を検知したら履歴も即更新
    if (urlChanged && historyLoaded) loadHistory(true);
    contextInfo.textContent = ctx.title || ctx.url;
    keywordsArea.innerHTML = ctx.keywords.map(kw => `<span class="keyword-tag">${esc(kw)}</span>`).join('');

    // 初期画面（キーワードなし）の場合はおすすめをクリア
    if (!ctx.keywords || ctx.keywords.length === 0) {
      suggestResults = []; suggestCount.textContent = '0';
      tabSuggest.innerHTML = `<div class="empty-state"><div class="empty-state-icon">🌉</div><div class="empty-state-title">${esc(ctx.service || '')} の初期画面</div><p>会話を開くと関連する過去の会話が表示されます</p></div>`;
      return;
    }

    // Chatworkの場合は「AIに相談」UIを表示
    if (ctx.service === 'chatwork') {
      await showAiConsult(ctx);
      return;
    }

    await findRelated(ctx.keywords, ctx.url, ctx.service);
  } catch (e) {}
}
setInterval(pollContext, 3000);
setTimeout(pollContext, 500);

// ── Chatwork: AIに相談 ──
let cwMsgRange = 20; // 直近何件を含めるか

async function showAiConsult(ctx) {
  suggestCount.textContent = '💬';

  // 現在のルームのメッセージを取得
  const allConvRes = await sendMsg('GET_CONVERSATIONS', { service: 'chatwork', limit: 100 });
  let roomConv = null;
  if (allConvRes.ok && allConvRes.results) {
    roomConv = allConvRes.results.find(c => c.url === ctx.url);
  }

  let messages = [];
  if (roomConv) {
    const msgRes = await sendMsg('GET_MESSAGES', { conversationId: roomConv.id });
    if (msgRes.ok && msgRes.results) messages = msgRes.results;
  }

  const recentMsgs = messages.slice(-cwMsgRange);
  const roomTitle = ctx.title || 'Chatwork';

  // プレビュー用テキスト
  const previewHtml = recentMsgs.map(m => {
    const text = m.content || '';
    // [speaker] content 形式を分解
    const match = text.match(/^\[(.+?)\]\s*([\s\S]*)$/);
    if (match) {
      return `<span class="cw-speaker">${esc(match[1])}</span>: ${esc(match[2].slice(0, 150))}`;
    }
    return esc(text.slice(0, 150));
  }).join('\n');

  // AIに渡すテキスト
  const contextText = recentMsgs.map(m => m.content || '').join('\n');

  tabSuggest.innerHTML = `
    <div class="ai-consult">
      <div class="ai-consult-header">📋 ${esc(roomTitle)} の直近メッセージ</div>
      <div class="ai-consult-range">
        <button class="range-btn ${cwMsgRange===10?'active':''}" data-range="10">直近10件</button>
        <button class="range-btn ${cwMsgRange===20?'active':''}" data-range="20">直近20件</button>
        <button class="range-btn ${cwMsgRange===50?'active':''}" data-range="50">直近50件</button>
        <button class="range-btn ${cwMsgRange===9999?'active':''}" data-range="9999">すべて</button>
      </div>
      <div class="ai-consult-preview">${previewHtml || '（メッセージなし）'}</div>
      <textarea class="ai-consult-prompt" id="ai-prompt" placeholder="AIへの指示を追加（例: この議論を要約して / 問題点を整理して）"></textarea>
      <div class="ai-consult-buttons">
        <button class="ai-btn claude" data-ai="claude">Claude</button>
        <button class="ai-btn chatgpt" data-ai="chatgpt">ChatGPT</button>
        <button class="ai-btn gemini" data-ai="gemini">Gemini</button>
      </div>
      <div class="ai-consult-count">${recentMsgs.length} / ${messages.length} メッセージ</div>
    </div>
  `;

  // 範囲切替
  tabSuggest.querySelectorAll('.range-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      cwMsgRange = parseInt(btn.dataset.range);
      showAiConsult(ctx);
    });
  });

  // AIボタン
  tabSuggest.querySelectorAll('.ai-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const ai = btn.dataset.ai;
      const userPrompt = document.getElementById('ai-prompt').value.trim();
      const fullPrompt = buildAiPrompt(roomTitle, contextText, userPrompt);
      const urls = {
        claude: 'https://claude.ai/new',
        chatgpt: 'https://chatgpt.com/',
        gemini: 'https://gemini.google.com/app'
      };

      // クリップボードにもコピー（フォールバック用）
      navigator.clipboard.writeText(fullPrompt).catch(() => {});

      // タブを開いて自動貼付
      btn.textContent = '⏳ 開いています...';
      btn.disabled = true;
      await sendMsg('OPEN_AI_AND_PASTE', { url: urls[ai], text: fullPrompt });
      showToast(`${ai} を開いて自動貼付します`);

      setTimeout(() => {
        btn.textContent = { claude: 'Claude', chatgpt: 'ChatGPT', gemini: 'Gemini' }[ai];
        btn.disabled = false;
      }, 3000);
    });
  });
}

function buildAiPrompt(roomTitle, contextText, userPrompt) {
  const lines = [];
  lines.push('以下はChatworkのルーム「' + roomTitle + '」での直近のやり取りです。');
  lines.push('');
  lines.push('---');
  lines.push(contextText);
  lines.push('---');
  lines.push('');
  if (userPrompt) {
    lines.push(userPrompt);
  } else {
    lines.push('上記のやり取りの内容を踏まえて、要点を整理してください。');
  }
  return lines.join('\n');
}

// タブ切替を検知 → コンテキストを強制リセットして即再取得
chrome.tabs.onActivated.addListener(() => {
  lastContextUrl = '';
  lastKeywordsHash = '';
  setTimeout(pollContext, 300);
});
// ウィンドウフォーカス変更時も
window.addEventListener('focus', () => {
  lastContextUrl = '';
  lastKeywordsHash = '';
  setTimeout(pollContext, 300);
});

async function findRelated(keywords, currentUrl, currentService) {
  const res = await sendMsg('FIND_RELATED', { keywords, currentUrl, currentService, limit: 30 });
  if (!res.ok || !res.results || !res.results.length) {
    suggestResults = []; suggestCount.textContent = '0';
    tabSuggest.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🔍</div><div class="empty-state-title">関連する会話が見つかりません</div><p>会話が蓄積されるとここに表示されます</p></div>';
    return;
  }
  suggestResults = res.results;
  suggestCount.textContent = String(res.results.length);
  const pinned = res.results.filter(c => favSet.has(c.conversationId));
  const others = res.results.filter(c => !favSet.has(c.conversationId));
  let html = '<div class="drag-hint">📎→チャットに直接貼付 / クリック→.txtダウンロード / 右クリック→メニュー</div>';
  if (pinned.length) { html += '<div class="section-label">📌 ピン留め</div>'; pinned.forEach(c => { html += renderCard(c, res.results.indexOf(c), 'suggest'); }); }
  html += '<div class="section-label">関連する過去の会話</div>';
  others.forEach(c => { html += renderCard(c, res.results.indexOf(c), 'suggest'); });
  tabSuggest.innerHTML = html;
  attachCardEvents(tabSuggest, suggestResults);
}

// ── 履歴 ──
let lastHistoryCount = 0;

async function loadHistory(silent = false) {
  if (!silent) {
    historyConvs = [];
    tabHistory.innerHTML = '<div class="loading"><div class="loading-spinner"></div><div>読み込み中...</div></div>';
  }
  const res = await sendMsg('GET_CONVERSATIONS', { limit: 200 });
  if (!res.ok || !res.results) {
    if (!silent) tabHistory.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📭</div><p>まだ会話がありません</p></div>';
    return;
  }
  historyLoaded = true;
  // 件数が変わっていなければスキップ（silent更新時のみ）
  if (silent && res.results.length === lastHistoryCount) return;
  lastHistoryCount = res.results.length;
  historyCount.textContent = String(res.results.length);
  historyConvs = [];
  for (const conv of res.results) {
    const msgRes = await sendMsg('GET_MESSAGES', { conversationId: conv.id });
    conv.allMessages = (msgRes.ok && msgRes.results) ? msgRes.results : [];
    conv.conversationId = conv.id;
    historyConvs.push(conv);
  }
  renderHistory();
}

function renderHistory() {
  if (!historyConvs.length) { tabHistory.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📭</div><p>まだ会話がありません</p></div>'; return; }
  const pinned = historyConvs.filter(c => favSet.has(c.id || c.conversationId));
  const others = historyConvs.filter(c => !favSet.has(c.id || c.conversationId));
  const groups = {}; const today = new Date();
  others.forEach(conv => {
    const d = new Date(conv.updatedAt), diff = Math.floor((today - d) / 86400000);
    const label = diff === 0 ? '今日' : diff === 1 ? '昨日' : diff < 7 ? `${diff}日前` : diff < 30 ? `${Math.floor(diff/7)}週間前` : d.toLocaleDateString('ja-JP', { year: 'numeric', month: 'short', day: 'numeric' });
    if (!groups[label]) groups[label] = [];
    groups[label].push(conv);
  });
  let html = '';
  if (pinned.length) { html += '<div class="section-label">📌 ピン留め</div>'; pinned.forEach(c => { html += renderCard(c, historyConvs.indexOf(c), 'history'); }); }
  for (const [label, convs] of Object.entries(groups)) {
    html += `<div class="date-group">${esc(label)}</div>`;
    convs.forEach(c => { html += renderCard(c, historyConvs.indexOf(c), 'history'); });
  }
  tabHistory.innerHTML = html;
  attachCardEvents(tabHistory, historyConvs);
}

// ── 検索 ──
let searchTO = null;
searchInput.addEventListener('input', () => {
  const q = searchInput.value.trim();
  searchClear.classList.toggle('visible', q.length > 0);
  clearTimeout(searchTO);
  if (!q) { tabSearch.innerHTML = '<div class="empty-state"><div class="empty-state-icon">⌕</div><p>キーワードを入力</p></div>'; return; }
  searchTO = setTimeout(() => executeSearch(q), 300);
});
searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') { clearTimeout(searchTO); const q = searchInput.value.trim(); if (q) executeSearch(q); } });
searchClear.addEventListener('click', () => { searchInput.value = ''; searchClear.classList.remove('visible'); searchInput.focus(); tabSearch.innerHTML = '<div class="empty-state"><div class="empty-state-icon">⌕</div><p>キーワードを入力</p></div>'; });
$$('.filter-btn').forEach(btn => { btn.addEventListener('click', () => { $$('.filter-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active'); searchFilter = btn.dataset.service; const q = searchInput.value.trim(); if (q) executeSearch(q); }); });

async function executeSearch(query) {
  tabSearch.innerHTML = '<div class="loading"><div class="loading-spinner"></div><div>検索中...</div></div>';
  const svc = searchFilter === 'all' ? null : searchFilter;
  const res = await sendMsg('SEARCH', { query, service: svc, limit: 50 });
  if (!res.ok || !res.results || !res.results.length) { tabSearch.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📭</div><p>「${esc(query)}」に一致する会話はありません</p></div>`; searchResults = []; return; }
  const convGroups = {};
  for (const msg of res.results) {
    if (!convGroups[msg.conversationId]) convGroups[msg.conversationId] = { conversationId: msg.conversationId, service: msg.service, matchedMessages: [], allMessages: [] };
    convGroups[msg.conversationId].matchedMessages.push(msg);
  }
  const allConvRes = await sendMsg('GET_CONVERSATIONS', { limit: 1000 });
  const convMap = {};
  if (allConvRes.ok && allConvRes.results) allConvRes.results.forEach(c => { convMap[c.id] = c; });
  const grouped = [];
  for (const cid of Object.keys(convGroups)) {
    const g = convGroups[cid]; const conv = convMap[cid];
    const msgRes = await sendMsg('GET_MESSAGES', { conversationId: cid });
    g.allMessages = (msgRes.ok && msgRes.results) ? msgRes.results : g.matchedMessages;
    g.title = conv ? conv.title : 'Untitled'; g.url = conv ? conv.url : ''; g.updatedAt = conv ? conv.updatedAt : 0;
    grouped.push(g);
  }
  searchResults = grouped;
  const kws = query.toLowerCase().split(/\s+/).filter(Boolean);
  let html = `<div class="section-label">${grouped.length} 件の会話がヒット</div>`;
  grouped.forEach((conv, idx) => {
    const matchMsg = conv.matchedMessages[0];
    const allMsgs = conv.allMessages || [];
    let posLabel = '';
    if (matchMsg && allMsgs.length > 0) {
      const mi = allMsgs.findIndex(m => m.timestamp === matchMsg.timestamp && m.role === matchMsg.role);
      if (mi >= 0) { const pct = Math.round((mi / allMsgs.length) * 100); posLabel = pct < 30 ? '冒頭' : pct < 70 ? '中盤' : '終盤'; }
    }
    const previewHL = highlightText(matchMsg ? matchMsg.content.slice(0, 120) : '', kws);
    const searchTitleClass = conv.service === 'chatwork' ? 'file-card-title cw-title' : 'file-card-title';
    html += `<div class="file-card" draggable="true" data-conv-index="${idx}" data-source="search" data-cid="${conv.conversationId}">
      <div class="file-card-header"><span class="file-icon">📄</span><span class="${searchTitleClass}">${esc(conv.title)}</span>
        <span class="service-badge ${conv.service}">${conv.service}</span>
        <div class="card-actions"><button class="card-btn inject-btn" title="チャットに貼付">📎</button><button class="card-btn fav-btn ${favSet.has(conv.conversationId)?'fav-active':''}" data-cid="${conv.conversationId}">★</button><button class="card-btn expand-btn">▾</button></div>
      </div>
      <div class="file-card-preview">${previewHL}</div>
      <div class="file-card-tags" data-cid="${conv.conversationId}"></div>
      <div class="file-card-meta"><span>${allMsgs.length} msgs</span><span>${conv.matchedMessages.length} hits</span>${posLabel?`<span class="match-pos">${posLabel}</span>`:''}<span>~${estimateFileSize(allMsgs)}</span></div>
      <div class="expanded-view" data-cid="${conv.conversationId}"></div>
    </div>`;
  });
  tabSearch.innerHTML = html;
  attachCardEvents(tabSearch, searchResults);
}

// ── Card rendering ──
function renderCard(conv, idx, source) {
  const msgs = conv.allMessages || [];
  const cid = conv.conversationId || conv.id;
  const isPinned = favSet.has(cid);
  const time = conv.updatedAt ? formatTime(conv.updatedAt) : '';
  const titleClass = conv.service === 'chatwork' ? 'file-card-title cw-title' : 'file-card-title';
  return `<div class="file-card ${isPinned?'pinned':''}" draggable="true" data-conv-index="${idx}" data-source="${source}" data-cid="${cid}">
    <div class="file-card-header"><span class="file-icon">📄</span><span class="${titleClass}">${esc(conv.title)}</span>
      <span class="service-badge ${conv.service}">${conv.service}</span>
      <div class="card-actions"><button class="card-btn inject-btn" title="チャットに貼付">📎</button><button class="card-btn fav-btn ${isPinned?'fav-active':''}" data-cid="${cid}">★</button><button class="card-btn expand-btn">▾</button></div>
    </div>
    <div class="file-card-preview">${getSummaryPreview(msgs)}</div>
    <div class="file-card-tags" data-cid="${cid}"></div>
    <div class="file-card-meta"><span>${msgs.length} msgs</span><span>~${estimateFileSize(msgs)}</span>${time?`<span>${time}</span>`:''}</div>
    <div class="expanded-view" data-cid="${cid}"></div>
  </div>`;
}

function getSummaryPreview(msgs) {
  if (!msgs || !msgs.length) return '';
  const u = msgs.find(m => m.role === 'user'), a = msgs.find(m => m.role === 'assistant');
  let out = '';
  if (u) out += esc(u.content.slice(0, 80));
  if (a) out += ` <span class="ai-hint">→ ${esc(a.content.slice(0, 50))}...</span>`;
  return out || esc(msgs[0].content.slice(0, 100));
}

// ── Card events ──
function attachCardEvents(container, dataArray) {
  container.querySelectorAll('.file-card').forEach(card => {
    const idx = parseInt(card.dataset.convIndex);
    const conv = dataArray[idx];
    if (!conv) return;
    const cid = conv.conversationId || conv.id;

    // ドラッグ → チャットに直接注入を試みる
    card.addEventListener('dragstart', e => {
      card.classList.add('dragging');
      injectToChat(conv);
      e.dataTransfer.setData('text/plain', generateFileContent(conv));
      e.dataTransfer.effectAllowed = 'copyMove';
    });
    card.addEventListener('dragend', () => card.classList.remove('dragging'));

    // クリック → .txtダウンロード
    card.addEventListener('click', e => {
      if (e.target.closest('.card-btn') || e.target.closest('.expand-toggle') || e.target.closest('.tag-pill')) return;
      downloadFile(conv);
    });

    // 📎ボタン → チャットに直接注入
    const injectBtn = card.querySelector('.inject-btn');
    if (injectBtn) injectBtn.addEventListener('click', async e => {
      e.stopPropagation();
      injectToChat(conv);
    });

    const favBtn = card.querySelector('.fav-btn');
    if (favBtn) favBtn.addEventListener('click', async e => {
      e.stopPropagation();
      const res = await sendMsg('TOGGLE_FAVORITE', { conversationId: cid });
      if (res.ok) {
        if (res.favorited) { favSet.add(cid); favBtn.classList.add('fav-active'); card.classList.add('pinned'); showToast('ピン留めしました'); }
        else { favSet.delete(cid); favBtn.classList.remove('fav-active'); card.classList.remove('pinned'); showToast('ピン留め解除'); }
      }
    });

    const expandBtn = card.querySelector('.expand-btn');
    const expandView = card.querySelector('.expanded-view');
    if (expandBtn && expandView) expandBtn.addEventListener('click', e => {
      e.stopPropagation();
      if (expandView.classList.contains('open')) { expandView.classList.remove('open'); expandBtn.textContent = '▾'; }
      else {
        const msgs = conv.allMessages || [];
        expandView.innerHTML = msgs.slice(0, 20).map(m => `<div class="expanded-msg"><div class="role-label ${m.role}">${m.role==='user'?'👤 ユーザー':'🤖 AI'}</div><div class="msg-text">${esc(m.content.slice(0,500))}</div></div>`).join('') + (msgs.length > 20 ? `<div class="expand-toggle">... 残り${msgs.length-20}件</div>` : '');
        expandView.classList.add('open'); expandBtn.textContent = '▴';
      }
    });

    card.addEventListener('contextmenu', e => {
      e.preventDefault(); ctxConv = conv;
      $('#ctx-pin').textContent = favSet.has(cid) ? '📌 ピン留め解除' : '📌 ピン留め';
      ctxMenu.style.left = Math.min(e.clientX, innerWidth - 170) + 'px';
      ctxMenu.style.top = Math.min(e.clientY, innerHeight - 180) + 'px';
      ctxMenu.classList.add('open');
    });
  });
  loadTagsForCards(container);
}

async function loadTagsForCards(container) {
  for (const tc of container.querySelectorAll('.file-card-tags')) {
    const cid = tc.dataset.cid; if (!cid) continue;
    const res = await sendMsg('GET_TAGS', { conversationId: cid });
    if (res.ok && res.tags && res.tags.length) tc.innerHTML = res.tags.map(t => `<span class="tag-pill">${esc(t.tag)}</span>`).join('');
  }
}

// ── Context menu ──
document.addEventListener('click', () => ctxMenu.classList.remove('open'));
$$('.ctx-menu-item').forEach(item => {
  item.addEventListener('click', async () => {
    ctxMenu.classList.remove('open'); if (!ctxConv) return;
    const cid = ctxConv.conversationId || ctxConv.id;
    switch (item.dataset.action) {
      case 'download': downloadFile(ctxConv); break;
      case 'download-date': openDateExportModal(ctxConv); break;
      case 'copy': await navigator.clipboard.writeText(generateFileContent(ctxConv)); showToast('コピーしました'); break;
      case 'pin': {
        const res = await sendMsg('TOGGLE_FAVORITE', { conversationId: cid });
        if (res.ok) { res.favorited ? favSet.add(cid) : favSet.delete(cid); showToast(res.favorited ? 'ピン留め' : '解除'); if (activeTab === 'history') renderHistory(); }
        break;
      }
      case 'tag': {
        const tag = prompt('タグを入力:');
        if (tag && tag.trim()) {
          await sendMsg('ADD_TAG', { conversationId: cid, tag: tag.trim() });
          showToast(`タグ「${tag.trim()}」追加`);
          const tc = document.querySelector(`.file-card-tags[data-cid="${cid}"]`);
          if (tc) { const r = await sendMsg('GET_TAGS', { conversationId: cid }); if (r.ok && r.tags) tc.innerHTML = r.tags.map(t => `<span class="tag-pill">${esc(t.tag)}</span>`).join(''); }
        }
        break;
      }
      case 'open': ctxConv.url ? chrome.tabs.create({ url: ctxConv.url }) : showToast('URLがありません'); break;
    }
  });
});

// ── Inject to chat (📎) ──
async function injectToChat(conv) {
  const content = generateFileContent(conv);
  const fileName = generateFileName(conv);
  try {
    const res = await sendMsg('INJECT_TO_CHAT', { content, fileName });
    if (res.ok) {
      if (res.method === 'clipboard') {
        showToast('クリップボードにコピーしました（Ctrl+Vで貼付）');
      } else {
        showToast('チャットにファイルを添付しました');
      }
    } else {
      // フォールバック: ダウンロード
      downloadFile(conv);
      showToast('添付できません。ダウンロードしました');
    }
  } catch (err) {
    downloadFile(conv);
    showToast('添付できません。ダウンロードしました');
  }
}

// ── File gen & download ──
function generateFileContent(conv, filteredMessages) {
  const msgs = filteredMessages || conv.allMessages || [];
  const l = ['='.repeat(60),'kakehashi - 関連会話コンテキスト','='.repeat(60),'','タイトル: '+(conv.title||'Untitled'),'サービス: '+(conv.service||''),'URL: '+(conv.url||''),'','-'.repeat(60),''];
  msgs.forEach(m=>{l.push(`【${m.role==='user'?'ユーザー':'AI'}】`);l.push(m.content);l.push('');});
  l.push('-'.repeat(60),'※ kakehashiが自動生成した過去の会話コンテキストです。上記を踏まえて回答してください。');
  return l.join('\n');
}
function generateFileName(conv) { return `kakehashi_${conv.service||'unknown'}_${(conv.title||'context').replace(/[/\\?%*:|"<>]/g,'').replace(/\s+/g,'_').slice(0,40)}.txt`; }
function downloadFile(conv, filteredMessages) {
  const fc = generateFileContent(conv, filteredMessages), fn = generateFileName(conv);
  // BOM付きUTF-8でどの環境でも文字化けしない
  const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
  const blob = new Blob([bom, fc], { type: 'text/plain;charset=utf-8' });
  const reader = new FileReader();
  reader.onload = () => chrome.downloads.download({ url: reader.result, filename: fn, saveAs: false }, () => showToast(fn + ' ダウンロード'));
  reader.readAsDataURL(blob);
}

// ── Utils ──
function estimateFileSize(m){if(!m)return'0 B';const t=m.reduce((s,x)=>s+(x.content||'').length,0);return t<1024?t+' B':t<1048576?Math.round(t/1024)+' KB':(t/1048576).toFixed(1)+' MB';}
function formatTime(ts){const d=new Date(ts),n=new Date(),dm=Math.floor((n-d)/60000);if(dm<1)return'今';if(dm<60)return dm+'分前';const dh=Math.floor(dm/60);if(dh<24)return dh+'時間前';const dd=Math.floor(dh/24);if(dd<7)return dd+'日前';return d.toLocaleDateString('ja-JP',{month:'short',day:'numeric'});}
function highlightText(t,kws){let s=esc(t);kws.forEach(kw=>{s=s.replace(new RegExp(`(${kw.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`,'gi'),'<mark>$1</mark>');});return s;}
function esc(s){if(!s)return'';const d=document.createElement('div');d.textContent=s;return d.innerHTML;}
function showToast(m){toastEl.textContent=m;toastEl.classList.add('show');setTimeout(()=>toastEl.classList.remove('show'),2000);}

contextBar.classList.add('visible');

// ── Theme toggle ──
const themeBtn = $('#theme-toggle');
function applyTheme(light) {
  document.documentElement.classList.toggle('light', light);
  themeBtn.textContent = light ? '🌙' : '☀';
  chrome.storage.local.set({ kakehashiTheme: light ? 'light' : 'dark' });
}
chrome.storage.local.get('kakehashiTheme', r => { if (r.kakehashiTheme === 'light') applyTheme(true); });
themeBtn.addEventListener('click', () => applyTheme(!document.documentElement.classList.contains('light')));

// ── 履歴の自動更新（10秒ごとに新しい会話がないかチェック） ──
setInterval(() => {
  if (historyLoaded) loadHistory(true);
}, 10000);

// ── ヘッダーの日付エクスポートボタン（全会話一括） ──
$('#btn-export-date').addEventListener('click', async () => {
  // 履歴がまだ読み込まれていなければ読み込む
  if (!historyLoaded) await loadHistory();

  if (!historyConvs.length) {
    showToast('エクスポートする会話がありません');
    return;
  }

  // 仮想的な全会話convを作成してモーダルを開く
  dateExportAllMode = true;
  const today = todayStr();
  dateFrom.value = today;
  dateTo.value = today;
  dateDesc.textContent = '全サービスの会話を日付でフィルタしてエクスポートします';
  dateHint.textContent = 'CW=メッセージ投稿日 / Claude・ChatGPT・Gemini=読み込み日';
  dateOverlay.classList.add('open');
});

let dateExportAllMode = false;

// ── 日付指定エクスポート ──
const dateOverlay = $('#date-modal-overlay');
const dateFrom = $('#date-from');
const dateTo = $('#date-to');
const dateDesc = $('#date-modal-desc');
const dateHint = $('#date-modal-hint');
let dateExportConv = null;

// 今日の日付をデフォルトにセット
function todayStr() { return new Date().toISOString().slice(0, 10); }

function openDateExportModal(conv) {
  dateExportConv = conv;
  const today = todayStr();
  dateFrom.value = today;
  dateTo.value = today;

  if (conv.service === 'chatwork') {
    dateDesc.textContent = `CW: メッセージの投稿日が指定範囲のものだけをエクスポートします`;
    dateHint.textContent = '※ Chatworkはメッセージの日付スタンプで判定します';
  } else {
    dateDesc.textContent = `${conv.service}: 指定日に読み込んだログのみをエクスポートします`;
    dateHint.textContent = '※ DBに記録された日時（読み込み日）で判定します';
  }

  dateOverlay.classList.add('open');
}

$('#date-cancel').addEventListener('click', () => {
  dateOverlay.classList.remove('open');
  dateExportConv = null;
  dateExportAllMode = false;
});

dateOverlay.addEventListener('click', e => {
  if (e.target === dateOverlay) {
    dateOverlay.classList.remove('open');
    dateExportConv = null;
    dateExportAllMode = false;
  }
});

$('#date-ok').addEventListener('click', () => {
  const from = dateFrom.value;
  const to = dateTo.value;
  if (!from || !to) { showToast('日付を選択してください'); return; }
  if (from > to) { showToast('開始日は終了日以前にしてください'); return; }

  function filterMessages(msgs, service) {
    return msgs.filter(m => {
      if (service === 'chatwork') {
        if (!m.messageDate) return false;
        return m.messageDate >= from && m.messageDate <= to;
      } else {
        if (!m.timestamp) return false;
        const d = new Date(m.timestamp).toISOString().slice(0, 10);
        return d >= from && d <= to;
      }
    });
  }

  if (dateExportAllMode) {
    // 全会話一括エクスポート
    let totalMsgs = 0;
    const lines = ['='.repeat(60), `kakehashi - 日付指定エクスポート (${from} 〜 ${to})`, '='.repeat(60), ''];

    for (const conv of historyConvs) {
      const filtered = filterMessages(conv.allMessages || [], conv.service);
      if (filtered.length === 0) continue;
      totalMsgs += filtered.length;
      lines.push('-'.repeat(60));
      lines.push(`タイトル: ${conv.title || 'Untitled'}`);
      lines.push(`サービス: ${conv.service || ''}`);
      lines.push(`URL: ${conv.url || ''}`);
      lines.push('-'.repeat(60));
      filtered.forEach(m => {
        lines.push(`【${m.role === 'user' ? 'ユーザー' : 'AI'}】`);
        lines.push(m.content);
        lines.push('');
      });
      lines.push('');
    }

    if (totalMsgs === 0) {
      showToast('該当するメッセージがありません');
      return;
    }

    const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
    const blob = new Blob([bom, lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const fn = `kakehashi_export_${from}_${to}.txt`;
    const reader = new FileReader();
    reader.onload = () => chrome.downloads.download({ url: reader.result, filename: fn, saveAs: false }, () => showToast(`${totalMsgs}件をエクスポート`));
    reader.readAsDataURL(blob);

    dateOverlay.classList.remove('open');
    dateExportAllMode = false;
    return;
  }

  // 単一会話エクスポート
  if (!dateExportConv) return;
  const conv = dateExportConv;
  const filtered = filterMessages(conv.allMessages || [], conv.service);

  if (filtered.length === 0) {
    showToast('該当するメッセージがありません');
    return;
  }

  downloadFile(conv, filtered);
  showToast(`${filtered.length}件のメッセージをエクスポート`);
  dateOverlay.classList.remove('open');
  dateExportConv = null;
});

console.log('[kakehashi] Side panel v2 initialized');

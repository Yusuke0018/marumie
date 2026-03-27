/**
 * Chatwork to NotebookLM - Background Script v6.1
 * 修正版: バックグラウンド動作対応 + テキスト挿入修正
 */

const NLM_URL = 'https://notebooklm.google.com/';
let nlmTabId = null;
let notebooksCache = [];

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  handleMessage(request).then(sendResponse).catch(e => {
    console.error('[BG] Error:', e);
    sendResponse({ success: false, error: e.message });
  });
  return true;
});

async function handleMessage(request) {
  switch (request.action) {
    case 'ensureNLMTab':
      return ensureNLMTab();
    case 'getNotebooks':
      return getNotebooks();
    case 'createAndImport':
      return createAndImport(request.title, request.text);
    case 'importToNotebook':
      return importToNotebook(request.notebookId, request.title, request.text);
    default:
      return { success: false, error: 'Unknown action' };
  }
}

async function ensureNLMTab() {
  try {
    const tabs = await chrome.tabs.query({ url: 'https://notebooklm.google.com/*' });
    
    if (tabs.length > 0) {
      nlmTabId = tabs[0].id;
      
      // ホームでなければホームに戻す
      if (!tabs[0].url.match(/notebooklm\.google\.com\/?(\?.*)?$/)) {
        await chrome.tabs.update(nlmTabId, { url: NLM_URL });
        await waitForTabLoad(nlmTabId);
        await sleep(500);
      }
      
      return { success: true, tabId: nlmTabId };
    }

    // 新規タブを作成（バックグラウンドで）
    const tab = await chrome.tabs.create({ url: NLM_URL, active: false });
    nlmTabId = tab.id;
    await waitForTabLoad(nlmTabId);
    await sleep(1200); // 新規タブは長めに待つ
    
    return { success: true, tabId: nlmTabId };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function getNotebooks() {
  if (!nlmTabId) {
    const r = await ensureNLMTab();
    if (!r.success) return r;
  }
  
  try {
    await chrome.tabs.get(nlmTabId);
  } catch {
    const r = await ensureNLMTab();
    if (!r.success) return r;
  }
  
  try {
    // ホームページにいることを確認
    const tab = await chrome.tabs.get(nlmTabId);
    if (!tab.url.match(/notebooklm\.google\.com\/?(\?.*)?$/)) {
      await chrome.tabs.update(nlmTabId, { url: NLM_URL });
      await waitForTabLoad(nlmTabId);
      await sleep(1500); // ホーム移動時は長めに待つ
    }
    
    // ノートブック一覧がロードされるまで少し待機
    await sleep(800);
    
    // ノートブック一覧を取得
    const results = await chrome.scripting.executeScript({
      target: { tabId: nlmTabId },
      func: scrapeNotebooks
    });
    
    if (results && results[0] && results[0].result) {
      notebooksCache = results[0].result;
      return { success: true, notebooks: notebooksCache };
    }
    
    return { success: true, notebooks: [] };
  } catch (e) {
    console.error('[BG] getNotebooks error:', e);
    return { success: false, notebooks: [], error: e.message };
  }
}

// ノートブック一覧をスクレイピング
function scrapeNotebooks() {
  const notebooks = [];
  const seen = new Set();

  // 方法1: project-button カスタム要素から取得（2025〜現行DOM）
  // .my-projects-container 内のみ取得（おすすめノートブックを除外）
  const myContainer = document.querySelector('.my-projects-container');
  const projectButtons = myContainer
    ? myContainer.querySelectorAll('project-button.project-button')
    : document.querySelectorAll('.my-projects-container project-button.project-button');
  projectButtons.forEach(btn => {
    try {
      // IDをリンクのhrefから抽出: /notebook/{UUID}
      const link = btn.querySelector('a.primary-action-button[href*="/notebook/"]');
      const hrefMatch = link?.getAttribute('href')?.match(/\/notebook\/([a-f0-9-]+)/i);
      const id = hrefMatch ? hrefMatch[1] : null;
      if (!id || seen.has(id)) return;
      seen.add(id);

      // タイトル
      const titleEl = btn.querySelector('.project-button-title');
      const title = titleEl?.textContent?.trim() || 'Untitled';

      // 絵文字（project-button-box-icon内のテキスト）
      const emojiBox = btn.querySelector('.project-button-box-icon');
      const emoji = emojiBox?.textContent?.trim() || '📓';

      notebooks.push({ id, title, emoji });
    } catch (e) {
      // skip
    }
  });

  // 方法2: mat-card内のproject-button-titleから取得（フォールバック）
  if (notebooks.length === 0) {
    const scope = document.querySelector('.my-projects-container') || document;
    const cards = scope.querySelectorAll('mat-card.project-button-card');
    cards.forEach((card, index) => {
      try {
        const link = card.querySelector('a[href*="/notebook/"]');
        const hrefMatch = link?.getAttribute('href')?.match(/\/notebook\/([a-f0-9-]+)/i);
        const id = hrefMatch ? hrefMatch[1] : `notebook-${index}`;
        if (seen.has(id)) return;
        seen.add(id);

        const titleEl = card.querySelector('.project-button-title');
        const title = titleEl?.textContent?.trim() || 'Untitled';
        const emojiBox = card.querySelector('.project-button-box-icon');
        const emoji = emojiBox?.textContent?.trim() || '📓';

        notebooks.push({ id, title, emoji });
      } catch (e) {
        // skip
      }
    });
  }

  // 方法3: レガシーDOM（旧バージョン互換）
  if (notebooks.length === 0) {
    const buttons = document.querySelectorAll('button[aria-labelledby*="project-"]');
    buttons.forEach(btn => {
      const labelledBy = btn.getAttribute('aria-labelledby') || '';
      const match = labelledBy.match(/project-([a-f0-9-]+)-title/);
      if (match) {
        const id = match[1];
        const titleEl = document.getElementById('project-' + id + '-title');
        const emojiEl = document.getElementById('project-' + id + '-emoji');
        if (titleEl) {
          notebooks.push({
            id,
            title: titleEl.textContent?.trim() || 'Untitled',
            emoji: emojiEl?.textContent?.trim() || '📓'
          });
        }
      }
    });
  }

  console.log('[CW-NLM] Found notebooks:', notebooks.length);
  return notebooks;
}

async function createAndImport(title, text) {
  if (!nlmTabId) {
    const r = await ensureNLMTab();
    if (!r.success) return r;
  }
  
  try {
    // 【修正】バックグラウンドで操作（active: false）
    // ユーザーが望む場合は active: true に変更可能
    await chrome.tabs.update(nlmTabId, { active: false });
    await sleep(300);
    
    // 自動インポートを実行
    const results = await chrome.scripting.executeScript({
      target: { tabId: nlmTabId },
      func: autoCreateAndImport,
      args: [title, text]
    });
    
    // 結果を確認
    if (results && results[0] && results[0].result) {
      return results[0].result;
    }
    
    return { success: true };
  } catch (e) {
    console.error('[BG] createAndImport error:', e);
    return { success: false, error: e.message };
  }
}

async function importToNotebook(notebookId, title, text) {
  if (!nlmTabId) {
    const r = await ensureNLMTab();
    if (!r.success) return r;
  }
  
  try {
    // バックグラウンドでノートブックページに移動
    await chrome.tabs.update(nlmTabId, { 
      url: `${NLM_URL}notebook/${notebookId}`,
      active: false
    });
    await waitForTabLoad(nlmTabId);
    await sleep(800);
    
    // ソース追加を実行
    const results = await chrome.scripting.executeScript({
      target: { tabId: nlmTabId },
      func: autoAddSource,
      args: [title, text]
    });
    
    // 結果を確認
    if (results && results[0] && results[0].result) {
      return results[0].result;
    }
    
    return { success: true };
  } catch (e) {
    console.error('[BG] importToNotebook error:', e);
    return { success: false, error: e.message };
  }
}

// 新規ノートブック作成してソース追加
function autoCreateAndImport(title, text) {
  const log = m => console.log('[CW-NLM]', m);
  
  function showProgress(message, isError = false, isSuccess = false) {
    let el = document.getElementById('cw-nlm-progress');
    if (!el) {
      el = document.createElement('div');
      el.id = 'cw-nlm-progress';
      el.style.cssText = `
        position: fixed; top: 20px; right: 20px; z-index: 999999;
        padding: 16px 24px; border-radius: 12px;
        font-family: -apple-system, BlinkMacSystemFont, sans-serif;
        font-size: 14px; color: white;
        box-shadow: 0 8px 32px rgba(0,0,0,0.25);
        display: flex; align-items: center; gap: 12px;
      `;
      document.body.appendChild(el);
    }
    
    el.style.background = isError ? '#d93025' : isSuccess ? '#34a853' : '#1a73e8';
    const icon = isError ? '❌' : isSuccess ? '✅' : '⏳';
    el.innerHTML = `<span style="font-size:24px">${icon}</span><span>${message}</span>`;
    
    if (isSuccess) setTimeout(() => el?.remove(), 3000);
    if (isError) setTimeout(() => el?.remove(), 5000);
  }
  
  function findByText(texts) {
    const els = document.querySelectorAll('button, [role="button"], [role="menuitem"], a, div[tabindex]');
    for (const t of texts) {
      for (const el of els) {
        if (el.textContent.includes(t) && isVisible(el)) return el;
      }
    }
    return null;
  }
  
  function isVisible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const s = window.getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
  }
  
  function click(el) {
    el.scrollIntoView({ behavior: 'instant', block: 'center' });
    el.focus();
    el.click();
  }
  
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
  
  /**
   * 【修正】テキストを確実に入力する関数
   * Angular Material Reactive Forms 対応版
   * クリップボードAPIを使った実際のペースト操作をシミュレート
   */
  async function setTextValue(element, value) {
    log('setTextValue called, length: ' + value.length);
    
    // 要素にフォーカス
    element.focus();
    await sleep(100);
    
    // 方法1: クリップボードAPI + ペーストイベント（最も確実）
    try {
      // クリップボードにコピー
      await navigator.clipboard.writeText(value);
      log('Text copied to clipboard');
      
      // 全選択してペースト
      element.select();
      
      // ペーストイベントを発火
      const pasteEvent = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: new DataTransfer()
      });
      pasteEvent.clipboardData.setData('text/plain', value);
      element.dispatchEvent(pasteEvent);
      
      // document.execCommandでペースト
      document.execCommand('paste');
      
      await sleep(100);
      
      // 値が入ったか確認
      if (element.value && element.value.length > 0) {
        log('Text inserted via clipboard paste');
        return true;
      }
    } catch (e) {
      log('Clipboard paste failed: ' + e.message);
    }
    
    // 方法2: execCommand insertText（Angular検知可能）
    try {
      element.focus();
      element.select();
      
      // 一度クリア
      document.execCommand('selectAll', false, null);
      document.execCommand('delete', false, null);
      
      // insertText
      const success = document.execCommand('insertText', false, value);
      if (success && element.value && element.value.length > 0) {
        log('Text inserted via execCommand insertText');
        return true;
      }
    } catch (e) {
      log('execCommand insertText failed: ' + e.message);
    }
    
    // 方法3: 1文字ずつ入力をシミュレート（最後の手段、短いテキスト向け）
    // 長いテキストの場合はスキップ
    if (value.length < 5000) {
      try {
        element.focus();
        element.value = '';
        
        // InputEventを使って入力をシミュレート
        for (let i = 0; i < value.length; i += 100) {
          const chunk = value.substring(i, Math.min(i + 100, value.length));
          element.value += chunk;
          element.dispatchEvent(new InputEvent('input', {
            bubbles: true,
            cancelable: true,
            inputType: 'insertText',
            data: chunk
          }));
        }
        
        // 最終的なchangeイベント
        element.dispatchEvent(new Event('change', { bubbles: true }));
        element.dispatchEvent(new Event('blur', { bubbles: true }));
        element.focus();
        
        if (element.value && element.value.length > 0) {
          log('Text inserted via chunk input simulation');
          return true;
        }
      } catch (e) {
        log('Chunk input failed: ' + e.message);
      }
    }
    
    // 方法4: Native Setter + Angular ngZone トリガー
    try {
      const proto = element.tagName === 'TEXTAREA' 
        ? window.HTMLTextAreaElement.prototype 
        : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      
      if (setter) {
        setter.call(element, value);
      } else {
        element.value = value;
      }
      
      // Angular が検知できるイベントを全て発火
      element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      element.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        composed: true,
        inputType: 'insertText',
        data: value
      }));
      
      // blur/focusでAngularのupdateOn: 'blur'にも対応
      element.dispatchEvent(new Event('blur', { bubbles: true }));
      await sleep(50);
      element.focus();
      
      log('Text inserted via native setter + events');
      return true;
    } catch (e) {
      log('Native setter failed: ' + e.message);
    }
    
    // 方法5: 最終フォールバック
    element.value = value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    log('Text inserted via final fallback');
    return true;
  }
  
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
  
  async function run() {
    try {
      showProgress('インポート中...');
      
      // Step 1: 新規作成
      log('Step 1: Create notebook');
      const createBtn = findByText(['新規作成', '作成', 'Create', 'New']);
      if (createBtn) {
        click(createBtn);
        await sleep(1200); // ダイアログが開くまで待つ（最小限）
      }
      
      // Step 2: 「コピーしたテキスト」を探す（ダイアログは自動で開く）
      log('Step 2: Select copied text option');
      await sleep(300);
      
      let textOption = findByText(['コピーしたテキスト', 'Copied text', 'Paste text']);
      
      if (!textOption) {
        const dialog = document.querySelector('add-sources-dialog, [class*="add-sources-dialog"], [role="dialog"]');
        if (dialog) {
          const btns = dialog.querySelectorAll('button, [role="button"], div[tabindex]');
          for (const btn of btns) {
            const text = btn.textContent.trim();
            if ((text.includes('コピー') || text.includes('テキスト') || text.includes('Copied') || text.includes('Paste')) && isVisible(btn)) {
              textOption = btn;
              break;
            }
          }
        }
      }
      
      if (!textOption) {
        let addBtn = findByText(['ソースを追加', 'Add source', 'ソースの追加', 'Add a source']);
        if (!addBtn) {
          const allBtns = document.querySelectorAll('button, [role="button"]');
          for (const btn of allBtns) {
            const text = btn.textContent.trim();
            const ariaLabel = btn.getAttribute('aria-label') || '';
            if ((text === '+' || text === '＋' || ariaLabel.includes('追加') || ariaLabel.includes('add')) && isVisible(btn)) {
              addBtn = btn;
              break;
            }
          }
        }
        if (addBtn) {
          click(addBtn);
          await sleep(500);
          textOption = findByText(['コピーしたテキスト', 'Copied text', 'Paste text', 'テキスト']);
        }
      }
      
      if (!textOption) {
        return { success: false, error: 'コピーしたテキストオプションが見つかりません' };
      }
      
      click(textOption);
      await sleep(500);
      
      // Step 3: タイトル入力
      log('Step 3: Enter title');
      const titleInput = document.querySelector('input[formcontrolname="sourceTitle"], input.mat-mdc-input-element');
      if (titleInput && isVisible(titleInput)) {
        await setTextValue(titleInput, title);
        await sleep(50);
      }
      
      // Step 4: テキスト入力
      log('Step 4: Enter text');
      const textArea = document.querySelector('textarea[formcontrolname="copiedText"]') 
                    || document.querySelector('textarea.copied-text-input-textarea')
                    || document.querySelector('textarea');
      if (!textArea) {
        return { success: false, error: 'テキストエリアが見つかりません' };
      }
      
      await setTextValue(textArea, text);
      await sleep(100);
      
      // Step 5: 挿入
      log('Step 5: Insert');
      const insertBtn = findByText(['挿入', 'Insert', '追加', 'Add']);
      if (insertBtn) {
        click(insertBtn);
        await sleep(300);
        if (isVisible(insertBtn)) {
          click(insertBtn);
        }
      }
      
      showProgress('完了！', false, true);
      log('Done!');
      
      return { success: true };
      
    } catch (e) {
      log('Error: ' + e.message);
      showProgress('エラー: ' + e.message, true);
      return { success: false, error: e.message };
    }
  }
  
  // 実行（Promiseを返す形にして結果を取得可能に）
  return run();
}

// 既存ノートブックにソース追加
function autoAddSource(title, text) {
  const log = m => console.log('[CW-NLM]', m);
  
  function showProgress(message, isError = false, isSuccess = false) {
    let el = document.getElementById('cw-nlm-progress');
    if (!el) {
      el = document.createElement('div');
      el.id = 'cw-nlm-progress';
      el.style.cssText = `
        position: fixed; top: 20px; right: 20px; z-index: 999999;
        padding: 16px 24px; border-radius: 12px;
        font-family: -apple-system, BlinkMacSystemFont, sans-serif;
        font-size: 14px; color: white;
        box-shadow: 0 8px 32px rgba(0,0,0,0.25);
        display: flex; align-items: center; gap: 12px;
      `;
      document.body.appendChild(el);
    }
    
    el.style.background = isError ? '#d93025' : isSuccess ? '#34a853' : '#1a73e8';
    const icon = isError ? '❌' : isSuccess ? '✅' : '⏳';
    el.innerHTML = `<span style="font-size:24px">${icon}</span><span>${message}</span>`;
    
    if (isSuccess) setTimeout(() => el?.remove(), 3000);
    if (isError) setTimeout(() => el?.remove(), 5000);
  }
  
  function findByText(texts) {
    const els = document.querySelectorAll('button, [role="button"], [role="menuitem"], a, div[tabindex]');
    for (const t of texts) {
      for (const el of els) {
        if (el.textContent.includes(t) && isVisible(el)) return el;
      }
    }
    return null;
  }
  
  function isVisible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const s = window.getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
  }
  
  function click(el) {
    el.scrollIntoView({ behavior: 'instant', block: 'center' });
    el.focus();
    el.click();
  }
  
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
  
  /**
   * 【修正】テキストを確実に入力する関数
   * Angular Material Reactive Forms 対応版
   */
  async function setTextValue(element, value) {
    log('setTextValue called, length: ' + value.length);
    
    element.focus();
    await sleep(100);
    
    // 方法1: クリップボードAPI + ペーストイベント
    try {
      await navigator.clipboard.writeText(value);
      log('Text copied to clipboard');
      
      element.select();
      
      const pasteEvent = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: new DataTransfer()
      });
      pasteEvent.clipboardData.setData('text/plain', value);
      element.dispatchEvent(pasteEvent);
      
      document.execCommand('paste');
      
      await sleep(100);
      
      if (element.value && element.value.length > 0) {
        log('Text inserted via clipboard paste');
        return true;
      }
    } catch (e) {
      log('Clipboard paste failed: ' + e.message);
    }
    
    // 方法2: execCommand insertText
    try {
      element.focus();
      element.select();
      document.execCommand('selectAll', false, null);
      document.execCommand('delete', false, null);
      
      const success = document.execCommand('insertText', false, value);
      if (success && element.value && element.value.length > 0) {
        log('Text inserted via execCommand insertText');
        return true;
      }
    } catch (e) {
      log('execCommand insertText failed: ' + e.message);
    }
    
    // 方法3: チャンク入力シミュレーション
    if (value.length < 5000) {
      try {
        element.focus();
        element.value = '';
        
        for (let i = 0; i < value.length; i += 100) {
          const chunk = value.substring(i, Math.min(i + 100, value.length));
          element.value += chunk;
          element.dispatchEvent(new InputEvent('input', {
            bubbles: true,
            cancelable: true,
            inputType: 'insertText',
            data: chunk
          }));
        }
        
        element.dispatchEvent(new Event('change', { bubbles: true }));
        element.dispatchEvent(new Event('blur', { bubbles: true }));
        element.focus();
        
        if (element.value && element.value.length > 0) {
          log('Text inserted via chunk input simulation');
          return true;
        }
      } catch (e) {
        log('Chunk input failed: ' + e.message);
      }
    }
    
    // 方法4: Native Setter + イベント
    try {
      const proto = element.tagName === 'TEXTAREA' 
        ? window.HTMLTextAreaElement.prototype 
        : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      
      if (setter) {
        setter.call(element, value);
      } else {
        element.value = value;
      }
      
      element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      element.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        composed: true,
        inputType: 'insertText',
        data: value
      }));
      
      element.dispatchEvent(new Event('blur', { bubbles: true }));
      await sleep(50);
      element.focus();
      
      log('Text inserted via native setter + events');
      return true;
    } catch (e) {
      log('Native setter failed: ' + e.message);
    }
    
    // 方法5: 最終フォールバック
    element.value = value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    log('Text inserted via final fallback');
    return true;
  }
  
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
  
  async function run() {
    try {
      showProgress('ソースを追加中...');
      await sleep(300);
      
      // Step 1: ソース追加ボタンを探す
      log('Step 1: Add source');
      let addBtn = findByText(['ソースを追加', 'Add source', 'ソースの追加', 'Add a source', 'ソース']);
      
      if (!addBtn) {
        const altSelectors = [
          'button[aria-label*="ソース"]',
          'button[aria-label*="source"]',
          'button[aria-label*="Add"]',
          '[class*="addSource"]',
          '[class*="add-source"]'
        ];
        for (const selector of altSelectors) {
          const el = document.querySelector(selector);
          if (el && isVisible(el)) {
            addBtn = el;
            break;
          }
        }
      }
      
      if (!addBtn) {
        const allBtns = document.querySelectorAll('button, [role="button"]');
        for (const btn of allBtns) {
          const text = btn.textContent.trim();
          const ariaLabel = btn.getAttribute('aria-label') || '';
          if ((text === '+' || text === '＋' || ariaLabel.includes('追加') || ariaLabel.includes('add')) && isVisible(btn)) {
            addBtn = btn;
            break;
          }
        }
      }
      
      if (!addBtn) {
        return { success: false, error: 'ソース追加ボタンが見つかりません' };
      }
      click(addBtn);
      await sleep(500);
      
      // Step 2: コピーしたテキストを選択
      log('Step 2: Select copied text');
      const textOption = findByText(['コピーしたテキスト', 'Copied text', 'テキスト', 'Paste']);
      if (!textOption) {
        return { success: false, error: 'テキストオプションが見つかりません' };
      }
      click(textOption);
      await sleep(500);
      
      // Step 3: タイトル入力
      log('Step 3: Enter title');
      const titleInput = document.querySelector('input[formcontrolname="sourceTitle"], input.mat-mdc-input-element');
      if (titleInput && isVisible(titleInput)) {
        await setTextValue(titleInput, title);
        await sleep(50);
      }
      
      // Step 4: テキスト入力
      log('Step 4: Enter text');
      const textArea = document.querySelector('textarea[formcontrolname="copiedText"]') 
                    || document.querySelector('textarea.copied-text-input-textarea')
                    || document.querySelector('textarea');
      if (!textArea) {
        return { success: false, error: 'テキストエリアが見つかりません' };
      }
      
      await setTextValue(textArea, text);
      await sleep(100);
      
      // Step 5: 挿入
      log('Step 5: Insert');
      const insertBtn = findByText(['挿入', 'Insert', '追加', 'Add']);
      if (insertBtn) {
        click(insertBtn);
        await sleep(300);
        if (isVisible(insertBtn)) {
          click(insertBtn);
        }
      }
      
      showProgress('完了！', false, true);
      log('Done!');
      
      return { success: true };
      
    } catch (e) {
      log('Error: ' + e.message);
      showProgress('エラー: ' + e.message, true);
      return { success: false, error: e.message };
    }
  }
  
  return run();
}

function waitForTabLoad(tabId) {
  return new Promise(resolve => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, 8000);
    
    function listener(id, info) {
      if (id === tabId && info.status === 'complete') {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        setTimeout(resolve, 200);
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

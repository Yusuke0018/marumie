/**
 * kakehashi - Content Script Helper
 *
 * 各サービスの Content Script から使う共通関数。
 * manifest.json の content_scripts.js 配列で先頭に読み込む。
 */

// ============================================================
// Send captured message to service worker
// ============================================================

function sendCapture({ service, role, content, title, url, messageDate }) {
  if (!content || content.trim().length === 0) return;

  chrome.runtime.sendMessage({
    type: 'CAPTURE_MESSAGE',
    payload: { service, role, content: content.trim(), title, url, messageDate: messageDate || '' }
  }).catch(() => {});
}

// ============================================================
// Debounce utility
// ============================================================

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

// ============================================================
// Scan guard — 同時に複数スキャンが走るのを防止
// ============================================================

let _scanRunning = false;

function guardedScan(scanFn) {
  if (_scanRunning) return;
  _scanRunning = true;
  try {
    scanFn();
  } finally {
    _scanRunning = false;
  }
}

// ============================================================
// Robust text extraction (軽量版)
// ============================================================

function getTextContent(el) {
  if (!el) return '';
  // textContent は innerText より圧倒的に軽い（レイアウト再計算不要）
  return (el.textContent || '').trim();
}

// ============================================================
// Hash for deduplication (simple djb2)
// ============================================================

function hashStr(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
  }
  return hash >>> 0;
}

// ============================================================
// Observe DOM changes with MutationObserver
// ============================================================

function observeDOM(targetSelector, callback, options = {}) {
  const config = {
    childList: true,
    subtree: true,
    ...options
  };

  let retries = 0;
  const maxRetries = 30;

  function tryObserve() {
    const target = document.querySelector(targetSelector);
    if (target) {
      // デバウンスを 2000ms に（500ms→2000ms: DOM変更が落ち着いてからスキャン）
      const observer = new MutationObserver(debounce(callback, 2000));
      observer.observe(target, config);
      console.log(`[kakehashi] Observing: ${targetSelector}`);
      return observer;
    }

    retries++;
    if (retries < maxRetries) {
      setTimeout(tryObserve, 1000);
    } else {
      console.warn(`[kakehashi] Target not found after ${maxRetries}s: ${targetSelector}`);
    }
  }

  tryObserve();
}

// ============================================================
// Get page title (conversation title)
// ============================================================

function getPageTitle() {
  return document.title || 'Untitled';
}

// ============================================================
// テキスト自動貼付: AIチャットの入力欄にテキストを挿入
// ============================================================

function _pasteToInput(text) {
  // 入力欄の候補（各サービス対応）
  const selectors = [
    '#prompt-textarea',                              // ChatGPT (ProseMirror contenteditable)
    'div.ProseMirror[contenteditable="true"]',       // ChatGPT / Claude (共通)
    '[data-testid="chat-input"] [contenteditable]',  // Claude
    '.ql-editor[contenteditable="true"]',            // Gemini (Quill.js)
    'textarea[placeholder]',                         // 汎用textarea
  ];

  function tryPaste() {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (!el) continue;

      if (el.tagName === 'TEXTAREA') {
        // textarea
        el.value = text;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.focus();
        console.log('[kakehashi] Pasted to textarea:', sel);
        return true;
      } else if (el.getAttribute('contenteditable') === 'true') {
        // contenteditable (ProseMirror / Quill / tiptap)
        el.focus();
        // テキストを段落としてセット
        el.innerHTML = text.split('\n').map(line => `<p>${line || '<br>'}</p>`).join('');
        // React/Angular の state と同期するために input イベントを発火
        el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
        console.log('[kakehashi] Pasted to contenteditable:', sel);
        return true;
      }
    }
    return false;
  }

  // ページの読み込みが完了していない場合があるのでリトライ
  if (tryPaste()) return true;

  let retries = 0;
  const maxRetries = 15; // 最大15秒
  const timer = setInterval(() => {
    retries++;
    if (tryPaste() || retries >= maxRetries) {
      clearInterval(timer);
      if (retries >= maxRetries) {
        console.log('[kakehashi] Paste failed after retries, text is in clipboard');
      }
    }
  }, 1000);

  return false;
}

// ============================================================
// タブ切替時のコンテキスト再送信
// ============================================================

// 各Content Scriptの scanAndCapture / scanWhenReady を呼ぶためのフック
// 各サービスのスクリプトが _kakehashiRescan を設定する
let _kakehashiRescan = null;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'RESEND_CONTEXT') {
    if (typeof _kakehashiRescan === 'function') _kakehashiRescan();
    sendResponse({ ok: true });
    return;
  }
  if (msg.type === 'PASTE_TEXT') {
    const { text } = msg.payload;
    _pasteToInput(text);
    sendResponse({ ok: true });
    return;
  }
});

// ============================================================
// ファイル注入: サイドパネルからの「チャットに貼付」を受信
// ============================================================

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== 'INJECT_FILE') return;
  const { content, fileName } = msg.payload;

  try {
    // 1. File オブジェクトをページのコンテキストで作成
    const file = new File([content], fileName, { type: 'text/plain' });
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);

    // 2. ファイル入力を探して注入（各サービス共通パターン）
    const fileInputs = [
      'input[type="file"]',                          // 汎用
      '#upload-files',                                // ChatGPT
      'input[accept*="text"]',                        // テキスト受付
      'button[aria-label*="ファイル"] + input',       // Gemini付近
    ];

    let injected = false;
    for (const sel of fileInputs) {
      const input = document.querySelector(sel);
      if (input && input.type === 'file') {
        input.files = dataTransfer.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        injected = true;
        console.log('[kakehashi] File injected via input:', sel);
        break;
      }
    }

    // 3. ファイル入力が見つからない場合: ドロップゾーンにdropイベント
    if (!injected) {
      const dropTargets = [
        'div#thread',                                   // ChatGPT
        '.chat-container',                              // Gemini
        'main',                                         // Claude / 汎用
        'body',                                         // 最終フォールバック
      ];

      for (const sel of dropTargets) {
        const target = document.querySelector(sel);
        if (target) {
          const dropEvent = new DragEvent('drop', {
            bubbles: true, cancelable: true, dataTransfer
          });
          target.dispatchEvent(dropEvent);
          injected = true;
          console.log('[kakehashi] File injected via drop:', sel);
          break;
        }
      }
    }

    // 4. それでもダメなら: クリップボードにコピー
    if (!injected) {
      navigator.clipboard.writeText(content).then(() => {
        console.log('[kakehashi] Fallback: copied to clipboard');
      });
    }

    sendResponse({ ok: true, method: injected ? 'file' : 'clipboard' });
  } catch (err) {
    console.error('[kakehashi] Inject failed:', err);
    // フォールバック: クリップボード
    navigator.clipboard.writeText(content).then(() => {});
    sendResponse({ ok: true, method: 'clipboard' });
  }
  return true;
});

console.log('[kakehashi] Helper loaded');

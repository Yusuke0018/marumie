/**
 * kakehashi - Chatwork Content Script
 *
 * Chatwork はハッシュベースのSPAルーティング (#!rid{roomId}) を使用。
 * セレクタは 2026-03 時点の実DOM調査に基づく。
 *
 * 注意:
 *   - 全メッセージが role:"user"（AI対話ではなく人間同士のチャット）
 *   - 発言者名を [speaker] content 形式で content に含める
 *   - styled-components (sc-*) のクラスは不安定なので使わない
 *   - data-mid, data-rid, ._message, ._speaker 等のセマンティックな属性/クラスを使用
 */

(function () {
  'use strict';

  const SERVICE = 'chatwork';
  const capturedHashes = new Set();

  // ============================================================
  // Selectors (実DOM調査済み)
  // ============================================================

  // タイムライン: メッセージ一覧のコンテナ
  const TIMELINE_SELECTOR = '#_timeLine';

  // 個別メッセージ: data-mid 属性を持つ要素 (★★★ 最も安定)
  const MESSAGE_SELECTOR = '[data-mid]';

  // ============================================================
  // Room detection
  // ============================================================

  function getCurrentRoomId() {
    const match = location.hash.match(/rid(\d+)/);
    return match ? match[1] : null;
  }

  function getRoomTitle() {
    // 優先1: タイトルコンテナ内のH2（最も正確）
    const h2 = document.querySelector('.chatRoomHeader__titleContainer h2')
            || document.querySelector('#_roomHeader h2');
    if (h2) return getTextContent(h2);

    // 優先2: タイトルコンテナ自体（アイコンIMGは textContent に含まれない）
    const titleContainer = document.querySelector('.chatRoomHeader__titleContainer');
    if (titleContainer) return getTextContent(titleContainer);

    // 優先3: ページタイトルから抽出（Chatworkはタブにルーム名を表示する）
    const pageTitle = document.title || '';
    const cleaned = pageTitle.replace(/\s*[-–—]\s*Chatwork\s*$/, '').replace(/^\(\d+\)\s*/, '').trim();
    if (cleaned) return cleaned;

    return 'Room ' + (getCurrentRoomId() || 'unknown');
  }

  // ============================================================
  // Message extraction
  // ============================================================

  function extractMessages() {
    const messages = [];
    const messageEls = document.querySelectorAll(MESSAGE_SELECTOR);

    messageEls.forEach(msgEl => {
      // 削除済みメッセージをスキップ
      if (msgEl.getAttribute('data-deleted') === '1') return;

      // 発言者名: ._speaker 内の BUTTON テキスト
      let speaker = 'unknown';
      const speakerEl = msgEl.querySelector('._speaker');
      if (speakerEl) {
        // ._speaker 内の BUTTON から名前を取得（アバターボタンではなく名前ボタン）
        const buttons = speakerEl.querySelectorAll('button');
        for (const btn of buttons) {
          const text = getTextContent(btn);
          // アバターボタンは空テキストやIMGのみなのでスキップ
          if (text && text.length > 0 && !btn.querySelector('img:only-child')) {
            speaker = text;
            break;
          }
        }
      }

      // メッセージ本文: ._speaker の次の兄弟要素群からテキストを抽出
      // sc-* クラスは不安定なので、構造的に探す
      let content = '';
      const innerContainer = msgEl.querySelector('._message') || msgEl;
      const children = innerContainer.children;

      // ._speaker, ._timeStamp 以外の div からテキストを取得
      for (const child of children) {
        if (child.classList.contains('_speaker')) continue;
        if (child.classList.contains('_timeStamp')) continue;
        // リアクション部分は除外
        if (child.querySelector('[class*="reaction"]')) {
          const clone = child.cloneNode(true);
          const reactions = clone.querySelectorAll('[class*="reaction"]');
          reactions.forEach(r => r.remove());
          const text = getTextContent(clone);
          if (text) content += text;
        } else {
          const text = getTextContent(child);
          if (text) content += text;
        }
      }

      // フォールバック: innerContainer 全体からテキスト取得
      if (!content) {
        content = getTextContent(innerContainer);
      }

      // 発言者名・タイムスタンプを除去
      if (speaker !== 'unknown' && content.startsWith(speaker)) {
        content = content.slice(speaker.length).trim();
      }

      // タイムスタンプを抽出してから除去
      let messageDate = '';
      const tsEl = (msgEl.querySelector('._message') || msgEl).querySelector('._timeStamp');
      if (tsEl) {
        messageDate = getTextContent(tsEl);
      }
      // 本文中に残ったタイムスタンプパターンも除去 (例: "3月19日 12:23")
      content = content.replace(/\d+月\d+日\s+\d+:\d+\s*$/gm, '').trim();

      if (!content || content.length < 2) return;

      const mid = msgEl.getAttribute('data-mid') || '';

      messages.push({ speaker, content, mid, messageDate, el: msgEl });
    });

    return messages;
  }

  // ============================================================
  // Keyword extraction
  // ============================================================

  const STOP_WORDS = new Set([
    'the','a','an','is','are','was','were','be','been','being',
    'have','has','had','do','does','did','will','would','could',
    'should','may','might','shall','can','need','to','of','in',
    'for','on','with','at','by','from','this','that','it','and',
    'but','or','not','no','if','then','than','too','very','just',
    'の','に','は','を','が','で','と','も','や','か','へ','から',
    'まで','より','ので','のに','けど','けれど','ます','です',
    'した','する','して','される','させ','れる','られる',
    'この','その','あの','どの','これ','それ','あれ','どれ',
    'こと','もの','ため','よう','ところ','とき','ほう','わけ',
    'ない','ある','いる','なる','できる','思う','言う',
    'って','という','ている','てい','ました','ません',
    'お疲れ様','よろしく','お願い','ありがとう','承知',
  ]);

  function extractKeywords(messages) {
    const recentTexts = messages.slice(-5).map(m => m.content).join(' ');

    const jaWords = (recentTexts.match(/[\u4E00-\u9FFF\u3400-\u4DBF]{2,}|[\u30A0-\u30FF]{2,}/g) || [])
      .filter(w => !STOP_WORDS.has(w));
    const enWords = (recentTexts.match(/[a-zA-Z]{3,}/g) || [])
      .map(w => w.toLowerCase())
      .filter(w => !STOP_WORDS.has(w));

    const freq = {};
    [...jaWords, ...enWords].forEach(w => { freq[w] = (freq[w] || 0) + 1; });

    return Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([word]) => word);
  }

  // ============================================================
  // Scan, Capture & Context Update
  // ============================================================

  function scanAndCapture() {
    const roomId = getCurrentRoomId();
    if (!roomId) return;

    const msgs = extractMessages();
    if (msgs.length === 0) return;

    const title = getRoomTitle();
    const url = location.href;

    let captured = 0;
    msgs.forEach(({ speaker, content, messageDate }) => {
      const fullContent = speaker !== 'unknown'
        ? '[' + speaker + '] ' + content
        : content;

      const h = hashStr('user:' + fullContent.slice(0, 200));
      if (capturedHashes.has(h)) return;
      capturedHashes.add(h);

      // messageDateを解析してISO日付に変換（例: "3月19日 12:23" → "2026-03-19"）
      let parsedDate = '';
      if (messageDate) {
        const match = messageDate.match(/(\d+)月(\d+)日/);
        if (match) {
          const now = new Date();
          const month = parseInt(match[1]);
          const day = parseInt(match[2]);
          let year = now.getFullYear();
          // 未来の月なら前年と判断
          if (month > now.getMonth() + 1) year--;
          parsedDate = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
        }
      }

      sendCapture({
        service: SERVICE,
        role: 'user',
        content: fullContent,
        title: '[CW] ' + title,
        url: url,
        messageDate: parsedDate
      });
      captured++;
    });

    if (captured > 0) {
      console.log('[kakehashi] Captured ' + captured + ' Chatwork messages from: ' + title);
    }

    // サイドパネル向けコンテキスト更新
    const keywords = extractKeywords(msgs);
    if (keywords.length > 0) {
      chrome.runtime.sendMessage({
        type: 'CONTEXT_UPDATE',
        payload: { url, title: '[CW] ' + title, keywords, service: SERVICE }
      }).catch(() => {});
    }
  }

  // ============================================================
  // Room change detection (ハッシュベース)
  // ============================================================

  let lastRoomId = getCurrentRoomId();

  function checkRoomChange() {
    const currentRoomId = getCurrentRoomId();
    if (currentRoomId !== lastRoomId) {
      lastRoomId = currentRoomId;
      console.log('[kakehashi] Chatwork room changed: ' + currentRoomId);
      capturedHashes.clear();
      setTimeout(scanAndCapture, 1500);
      setTimeout(scanAndCapture, 3000);
    }
  }

  // ============================================================
  // Initialize
  // ============================================================

  function init() {
    console.log('[kakehashi] Chatwork content script initialized');
    console.log('[kakehashi] Current room: ' + getCurrentRoomId());
    _kakehashiRescan = scanAndCapture;

    // 初回スキャン（Chatworkは読み込みが遅いため長め）
    setTimeout(scanAndCapture, 3000);

    // ハッシュ変更検知
    window.addEventListener('hashchange', () => {
      setTimeout(checkRoomChange, 500);
    });

    // ポーリング（ハッシュ以外の状態変化に備えて）
    setInterval(checkRoomChange, 3000);

    // DOM変更監視 — #_timeLine を優先
    observeDOM(TIMELINE_SELECTOR, () => { guardedScan(scanAndCapture); });

    // フォールバック: タイムラインが見つからない場合
    setTimeout(() => {
      const timeline = document.querySelector(TIMELINE_SELECTOR);
      if (!timeline) {
        console.log('[kakehashi] #_timeLine not found, falling back to #_mainContent');
        observeDOM('#_mainContent', () => { guardedScan(scanAndCapture); });
      }
    }, 5000);

    // 定期スキャン（60秒）
    setInterval(() => { guardedScan(scanAndCapture); }, 60000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();

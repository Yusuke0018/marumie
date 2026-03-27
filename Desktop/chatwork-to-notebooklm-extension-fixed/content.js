/**
 * Chatwork to NotebookLM - Content Script
 * 超高速スクロール版 - v4ベース + 最適化
 */

(function() {
  'use strict';

  let isCollecting = false;
  let shouldCancel = false;
  let collectedMessages = [];

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'checkChatwork') {
      const isChatworkRoom = checkIfChatworkRoom();
      sendResponse({ isChatworkRoom });
    } else if (request.action === 'collectMessages') {
      collectMessages(request.options)
        .then(result => sendResponse(result))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;
    } else if (request.action === 'cancelCollection') {
      shouldCancel = true;
      sendResponse({ success: true });
    }
    return true;
  });

  function checkIfChatworkRoom() {
    const url = window.location.href;
    const isChatworkUrl = url.includes('chatwork.com') || url.includes('kcw.kddi.ne.jp');
    const hasMessageArea = document.querySelector('#_chatContent, ._cwLTBody, [class*="timeline"], [class*="Timeline"]') !== null;
    return isChatworkUrl && hasMessageArea;
  }

  async function collectMessages(options) {
    if (isCollecting) {
      return { success: false, error: '既に収集中です' };
    }

    isCollecting = true;
    shouldCancel = false;
    collectedMessages = [];

    const { startDate, endDate, includeSender, includeTimestamp, includeReactions } = options;

    // 日付文字列("2026-03-27")をローカル日付として確実にパース
    // new Date("2026-03-27") はUTC解釈されるため、明示的にローカルで構築する
    let startDateObj = null;
    let endDateObj = null;
    if (startDate) {
      const [sy, sm, sd] = startDate.split('-').map(Number);
      startDateObj = new Date(sy, sm - 1, sd, 0, 0, 0, 0);
    }
    if (endDate) {
      const [ey, em, ed] = endDate.split('-').map(Number);
      endDateObj = new Date(ey, em - 1, ed, 23, 59, 59, 999);
    }

    console.log('[CW-NLM] 超高速収集開始:', { startDate: startDateObj, endDate: endDateObj });

    try {
      showProgressOverlay();

      const scrollContainer = findScrollContainer();
      if (!scrollContainer) {
        throw new Error('チャットのスクロールエリアが見つかりません');
      }

      // 超高速スクロールでメッセージを読み込み（必要な場合のみ）
      console.log('[CW-NLM] スクロール開始...');
      await turboScrollToDate(scrollContainer, startDateObj);
      console.log('[CW-NLM] スクロール完了');

      // スクロール後に最下部（最新）に戻してDOMの遅延レンダリングを待つ
      scrollContainer.scrollTop = scrollContainer.scrollHeight;
      await sleep(200);

      // メッセージ抽出
      updateProgressText('メッセージを抽出中...');
      const messages = extractAllMessages({ includeSender, includeTimestamp, includeReactions });
      
      // 日付フィルタリング（日付単位で比較 — タイムゾーンずれに強くする）
      let skippedCount = 0;
      for (const msg of messages) {
        const msgDate = msg.date;
        if (endDateObj && msgDate > endDateObj) {
          skippedCount++;
          if (skippedCount <= 3) {
            console.log('[CW-NLM] フィルタ除外(endDate超過):', msg.timestamp, msgDate.toISOString(), 'end:', endDateObj.toISOString());
          }
          continue;
        }
        if (startDateObj && msgDate < startDateObj) {
          continue;
        }
        collectedMessages.push(msg);
      }
      if (skippedCount > 0) {
        console.log(`[CW-NLM] endDate超過で${skippedCount}件除外`);
      }

      hideProgressOverlay();

      if (shouldCancel) {
        return { success: false, error: '収集がキャンセルされました', messages: collectedMessages };
      }

      collectedMessages.sort((a, b) => a.date - b.date);
      const formattedText = formatMessages(collectedMessages, options);
      const roomName = getRoomName();

      console.log(`[CW-NLM] 収集完了: ${collectedMessages.length}件`);

      return {
        success: true,
        messages: collectedMessages,
        formattedText,
        count: collectedMessages.length,
        roomName
      };

    } catch (error) {
      console.error('[CW-NLM] エラー:', error);
      hideProgressOverlay();
      return { success: false, error: error.message };
    } finally {
      isCollecting = false;
    }
  }

  /**
   * スマートスクロール - 必要な場合のみスクロール
   */
  async function turboScrollToDate(container, targetDate) {
    // まず現在の状態をチェック - 既に目標日付に到達していればスクロール不要
    if (targetDate) {
      const oldestDate = getOldestVisibleDate();
      if (oldestDate && oldestDate <= targetDate) {
        console.log('[CW-NLM] 既に目標日付が表示されています。スクロール不要');
        return;
      }
    }

    let lastScrollTop = -1;
    let sameCount = 0;
    const TIMEOUT_MS = 5 * 60 * 1000; // 5分タイムアウト
    const BASE_DELAY = 20;
    const LOAD_WAIT = 400;
    let consecutiveZero = 0;
    let scrollCount = 0;
    const startTime = Date.now();

    while (!shouldCancel) {
      scrollCount++;
      const elapsed = Date.now() - startTime;

      // タイムアウト
      if (elapsed > TIMEOUT_MS) {
        console.log(`[CW-NLM] タイムアウト(5分) ${scrollCount}回, 経過${Math.round(elapsed/1000)}秒`);
        break;
      }

      // 進捗更新と日付チェック（10回に1回）
      if (scrollCount % 10 === 0) {
        const count = document.querySelectorAll('[data-mid], ._message').length;
        const sec = Math.round(elapsed / 1000);
        updateProgress(count, scrollCount, sec);

        if (targetDate) {
          const oldestDate = getOldestVisibleDate();
          if (oldestDate && oldestDate <= targetDate) {
            console.log(`[CW-NLM] 目標日付に到達 (${scrollCount}回, ${sec}秒, ${count}件)`);
            break;
          }
        }

        // 500回ごとに経過ログ
        if (scrollCount % 500 === 0) {
          const oldest = getOldestVisibleDate();
          console.log(`[CW-NLM] スクロール中... ${scrollCount}回, ${sec}秒, ${count}件, 最古: ${oldest?.toLocaleDateString('ja-JP') || '不明'}`);
        }
      }

      // スクロール位置チェック
      const currentScrollTop = container.scrollTop;
      if (currentScrollTop === lastScrollTop) {
        sameCount++;
        if (currentScrollTop === 0) consecutiveZero++;

        // Chatworkがロード中 → 長めに待つ
        if (sameCount >= 3 && sameCount <= 15) {
          await sleep(LOAD_WAIT);
          continue;
        }
        // それでも動かない
        if (sameCount > 15) {
          if (consecutiveZero > 10) {
            console.log(`[CW-NLM] チャット先頭に到達 (${scrollCount}回, ${Math.round(elapsed/1000)}秒)`);
          } else {
            console.log(`[CW-NLM] スクロール上限に到達 (${scrollCount}回)`);
          }
          break;
        }
      } else {
        sameCount = 0;
        consecutiveZero = 0;
        lastScrollTop = currentScrollTop;
      }

      // 高速スクロール
      container.scrollTop = Math.max(0, container.scrollTop - container.clientHeight * 3);

      await sleep(BASE_DELAY);
    }

    // 最終安定化待機
    await sleep(100);
  }

  /**
   * 最も古い表示日付を取得（日付ヘッダーとメッセージ両方をチェック）
   */
  function getOldestVisibleDate() {
    // 方法1: 日付ヘッダーから取得
    const dateHeaders = document.querySelectorAll('[class*="dateHeader"], ._dateHeader, [class*="DateHeader"], [class*="timeLine__date"]');
    if (dateHeaders.length > 0) {
      const firstHeader = dateHeaders[0];
      const date = parseJapaneseDate(firstHeader.textContent.trim());
      if (date) return date;
    }
    
    // 方法2: 最初のメッセージのタイムスタンプから取得
    const messages = document.querySelectorAll('[data-mid], ._message');
    if (messages.length > 0) {
      const firstMsg = messages[0];
      const timeEl = firstMsg.querySelector('._timeStamp, [class*="timeStamp"], time, [datetime]');
      if (timeEl) {
        const datetime = timeEl.getAttribute('datetime');
        if (datetime) return new Date(datetime);
        return parseJapaneseDate(timeEl.textContent.trim());
      }
    }
    
    return null;
  }

  function findScrollContainer() {
    const selectors = [
      '#_chatContent',
      '._cwLTBody',
      '[class*="timelineBody"]',
      '[class*="TimelineBody"]',
      '#_mainContent',
      '.chatRoomBody'
    ];

    for (const selector of selectors) {
      const elements = document.querySelectorAll(selector);
      for (const el of elements) {
        if (isScrollable(el)) return el;
      }
    }

    // フォールバック: メッセージ要素の祖先からスクロール可能な要素を探す
    const anyMsg = document.querySelector('[data-mid], ._message, [class*="message"]');
    if (anyMsg) {
      let ancestor = anyMsg.parentElement;
      while (ancestor && ancestor !== document.body) {
        if (ancestor.scrollHeight > ancestor.clientHeight + 50) {
          const style = window.getComputedStyle(ancestor);
          if (style.overflowY === 'auto' || style.overflowY === 'scroll' || style.overflowY === 'hidden') {
            return ancestor;
          }
        }
        ancestor = ancestor.parentElement;
      }
    }

    return null;
  }

  function isScrollable(el) {
    const style = window.getComputedStyle(el);
    const overflowY = style.overflowY;
    return (overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight;
  }

  function containsMessages(el) {
    return el.querySelector('[data-mid], ._message, [class*="message"]') !== null;
  }

  function extractAllMessages(options) {
    const messages = [];
    const seen = new Set();

    // タイムライン内の全要素（日付ヘッダー + メッセージ）をDOM順に取得
    const timeline = document.querySelector('#_timeLine, #_chatContent, ._cwLTBody, [class*="timelineBody"], [class*="TimelineBody"]') || document;
    const allNodes = timeline.querySelectorAll(
      '[data-mid], ._message, [class*="timelineMessage"], [class*="TimelineMessage"], [class*="chatTimeLineMessage"], [class*="dateHeader"], ._dateHeader, [class*="DateHeader"], [class*="timeLine__date"]'
    );

    console.log(`[CW-NLM] タイムライン内の要素数: ${allNodes.length}`);

    // DOM順に走査し、日付ヘッダーから現在の日付を追跡する
    let currentDate = new Date(); // デフォルトは今日
    let skippedEmpty = 0;
    let skippedDupe = 0;

    for (const el of allNodes) {
      // 日付ヘッダーかチェック
      const isDateHeader = el.matches('[class*="dateHeader"], ._dateHeader, [class*="DateHeader"], [class*="timeLine__date"]');
      if (isDateHeader) {
        const parsed = parseJapaneseDate(el.textContent.trim());
        if (parsed) {
          currentDate = parsed;
          console.log(`[CW-NLM] 日付ヘッダー検出: "${el.textContent.trim()}" → ${currentDate.toLocaleDateString('ja-JP')}`);
        }
        continue;
      }

      // メッセージ要素
      try {
        const mid = el.getAttribute('data-mid') || el.id;
        if (mid && seen.has(mid)) { skippedDupe++; continue; }
        if (mid) seen.add(mid);

        const message = parseMessageElement(el, options, currentDate);
        if (message && message.content && message.content.trim()) {
          messages.push(message);
        } else {
          skippedEmpty++;
        }
      } catch (e) {
        // skip
      }
    }

    console.log(`[CW-NLM] 抽出結果: ${messages.length}件 (重複スキップ: ${skippedDupe}, 空スキップ: ${skippedEmpty})`);

    return messages;
  }

  function parseMessageElement(el, options, currentDate) {
    const id = el.getAttribute('data-mid') || el.id || null;

    let sender = '';
    if (options.includeSender) {
      const senderSelectors = ['._userName', '[class*="userName"]', '[class*="senderName"]', '._cwBBMsgUser'];
      for (const selector of senderSelectors) {
        const senderEl = el.querySelector(selector);
        if (senderEl) {
          sender = senderEl.textContent.trim();
          break;
        }
      }
    }

    let timestamp = '';
    let date = currentDate ? new Date(currentDate) : new Date();

    const timeSelectors = ['._timeStamp', '[class*="timeStamp"]', '[class*="timestamp"]', 'time', '[datetime]'];
    let timeEl = null;
    for (const selector of timeSelectors) {
      timeEl = el.querySelector(selector);
      if (timeEl) break;
    }
    // el内に見つからなければ親メッセージ要素から探す（1回だけ）
    if (!timeEl) {
      const parent = el.closest('[class*="message"]');
      if (parent && parent !== el) {
        for (const selector of timeSelectors) {
          timeEl = parent.querySelector(selector);
          if (timeEl) break;
        }
      }
    }
    if (timeEl) {
      timestamp = timeEl.textContent.trim();
      const datetime = timeEl.getAttribute('datetime');
      if (datetime) {
        const parsed = new Date(datetime);
        date = isNaN(parsed.getTime()) ? parseJapaneseDate(timestamp, currentDate) : parsed;
      } else {
        date = parseJapaneseDate(timestamp, currentDate);
      }
    }

    let content = '';
    const contentSelectors = ['._messageText', '[class*="messageText"]', '[class*="messageBody"]', 'pre', '._cwBBMsgBody'];
    for (const selector of contentSelectors) {
      const contentEl = el.querySelector(selector);
      if (contentEl) {
        content = contentEl.textContent.trim();
        break;
      }
    }

    if (!content) {
      content = el.textContent.trim();
      if (sender) content = content.replace(sender, '').trim();
      if (timestamp) content = content.replace(timestamp, '').trim();
    }

    let reactions = [];
    if (options.includeReactions) {
      const reactionEls = el.querySelectorAll('[class*="reaction"]');
      reactionEls.forEach(r => reactions.push(r.textContent.trim()));
    }

    return { id, sender, timestamp, date, content, reactions };
  }

  function parseJapaneseDate(dateStr, baseDate) {
    const now = new Date();
    // baseDateが指定されていればその日付をベースに使う（日付ヘッダーからの情報）
    const base = baseDate || now;
    if (!dateStr) return new Date(base);

    if (dateStr.includes('今日')) {
      const timeMatch = dateStr.match(/(\d{1,2}):(\d{2})/);
      if (timeMatch) {
        return new Date(now.getFullYear(), now.getMonth(), now.getDate(),
          parseInt(timeMatch[1]), parseInt(timeMatch[2]));
      }
      return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    }

    if (dateStr.includes('昨日')) {
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      const timeMatch = dateStr.match(/(\d{1,2}):(\d{2})/);
      if (timeMatch) {
        return new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(),
          parseInt(timeMatch[1]), parseInt(timeMatch[2]));
      }
      return yesterday;
    }

    // 「2024年12月17日」形式
    let match = dateStr.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
    if (match) {
      const timeMatch = dateStr.match(/(\d{1,2}):(\d{2})/);
      if (timeMatch) {
        return new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]),
          parseInt(timeMatch[1]), parseInt(timeMatch[2]));
      }
      return new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
    }

    // 「12/15 10:30」形式
    match = dateStr.match(/(\d{1,2})\/(\d{1,2})\s*(\d{1,2}):(\d{2})/);
    if (match) {
      let year = now.getFullYear();
      const month = parseInt(match[1]) - 1;
      const day = parseInt(match[2]);
      const testDate = new Date(year, month, day);
      if (testDate > now) year--;
      return new Date(year, month, day, parseInt(match[3]), parseInt(match[4]));
    }

    // 「12月15日」「3月27日」形式
    match = dateStr.match(/(\d{1,2})月(\d{1,2})日/);
    if (match) {
      let year = now.getFullYear();
      const month = parseInt(match[1]) - 1;
      const day = parseInt(match[2]);
      const testDate = new Date(year, month, day);
      if (testDate > now) year--;
      const timeMatch = dateStr.match(/(\d{1,2}):(\d{2})/);
      if (timeMatch) {
        return new Date(year, month, day, parseInt(timeMatch[1]), parseInt(timeMatch[2]));
      }
      return new Date(year, month, day);
    }

    // 時刻のみ（例: "9:30", "13:25"）→ baseDateの日付 + この時刻
    const timeOnlyMatch = dateStr.match(/(\d{1,2}):(\d{2})/);
    if (timeOnlyMatch) {
      return new Date(base.getFullYear(), base.getMonth(), base.getDate(),
        parseInt(timeOnlyMatch[1]), parseInt(timeOnlyMatch[2]));
    }

    return new Date(base);
  }

  function formatMessages(messages, options) {
    const lines = [];
    
    const roomName = getRoomName();
    lines.push(`# Chatwork チャットログ`);
    if (roomName) lines.push(`## ルーム: ${roomName}`);
    lines.push(`収集日時: ${new Date().toLocaleString('ja-JP')}`);
    lines.push(`メッセージ数: ${messages.length}件`);
    if (options.startDate) lines.push(`期間: ${options.startDate} 〜 ${options.endDate}`);
    lines.push('');
    lines.push('---');
    lines.push('');

    messages.forEach(msg => {
      let line = '';
      if (options.includeTimestamp && msg.timestamp) line += `[${msg.timestamp}] `;
      if (options.includeSender && msg.sender) line += `**${msg.sender}**: `;
      line += msg.content;
      if (options.includeReactions && msg.reactions?.length > 0) {
        line += ` (${msg.reactions.join(', ')})`;
      }
      lines.push(line);
      lines.push('');
    });

    return lines.join('\n');
  }

  function getRoomName() {
    const selectors = ['#_roomTitle', '._roomTitle', '[class*="roomTitle"]', '._cwRMTitle'];
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el) return el.textContent.trim();
    }
    return 'Chatwork';
  }

  function showProgressOverlay() {
    hideProgressOverlay();

    const overlay = document.createElement('div');
    overlay.id = 'cw-nlm-overlay';
    overlay.innerHTML = `
      <div style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);z-index:999999;display:flex;align-items:center;justify-content:center;">
        <div style="background:#fff;border-radius:12px;padding:24px;max-width:400px;width:90%;text-align:center;box-shadow:0 4px 20px rgba(0,0,0,0.15);">
          <h3 style="font-size:18px;color:#333;margin:0 0 16px;">📚 超高速収集中...</h3>
          <p id="cw-nlm-progress-text" style="font-size:14px;color:#666;margin:0 0 12px;">準備中...</p>
          <div style="height:8px;background:#e0e0e0;border-radius:4px;overflow:hidden;margin-bottom:12px;">
            <div id="cw-nlm-progress-fill" style="height:100%;background:linear-gradient(90deg,#a8d5ba,#b8d4e8);border-radius:4px;width:0%;transition:width 0.2s;"></div>
          </div>
          <p id="cw-nlm-stats" style="font-size:13px;color:#888;margin:0 0 16px;">スクロール中...</p>
          <button id="cw-nlm-cancel-btn" style="padding:8px 24px;font-size:14px;background:#f5f5f5;border:1px solid #ddd;border-radius:6px;cursor:pointer;">キャンセル</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    document.getElementById('cw-nlm-cancel-btn').addEventListener('click', () => {
      shouldCancel = true;
    });
  }

  function updateProgress(messageCount, scrollAttempts, elapsedSec) {
    const progressText = document.getElementById('cw-nlm-progress-text');
    const progressFill = document.getElementById('cw-nlm-progress-fill');
    const stats = document.getElementById('cw-nlm-stats');

    if (progressText) progressText.textContent = `${messageCount}件のメッセージを検出`;
    if (progressFill) {
      const percent = Math.min(Math.log(messageCount + 1) * 20, 95);
      progressFill.style.width = `${percent}%`;
    }
    if (stats) {
      const timeStr = elapsedSec != null ? ` (${elapsedSec}秒)` : '';
      stats.textContent = `スクロール: ${scrollAttempts}回${timeStr}`;
    }
  }

  function updateProgressText(text) {
    const progressText = document.getElementById('cw-nlm-progress-text');
    if (progressText) progressText.textContent = text;
  }

  function hideProgressOverlay() {
    const overlay = document.getElementById('cw-nlm-overlay');
    if (overlay) overlay.remove();
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

})();

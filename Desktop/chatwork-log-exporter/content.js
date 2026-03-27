/**
 * Chatwork Log Exporter - Content Script
 * スクロール → メッセージ蓄積 → テキストファイル保存
 */
(function() {
  'use strict';

  let isRunning = false;
  let shouldCancel = false;

  chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
    if (req.action === 'ping') {
      const ok = checkChatworkRoom();
      sendResponse({ ok });
    } else if (req.action === 'exportLogs') {
      exportLogs(req.options)
        .then(r => sendResponse(r))
        .catch(e => sendResponse({ success: false, error: e.message }));
      return true;
    } else if (req.action === 'cancel') {
      shouldCancel = true;
      sendResponse({ ok: true });
    }
    return true;
  });

  function checkChatworkRoom() {
    const url = window.location.href;
    const isCW = url.includes('chatwork.com') || url.includes('kcw.kddi.ne.jp');
    const hasMsg = document.querySelector('#_chatContent, ._cwLTBody, [class*="timeline"], [class*="Timeline"]') !== null;
    return isCW && hasMsg;
  }

  // ============================
  // メインエクスポート処理
  // ============================
  async function exportLogs(options) {
    if (isRunning) return { success: false, error: '既に実行中です' };
    isRunning = true;
    shouldCancel = false;

    const { mode, startDate, endDate, includeSender, includeTimestamp, includeReactions } = options;
    let startDateObj = null;
    let endDateObj = null;
    if (startDate) {
      const [y, m, d] = startDate.split('-').map(Number);
      startDateObj = new Date(y, m - 1, d, 0, 0, 0, 0);
    }
    if (endDate) {
      const [y, m, d] = endDate.split('-').map(Number);
      endDateObj = new Date(y, m - 1, d, 23, 59, 59, 999);
    }

    const BATCH_SIZE = 2000;
    const roomName = getRoomName();
    let totalSaved = 0;
    let fileCount = 0;
    let collected = [];    // メモリに蓄積
    let seenKeys = new Set(); // 重複防止

    console.log('[LogExporter] 開始:', { mode, startDate, endDate });

    try {
      showOverlay();

      const container = findScrollContainer();
      if (!container) throw new Error('チャットのスクロールエリアが見つかりません');

      // === スクロールしながらメッセージを蓄積 ===
      let lastScrollTop = -1;
      let sameCount = 0;
      let consecutiveZero = 0;
      let scrollCount = 0;
      const TIMEOUT_MS = 30 * 60 * 1000; // 30分
      const startTime = Date.now();

      while (!shouldCancel) {
        scrollCount++;
        const elapsed = Date.now() - startTime;

        if (elapsed > TIMEOUT_MS) {
          console.log(`[LogExporter] タイムアウト(30分)`);
          break;
        }

        // 10回に1回: 進捗表示
        if (scrollCount % 10 === 0) {
          const sec = Math.round(elapsed / 1000);
          const min = Math.floor(sec / 60);
          const secRem = sec % 60;
          const total = collected.length + totalSaved;
          updateOverlayText(`スクロール中... 取得:${total}件 (${min}分${secRem}秒)`);
          updateOverlayBar(Math.min(Math.log(total + 1) * 15, 90));

          if (scrollCount % 500 === 0) {
            const oldest = getOldestVisibleDate();
            console.log(`[LogExporter] ${scrollCount}回, ${sec}秒, 蓄積:${collected.length}件, 保存済:${totalSaved}件, 最古: ${oldest?.toLocaleDateString('ja-JP') || '不明'}`);
          }
        }

        // 100回に1回: DOMからメッセージを吸い上げ
        if (scrollCount % 100 === 0) {
          const newMsgs = harvestMessages({ includeSender, includeTimestamp, includeReactions }, seenKeys, startDateObj, endDateObj);
          if (newMsgs.length > 0) {
            collected.push(...newMsgs);
            console.log(`[LogExporter] +${newMsgs.length}件 (蓄積:${collected.length}件)`);
          }

          // 2000件溜まったらファイル保存
          if (collected.length >= BATCH_SIZE) {
            collected.sort((a, b) => a.date - b.date);
            const batch = collected.splice(0, BATCH_SIZE);
            fileCount++;
            downloadFile(formatMessages(batch, options, roomName), roomName, fileCount);
            totalSaved += batch.length;
            console.log(`[LogExporter] ファイル${fileCount}: ${batch.length}件 (累計${totalSaved}件)`);
            updateOverlayText(`ファイル${fileCount}保存！ 累計${totalSaved}件`);
          }
        }

        // 期間指定モード: 目標日付到達チェック（10回に1回）
        if (mode === 'range' && startDateObj && scrollCount % 10 === 0) {
          const oldest = getOldestVisibleDate();
          if (oldest && oldest <= startDateObj) {
            console.log(`[LogExporter] 目標日付に到達`);
            break;
          }
        }

        // スクロール停止判定（turboScrollと同一ロジック）
        const currentScrollTop = container.scrollTop;
        if (currentScrollTop === lastScrollTop) {
          sameCount++;
          if (currentScrollTop === 0) consecutiveZero++;

          if (sameCount >= 3) {
            const wait = sameCount < 10 ? 500 : sameCount < 20 ? 1000 : 2000;
            await sleep(wait);

            if (consecutiveZero > 30) {
              console.log(`[LogExporter] チャット先頭に到達`);
              break;
            }
            if (sameCount > 60) {
              console.log(`[LogExporter] ロード停止を検出`);
              break;
            }
            continue;
          }
        } else {
          sameCount = 0;
          consecutiveZero = 0;
          lastScrollTop = currentScrollTop;
        }

        container.scrollTop = Math.max(0, container.scrollTop - container.clientHeight * 3);
        await sleep(20);
      }

      // 最終吸い上げ
      await sleep(300);
      const lastMsgs = harvestMessages({ includeSender, includeTimestamp, includeReactions }, seenKeys, startDateObj, endDateObj);
      collected.push(...lastMsgs);

      // 残りを保存（2000件ずつ）
      if (collected.length > 0) {
        collected.sort((a, b) => a.date - b.date);
        for (let i = 0; i < collected.length; i += BATCH_SIZE) {
          const chunk = collected.slice(i, i + BATCH_SIZE);
          fileCount++;
          downloadFile(formatMessages(chunk, options, roomName), roomName, fileCount);
          totalSaved += chunk.length;
          console.log(`[LogExporter] ファイル${fileCount}: ${chunk.length}件 (累計${totalSaved}件)`);
        }
      }

      hideOverlay();
      console.log(`[LogExporter] 完了: ${totalSaved}件, ${fileCount}ファイル`);

      return { success: true, totalCount: totalSaved, fileCount, roomName };

    } catch (error) {
      console.error('[LogExporter] エラー:', error);
      hideOverlay();
      return { success: false, error: error.message };
    } finally {
      isRunning = false;
    }
  }

  // ============================
  // メッセージ吸い上げ（重複排除付き）
  // ============================
  function harvestMessages(opts, seenKeys, startDateObj, endDateObj) {
    const results = [];
    const timeline = document.querySelector('#_timeLine, #_chatContent, ._cwLTBody, [class*="timelineBody"], [class*="TimelineBody"]') || document;
    const allNodes = timeline.querySelectorAll(
      '[data-mid], ._message, [class*="timelineMessage"], [class*="TimelineMessage"], [class*="chatTimeLineMessage"], [class*="dateHeader"], ._dateHeader, [class*="DateHeader"], [class*="timeLine__date"]'
    );

    let currentDate = new Date();

    for (const el of allNodes) {
      // 日付ヘッダー
      if (el.matches('[class*="dateHeader"], ._dateHeader, [class*="DateHeader"], [class*="timeLine__date"]')) {
        const parsed = parseJapaneseDate(el.textContent.trim());
        if (parsed) currentDate = parsed;
        continue;
      }

      try {
        const msg = parseMessage(el, opts, currentDate);
        if (!msg || !msg.content?.trim()) continue;

        // 重複チェック（ID優先、なければ内容ベース）
        const key = msg.id || `${msg.sender}|${msg.timestamp}|${msg.content.slice(0, 80)}`;
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);

        // 日付フィルタ
        if (endDateObj && msg.date > endDateObj) continue;
        if (startDateObj && msg.date < startDateObj) continue;

        results.push(msg);
      } catch {}
    }
    return results;
  }

  function parseMessage(el, opts, currentDate) {
    const id = el.getAttribute('data-mid') || el.id || null;

    let sender = '';
    if (opts.includeSender) {
      for (const sel of ['._userName', '[class*="userName"]', '[class*="senderName"]', '._cwBBMsgUser']) {
        const s = el.querySelector(sel);
        if (s) { sender = s.textContent.trim(); break; }
      }
    }

    let timestamp = '';
    let date = currentDate ? new Date(currentDate) : new Date();
    let timeEl = null;
    for (const sel of ['._timeStamp', '[class*="timeStamp"]', '[class*="timestamp"]', 'time', '[datetime]']) {
      timeEl = el.querySelector(sel);
      if (timeEl) break;
    }
    if (!timeEl) {
      const parent = el.closest('[class*="message"]');
      if (parent && parent !== el) {
        for (const sel of ['._timeStamp', '[class*="timeStamp"]', 'time', '[datetime]']) {
          timeEl = parent.querySelector(sel);
          if (timeEl) break;
        }
      }
    }
    if (timeEl) {
      timestamp = timeEl.textContent.trim();
      const dt = timeEl.getAttribute('datetime');
      if (dt) {
        const parsed = new Date(dt);
        date = isNaN(parsed.getTime()) ? parseJapaneseDate(timestamp, currentDate) : parsed;
      } else {
        date = parseJapaneseDate(timestamp, currentDate);
      }
    }

    let content = '';
    for (const sel of ['._messageText', '[class*="messageText"]', '[class*="messageBody"]', 'pre', '._cwBBMsgBody']) {
      const c = el.querySelector(sel);
      if (c) { content = c.textContent.trim(); break; }
    }
    if (!content) {
      content = el.textContent.trim();
      if (sender) content = content.replace(sender, '').trim();
      if (timestamp) content = content.replace(timestamp, '').trim();
    }

    let reactions = [];
    if (opts.includeReactions) {
      el.querySelectorAll('[class*="reaction"]').forEach(r => reactions.push(r.textContent.trim()));
    }

    return { id, sender, timestamp, date, content, reactions };
  }

  // ============================
  // フォーマット＆ダウンロード
  // ============================
  function formatMessages(messages, options, roomName) {
    const lines = [];
    lines.push('# Chatwork チャットログ');
    if (roomName) lines.push(`## ルーム: ${roomName}`);
    lines.push(`収集日時: ${new Date().toLocaleString('ja-JP')}`);
    lines.push(`メッセージ数: ${messages.length}件`);
    if (options.startDate) lines.push(`期間: ${options.startDate} 〜 ${options.endDate}`);
    lines.push('', '---', '');

    for (const msg of messages) {
      let line = '';
      if (options.includeTimestamp && msg.timestamp) line += `[${msg.timestamp}] `;
      if (options.includeSender && msg.sender) line += `**${msg.sender}**: `;
      line += msg.content;
      if (options.includeReactions && msg.reactions?.length > 0) {
        line += ` (${msg.reactions.join(', ')})`;
      }
      lines.push(line, '');
    }
    return lines.join('\n');
  }

  function downloadFile(text, roomName, fileNum) {
    const safeName = (roomName || 'chatwork').replace(/[\/\\:*?"<>|]/g, '_');
    const date = new Date().toISOString().slice(0, 10);
    const filename = `${safeName}_${date}_part${String(fileNum).padStart(3, '0')}.txt`;

    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ============================
  // ユーティリティ
  // ============================
  function getRoomName() {
    for (const sel of ['#_roomTitle', '._roomTitle', '[class*="roomTitle"]', '._cwRMTitle']) {
      const el = document.querySelector(sel);
      if (el) return el.textContent.trim();
    }
    return 'Chatwork';
  }

  function findScrollContainer() {
    const selectors = ['#_chatContent', '._cwLTBody', '[class*="timelineBody"]', '[class*="TimelineBody"]', '#_mainContent', '.chatRoomBody'];
    for (const sel of selectors) {
      for (const el of document.querySelectorAll(sel)) {
        const s = window.getComputedStyle(el);
        if ((s.overflowY === 'auto' || s.overflowY === 'scroll') && el.scrollHeight > el.clientHeight) return el;
      }
    }
    // フォールバック
    const anyMsg = document.querySelector('[data-mid], ._message, [class*="message"]');
    if (anyMsg) {
      let ancestor = anyMsg.parentElement;
      while (ancestor && ancestor !== document.body) {
        if (ancestor.scrollHeight > ancestor.clientHeight + 50) {
          const s = window.getComputedStyle(ancestor);
          if (s.overflowY === 'auto' || s.overflowY === 'scroll' || s.overflowY === 'hidden') return ancestor;
        }
        ancestor = ancestor.parentElement;
      }
    }
    return null;
  }

  function getOldestVisibleDate() {
    const headers = document.querySelectorAll('[class*="dateHeader"], ._dateHeader, [class*="DateHeader"], [class*="timeLine__date"]');
    if (headers.length > 0) {
      const date = parseJapaneseDate(headers[0].textContent.trim());
      if (date) return date;
    }
    const msgs = document.querySelectorAll('[data-mid], ._message');
    if (msgs.length > 0) {
      const timeEl = msgs[0].querySelector('._timeStamp, [class*="timeStamp"], time, [datetime]');
      if (timeEl) {
        const dt = timeEl.getAttribute('datetime');
        if (dt) return new Date(dt);
        return parseJapaneseDate(timeEl.textContent.trim());
      }
    }
    return null;
  }

  function parseJapaneseDate(dateStr, baseDate) {
    const now = new Date();
    const base = baseDate || now;
    if (!dateStr) return new Date(base);

    if (dateStr.includes('今日')) {
      const t = dateStr.match(/(\d{1,2}):(\d{2})/);
      return t ? new Date(now.getFullYear(), now.getMonth(), now.getDate(), +t[1], +t[2])
               : new Date(now.getFullYear(), now.getMonth(), now.getDate());
    }
    if (dateStr.includes('昨日')) {
      const y = new Date(now); y.setDate(y.getDate() - 1);
      const t = dateStr.match(/(\d{1,2}):(\d{2})/);
      return t ? new Date(y.getFullYear(), y.getMonth(), y.getDate(), +t[1], +t[2]) : y;
    }

    // 「2024年12月17日」
    let m = dateStr.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
    if (m) {
      const t = dateStr.match(/(\d{1,2}):(\d{2})/);
      return t ? new Date(+m[1], +m[2]-1, +m[3], +t[1], +t[2])
               : new Date(+m[1], +m[2]-1, +m[3]);
    }

    // 「12/15 10:30」
    m = dateStr.match(/(\d{1,2})\/(\d{1,2})\s*(\d{1,2}):(\d{2})/);
    if (m) {
      let yr = now.getFullYear();
      if (new Date(yr, +m[1]-1, +m[2]) > now) yr--;
      return new Date(yr, +m[1]-1, +m[2], +m[3], +m[4]);
    }

    // 「12月15日」
    m = dateStr.match(/(\d{1,2})月(\d{1,2})日/);
    if (m) {
      let yr = now.getFullYear();
      if (new Date(yr, +m[1]-1, +m[2]) > now) yr--;
      const t = dateStr.match(/(\d{1,2}):(\d{2})/);
      return t ? new Date(yr, +m[1]-1, +m[2], +t[1], +t[2])
               : new Date(yr, +m[1]-1, +m[2]);
    }

    // 時刻のみ
    const t = dateStr.match(/(\d{1,2}):(\d{2})/);
    if (t) return new Date(base.getFullYear(), base.getMonth(), base.getDate(), +t[1], +t[2]);

    return new Date(base);
  }

  // オーバーレイUI
  function showOverlay() {
    hideOverlay();
    const div = document.createElement('div');
    div.id = 'cw-export-overlay';
    div.innerHTML = `
      <div style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);z-index:999999;display:flex;align-items:center;justify-content:center;">
        <div style="background:#fff;border-radius:12px;padding:24px;max-width:400px;width:90%;text-align:center;box-shadow:0 4px 20px rgba(0,0,0,0.15);">
          <h3 style="font-size:18px;color:#333;margin:0 0 12px;">📁 ログ取得中...</h3>
          <p id="cw-export-text" style="font-size:14px;color:#666;margin:0 0 10px;">準備中...</p>
          <div style="height:6px;background:#e0e0e0;border-radius:3px;overflow:hidden;margin-bottom:10px;">
            <div id="cw-export-bar" style="height:100%;background:linear-gradient(90deg,#4285f4,#34a853);border-radius:3px;width:0%;transition:width 0.3s;"></div>
          </div>
          <button id="cw-export-cancel" style="padding:8px 24px;font-size:14px;background:#f5f5f5;border:1px solid #ddd;border-radius:6px;cursor:pointer;">キャンセル</button>
        </div>
      </div>`;
    document.body.appendChild(div);
    document.getElementById('cw-export-cancel').addEventListener('click', () => { shouldCancel = true; });
  }

  function updateOverlayText(text) {
    const el = document.getElementById('cw-export-text');
    if (el) el.textContent = text;
  }

  function updateOverlayBar(pct) {
    const el = document.getElementById('cw-export-bar');
    if (el) el.style.width = `${pct}%`;
  }

  function hideOverlay() {
    const el = document.getElementById('cw-export-overlay');
    if (el) el.remove();
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
})();

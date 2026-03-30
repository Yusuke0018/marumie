/**
 * kakehashi - Background Service Worker
 */

import {
  upsertConversation,
  addMessage,
  searchMessages,
  getConversations,
  getMessagesByConversation,
  getStats,
  exportAll,
  toggleFavorite,
  getFavorites,
  isFavorite,
  addTag,
  removeTag,
  getTagsByConversation,
  getAllTags,
  getStorageStats,
  importConversations,
  archiveOldMessages
} from '../utils/db.js';

// バッジカウント
let todayCount = 0;
let todayDate = new Date().toDateString();

function incrementBadge() {
  const now = new Date().toDateString();
  if (now !== todayDate) { todayCount = 0; todayDate = now; }
  todayCount++;
  chrome.action.setBadgeText({ text: String(todayCount) });
  chrome.action.setBadgeBackgroundColor({ color: '#6366f1' });
}

// ============================================================
// Current context
// ============================================================

let currentContext = {
  url: '', title: '', keywords: [], service: '', updatedAt: 0
};

// ============================================================
// Message Handler
// ============================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse).catch(err => {
    console.error('[kakehashi] Error:', err);
    sendResponse({ error: err.message });
  });
  return true;
});

async function handleMessage(msg, sender) {
  switch (msg.type) {

    case 'CAPTURE_MESSAGE': {
      const { service, role, content, title, url, messageDate } = msg.payload;
      const conversationId = await upsertConversation({ service, title, url });
      const result = await addMessage({ conversationId, service, role, content, messageDate: messageDate || '' });
      if (result) incrementBadge();
      return { ok: true, conversationId, duplicate: result === null };
    }

    case 'CONTEXT_UPDATE': {
      const { url, title, keywords, service } = msg.payload;
      // アクティブタブからの更新のみ受け付ける（タブ切替時の誤認防止）
      if (sender.tab) {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (activeTab && activeTab.id !== sender.tab.id) {
          return { ok: true, ignored: true };
        }
      }
      currentContext = { url, title, keywords, service, updatedAt: Date.now() };
      return { ok: true };
    }

    case 'GET_CONTEXT': {
      return { ok: true, context: currentContext };
    }

    case 'FIND_RELATED': {
      const { keywords, currentUrl, currentService, limit } = msg.payload;
      if (!keywords || keywords.length === 0) {
        return { ok: true, results: [] };
      }

      const allConvs = await getConversations({ limit: 1000 });
      const convMap = {};
      const excludeIds = new Set();

      for (const conv of allConvs) {
        convMap[conv.id] = conv;
        if (currentUrl && conv.url === currentUrl) {
          excludeIds.add(conv.id);
        }
      }

      // 各キーワードで検索（多めに取得）
      const allResults = [];
      const seenKeys = new Set();
      const kwLower = keywords.map(k => k.toLowerCase());

      for (const kw of keywords.slice(0, 8)) {
        const results = await searchMessages(kw, { limit: 50 });
        for (const r of results) {
          if (excludeIds.has(r.conversationId)) continue;
          const key = r.conversationId + ':' + r.timestamp;
          if (seenKeys.has(key)) continue;
          seenKeys.add(key);
          allResults.push(r);
        }
      }

      // 会話単位でグルーピング + スコアリング
      const grouped = {};
      for (const r of allResults) {
        if (!grouped[r.conversationId]) {
          grouped[r.conversationId] = {
            conversationId: r.conversationId,
            service: r.service,
            matchedMessages: [],
            matchedKeywords: new Set(),
          };
        }
        const g = grouped[r.conversationId];
        g.matchedMessages.push(r);
        const lower = r.content.toLowerCase();
        for (const kw of kwLower) {
          if (lower.includes(kw)) g.matchedKeywords.add(kw);
        }
      }

      // 現在のサービスを特定（CONTEXT_UPDATE で渡されたもの or URL推定）
      const curService = currentService || currentContext.service || '';

      const now = Date.now();
      const conversations = [];

      for (const convId of Object.keys(grouped)) {
        const g = grouped[convId];
        const conv = convMap[convId];
        const allMessages = await getMessagesByConversation(convId);
        const title = conv ? conv.title : 'Untitled';
        const titleLower = title.toLowerCase();

        // ── スコア計算 ──

        // 1) キーワード一致数（基本スコア）
        let score = g.matchedKeywords.size * 3;

        // 2) 複数キーワード一致ボーナス（2つ以上で加速度的に高評価）
        if (g.matchedKeywords.size >= 2) score += g.matchedKeywords.size * 2;
        if (g.matchedKeywords.size >= 3) score += 5;

        // 3) マッチしたメッセージ数ボーナス（多く出現 = 深く関連）
        score += Math.min(g.matchedMessages.length, 10);

        // 4) タイトルにキーワードが含まれていればボーナス
        for (const kw of kwLower) {
          if (titleLower.includes(kw)) score += 4;
        }

        // 5) 異なるサービスの会話を優先（他サービスの情報こそ価値がある）
        if (curService && g.service === curService) {
          score *= 0.5; // 同じサービスは半減
        } else if (curService && g.service !== curService) {
          score *= 1.3; // 別サービスは1.3倍
        }

        // 6) 新しい会話にわずかなボーナス（30日以内）
        const updatedAt = conv ? conv.updatedAt : 0;
        const ageDays = (now - updatedAt) / 86400000;
        if (ageDays < 7) score += 2;
        else if (ageDays < 30) score += 1;

        conversations.push({
          conversationId: convId,
          service: g.service,
          score: Math.round(score * 10) / 10,
          matchedMessages: g.matchedMessages,
          title,
          url: conv ? conv.url : '',
          allMessages,
        });
      }

      conversations.sort((a, b) => b.score - a.score || b.matchedMessages.length - a.matchedMessages.length);

      return { ok: true, results: conversations.slice(0, limit || 10) };
    }

    case 'SEARCH': {
      const { query, service, limit } = msg.payload;
      const results = await searchMessages(query, { service, limit });
      return { ok: true, results };
    }

    case 'GET_CONVERSATIONS': {
      const { service, limit } = msg.payload || {};
      const results = await getConversations({ service, limit });
      return { ok: true, results };
    }

    case 'GET_MESSAGES': {
      const { conversationId } = msg.payload;
      const results = await getMessagesByConversation(conversationId);
      return { ok: true, results };
    }

    case 'GET_STATS': {
      const stats = await getStats();
      return { ok: true, stats };
    }

    case 'EXPORT_ALL': {
      const data = await exportAll();
      return { ok: true, data };
    }

    case 'TOGGLE_FAVORITE': {
      const result = await toggleFavorite(msg.payload.conversationId);
      return { ok: true, ...result };
    }

    case 'GET_FAVORITES': {
      const favorites = await getFavorites();
      return { ok: true, favorites };
    }

    case 'IS_FAVORITE': {
      const favorited = await isFavorite(msg.payload.conversationId);
      return { ok: true, favorited };
    }

    case 'ADD_TAG': {
      const tag = await addTag(msg.payload.conversationId, msg.payload.tag);
      return { ok: true, tag };
    }

    case 'REMOVE_TAG': {
      await removeTag(msg.payload.tagId);
      return { ok: true };
    }

    case 'GET_TAGS': {
      const tags = await getTagsByConversation(msg.payload.conversationId);
      return { ok: true, tags };
    }

    case 'GET_ALL_TAGS': {
      const tags = await getAllTags();
      return { ok: true, tags };
    }

    case 'GET_STORAGE_STATS': {
      const stats = await getStorageStats();
      return { ok: true, ...stats };
    }

    case 'IMPORT_DATA': {
      const result = await importConversations(msg.payload.data);
      return { ok: true, ...result };
    }

    case 'ARCHIVE_OLD': {
      const result = await archiveOldMessages(msg.payload.olderThanDays * 86400000);
      return { ok: true, ...result };
    }

    case 'INJECT_TO_CHAT': {
      // サイドパネル → Service Worker → アクティブタブのContent Script にリレー
      const { content, fileName } = msg.payload;
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) return { ok: false, error: 'No active tab' };
      const response = await chrome.tabs.sendMessage(tab.id, {
        type: 'INJECT_FILE',
        payload: { content, fileName }
      });
      return { ok: true, method: response?.method || 'unknown' };
    }

    case 'REQUEST_CONTEXT': {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) return { ok: false };
      try { await chrome.tabs.sendMessage(tab.id, { type: 'RESEND_CONTEXT' }); } catch (e) {}
      return { ok: true };
    }

    case 'OPEN_AI_AND_PASTE': {
      const { url, text } = msg.payload;
      // 新しいタブを開く
      const tab = await chrome.tabs.create({ url });
      // タブの読み込み完了を待ってからテキストを送信
      const sendText = (tabId, changeInfo) => {
        if (tabId === tab.id && changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(sendText);
          // Content Scriptの初期化を待つために少し遅延
          setTimeout(() => {
            chrome.tabs.sendMessage(tab.id, {
              type: 'PASTE_TEXT',
              payload: { text }
            }).catch(() => {});
          }, 2000);
        }
      };
      chrome.tabs.onUpdated.addListener(sendText);
      // 30秒でタイムアウト（リスナーリーク防止）
      setTimeout(() => chrome.tabs.onUpdated.removeListener(sendText), 30000);
      return { ok: true };
    }

    default:
      return { ok: false, error: `Unknown message type: ${msg.type}` };
  }
}

// タブ切替時にContent Scriptへコンテキスト再送を要求
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    await chrome.tabs.sendMessage(activeInfo.tabId, { type: 'RESEND_CONTEXT' });
  } catch (e) {}
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.action.setBadgeText({ text: '' });
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
  console.log('[kakehashi] Installed / Updated v0.2.0');
});

/**
 * kakehashi - Database Layer (IndexedDB)
 * 
 * 統一スキーマで3サービスの会話を管理する。
 * 
 * データ構造:
 *   conversations: { id, service, title, url, createdAt, updatedAt }
 *   messages:      { id, conversationId, service, role, content, timestamp }
 */

const DB_NAME = 'kakehashi';
const DB_VERSION = 2;

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // --- conversations store ---
      if (!db.objectStoreNames.contains('conversations')) {
        const convStore = db.createObjectStore('conversations', { keyPath: 'id' });
        convStore.createIndex('by_service', 'service', { unique: false });
        convStore.createIndex('by_updatedAt', 'updatedAt', { unique: false });
        convStore.createIndex('by_service_url', ['service', 'url'], { unique: false });
      }

      // --- messages store ---
      if (!db.objectStoreNames.contains('messages')) {
        const msgStore = db.createObjectStore('messages', { keyPath: 'id', autoIncrement: true });
        msgStore.createIndex('by_conversationId', 'conversationId', { unique: false });
        msgStore.createIndex('by_service', 'service', { unique: false });
        msgStore.createIndex('by_timestamp', 'timestamp', { unique: false });
        // 全文検索用（簡易）: content を含むcompound index
        msgStore.createIndex('by_conv_role', ['conversationId', 'role'], { unique: false });
      }

      // === v1 → v2 マイグレーション: 新ストア追加 ===

      // --- favorites store ---
      if (!db.objectStoreNames.contains('favorites')) {
        db.createObjectStore('favorites', { keyPath: 'conversationId' });
      }

      // --- tags store ---
      if (!db.objectStoreNames.contains('tags')) {
        const tagStore = db.createObjectStore('tags', { keyPath: 'id', autoIncrement: true });
        tagStore.createIndex('by_conversationId', 'conversationId', { unique: false });
        tagStore.createIndex('by_tag', 'tag', { unique: false });
      }

      // --- searchIndex store ---
      if (!db.objectStoreNames.contains('searchIndex')) {
        const siStore = db.createObjectStore('searchIndex', { keyPath: 'id', autoIncrement: true });
        siStore.createIndex('by_word', 'word', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// ============================================================
// Conversation CRUD
// ============================================================

export async function upsertConversation({ service, title, url }) {
  const db = await openDB();
  const tx = db.transaction('conversations', 'readwrite');
  const store = tx.objectStore('conversations');

  // 同一URL の会話が既にあれば更新
  const existing = await new Promise((resolve) => {
    const idx = store.index('by_service_url');
    const req = idx.get([service, url]);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => resolve(null);
  });

  const now = Date.now();

  if (existing) {
    existing.title = title || existing.title;
    existing.updatedAt = now;
    store.put(existing);
    await txComplete(tx);
    db.close();
    return existing.id;
  }

  const id = `${service}_${now}_${Math.random().toString(36).slice(2, 8)}`;
  const conv = { id, service, title: title || 'Untitled', url, createdAt: now, updatedAt: now };
  store.add(conv);
  await txComplete(tx);
  db.close();
  return id;
}

// ============================================================
// Message CRUD
// ============================================================

export async function addMessage({ conversationId, service, role, content, messageDate }) {
  const db = await openDB();
  const tx = db.transaction(['messages', 'conversations'], 'readwrite');

  const msgStore = tx.objectStore('messages');
  const now = Date.now();

  // 重複チェック（同一会話・同一role・同一content の直近メッセージ）
  const existing = await new Promise((resolve) => {
    const idx = msgStore.index('by_conversationId');
    const req = idx.openCursor(IDBKeyRange.only(conversationId), 'prev');
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor && cursor.value.role === role && cursor.value.content === content) {
        resolve(true);
      } else {
        resolve(false);
      }
    };
    req.onerror = () => resolve(false);
  });

  if (existing) {
    db.close();
    return null; // skip duplicate
  }

  const record = { conversationId, service, role, content, timestamp: now };
  // CWのメッセージ投稿日（"2026-03-19" 形式）を保存
  if (messageDate) record.messageDate = messageDate;
  const addReq = msgStore.add(record);

  // 会話の updatedAt を更新
  const convStore = tx.objectStore('conversations');
  const convReq = convStore.get(conversationId);
  convReq.onsuccess = () => {
    if (convReq.result) {
      convReq.result.updatedAt = now;
      convStore.put(convReq.result);
    }
  };

  await txComplete(tx);

  // searchIndex に単語を追加
  const messageId = addReq.result;
  const words = extractWords(content);
  if (words.length > 0) {
    const siTx = db.transaction('searchIndex', 'readwrite');
    const siStore = siTx.objectStore('searchIndex');
    for (const word of words) {
      siStore.add({ word, conversationId, messageId });
    }
    await txComplete(siTx);
  }

  db.close();
  return now;
}

// ============================================================
// Search
// ============================================================

export async function searchMessages(query, { service = null, limit = 50 } = {}) {
  const db = await openDB();
  const tx = db.transaction(['messages', 'conversations'], 'readonly');
  const msgStore = tx.objectStore('messages');
  const convStore = tx.objectStore('conversations');

  const keywords = query.toLowerCase().split(/\s+/).filter(Boolean);
  const results = [];

  return new Promise((resolve) => {
    const cursorReq = msgStore.openCursor(null, 'prev'); // 新しい順
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (!cursor || results.length >= limit) {
        db.close();
        resolve(results);
        return;
      }

      const msg = cursor.value;

      // service フィルタ
      if (service && msg.service !== service) {
        cursor.continue();
        return;
      }

      // keyword マッチ（全keyword が content に含まれる）
      const lowerContent = msg.content.toLowerCase();
      const match = keywords.every(kw => lowerContent.includes(kw));

      if (match) {
        results.push(msg);
      }

      cursor.continue();
    };
    cursorReq.onerror = () => {
      db.close();
      resolve(results);
    };
  });
}

// ============================================================
// Stats / List
// ============================================================

export async function getConversations({ service = null, limit = 100 } = {}) {
  const db = await openDB();
  const tx = db.transaction('conversations', 'readonly');
  const store = tx.objectStore('conversations');
  const results = [];

  return new Promise((resolve) => {
    const idx = store.index('by_updatedAt');
    const req = idx.openCursor(null, 'prev');
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor || results.length >= limit) {
        db.close();
        resolve(results);
        return;
      }
      const conv = cursor.value;
      if (!service || conv.service === service) {
        results.push(conv);
      }
      cursor.continue();
    };
    req.onerror = () => {
      db.close();
      resolve(results);
    };
  });
}

export async function getMessagesByConversation(conversationId) {
  const db = await openDB();
  const tx = db.transaction('messages', 'readonly');
  const store = tx.objectStore('messages');
  const idx = store.index('by_conversationId');

  return new Promise((resolve) => {
    const req = idx.getAll(IDBKeyRange.only(conversationId));
    req.onsuccess = () => {
      db.close();
      resolve(req.result || []);
    };
    req.onerror = () => {
      db.close();
      resolve([]);
    };
  });
}

export async function getStats() {
  const db = await openDB();
  const tx = db.transaction(['conversations', 'messages'], 'readonly');

  const convCount = await new Promise(r => {
    const req = tx.objectStore('conversations').count();
    req.onsuccess = () => r(req.result);
  });

  const msgCount = await new Promise(r => {
    const req = tx.objectStore('messages').count();
    req.onsuccess = () => r(req.result);
  });

  // service 別カウント
  const byService = {};
  const convStore = tx.objectStore('conversations');
  await new Promise(resolve => {
    const req = convStore.openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) { resolve(); return; }
      const s = cursor.value.service;
      byService[s] = (byService[s] || 0) + 1;
      cursor.continue();
    };
  });

  db.close();
  return { conversations: convCount, messages: msgCount, byService };
}

// ============================================================
// Export
// ============================================================

export async function exportAll() {
  const db = await openDB();
  const tx = db.transaction(['conversations', 'messages'], 'readonly');

  const conversations = await new Promise(r => {
    tx.objectStore('conversations').getAll().onsuccess = e => r(e.target.result);
  });
  const messages = await new Promise(r => {
    tx.objectStore('messages').getAll().onsuccess = e => r(e.target.result);
  });

  db.close();
  return { exportedAt: new Date().toISOString(), conversations, messages };
}

// ============================================================
// Favorites
// ============================================================

export async function toggleFavorite(conversationId) {
  const db = await openDB();
  const tx = db.transaction('favorites', 'readwrite');
  const store = tx.objectStore('favorites');

  const existing = await new Promise((resolve) => {
    const req = store.get(conversationId);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => resolve(null);
  });

  if (existing) {
    store.delete(conversationId);
    await txComplete(tx);
    db.close();
    return { favorited: false };
  } else {
    store.add({ conversationId, pinnedAt: Date.now() });
    await txComplete(tx);
    db.close();
    return { favorited: true };
  }
}

export async function getFavorites() {
  const db = await openDB();
  const tx = db.transaction('favorites', 'readonly');
  const store = tx.objectStore('favorites');
  return new Promise((resolve) => {
    const req = store.getAll();
    req.onsuccess = () => { db.close(); resolve(req.result || []); };
    req.onerror = () => { db.close(); resolve([]); };
  });
}

export async function isFavorite(conversationId) {
  const db = await openDB();
  const tx = db.transaction('favorites', 'readonly');
  const store = tx.objectStore('favorites');
  return new Promise((resolve) => {
    const req = store.get(conversationId);
    req.onsuccess = () => { db.close(); resolve(!!req.result); };
    req.onerror = () => { db.close(); resolve(false); };
  });
}

// ============================================================
// Tags
// ============================================================

export async function addTag(conversationId, tag) {
  const db = await openDB();
  const tx = db.transaction('tags', 'readwrite');
  const store = tx.objectStore('tags');
  const record = { conversationId, tag, createdAt: Date.now() };
  const addReq = store.add(record);
  await txComplete(tx);
  record.id = addReq.result;
  db.close();
  return record;
}

export async function removeTag(tagId) {
  const db = await openDB();
  const tx = db.transaction('tags', 'readwrite');
  const store = tx.objectStore('tags');
  store.delete(tagId);
  await txComplete(tx);
  db.close();
}

export async function getTagsByConversation(conversationId) {
  const db = await openDB();
  const tx = db.transaction('tags', 'readonly');
  const store = tx.objectStore('tags');
  const idx = store.index('by_conversationId');
  return new Promise((resolve) => {
    const req = idx.getAll(IDBKeyRange.only(conversationId));
    req.onsuccess = () => { db.close(); resolve(req.result || []); };
    req.onerror = () => { db.close(); resolve([]); };
  });
}

export async function getAllTags() {
  const db = await openDB();
  const tx = db.transaction('tags', 'readonly');
  const store = tx.objectStore('tags');
  return new Promise((resolve) => {
    const req = store.getAll();
    req.onsuccess = () => {
      db.close();
      const all = req.result || [];
      const unique = [...new Set(all.map(t => t.tag))];
      resolve(unique);
    };
    req.onerror = () => { db.close(); resolve([]); };
  });
}

// ============================================================
// Storage Stats
// ============================================================

export async function getStorageStats() {
  const db = await openDB();
  const storeNames = ['conversations', 'messages', 'favorites', 'tags', 'searchIndex'];
  const counts = {};

  for (const name of storeNames) {
    const tx = db.transaction(name, 'readonly');
    const store = tx.objectStore(name);
    counts[name] = await new Promise((resolve) => {
      const req = store.count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(0);
    });
  }

  // messages の content 文字数合計を概算サイズとして算出
  const msgTx = db.transaction('messages', 'readonly');
  const msgStore = msgTx.objectStore('messages');
  let totalChars = 0;
  await new Promise((resolve) => {
    const req = msgStore.openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) { resolve(); return; }
      if (cursor.value.content) {
        totalChars += cursor.value.content.length;
      }
      cursor.continue();
    };
    req.onerror = () => resolve();
  });

  db.close();
  return { counts, estimatedSizeChars: totalChars };
}

// ============================================================
// Import / Archive
// ============================================================

export async function importConversations(data) {
  const db = await openDB();
  const imported = { conversations: 0, messages: 0 };

  // conversations の upsert
  if (data.conversations && data.conversations.length > 0) {
    const tx = db.transaction('conversations', 'readwrite');
    const store = tx.objectStore('conversations');
    for (const conv of data.conversations) {
      const exists = await new Promise((resolve) => {
        const req = store.get(conv.id);
        req.onsuccess = () => resolve(!!req.result);
        req.onerror = () => resolve(false);
      });
      if (!exists) {
        store.add(conv);
        imported.conversations++;
      }
    }
    await txComplete(tx);
  }

  // messages の upsert
  if (data.messages && data.messages.length > 0) {
    const tx = db.transaction('messages', 'readwrite');
    const store = tx.objectStore('messages');
    for (const msg of data.messages) {
      // id があれば重複チェック、なければそのまま追加
      if (msg.id) {
        const exists = await new Promise((resolve) => {
          const req = store.get(msg.id);
          req.onsuccess = () => resolve(!!req.result);
          req.onerror = () => resolve(false);
        });
        if (!exists) {
          store.add(msg);
          imported.messages++;
        }
      } else {
        store.add(msg);
        imported.messages++;
      }
    }
    await txComplete(tx);
  }

  db.close();
  return { imported };
}

export async function archiveOldMessages(olderThanMs) {
  const db = await openDB();
  const cutoff = Date.now() - olderThanMs;
  const tx = db.transaction('messages', 'readwrite');
  const store = tx.objectStore('messages');
  const idx = store.index('by_timestamp');
  let archived = 0;

  await new Promise((resolve) => {
    const range = IDBKeyRange.upperBound(cutoff, true);
    const req = idx.openCursor(range);
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) { resolve(); return; }
      cursor.delete();
      archived++;
      cursor.continue();
    };
    req.onerror = () => resolve();
  });

  await txComplete(tx);
  db.close();
  return { archived };
}

// ============================================================
// Utils
// ============================================================

/**
 * content から検索用の単語を抽出する。
 * - 日本語: 漢字2文字以上の塊、カタカナ2文字以上の塊
 * - 英語: 3文字以上のアルファベット単語（小文字化）
 */
function extractWords(content) {
  if (!content) return [];
  const words = new Set();

  // 漢字の塊（2文字以上）
  const kanjiMatches = content.match(/[\u4e00-\u9faf\u3400-\u4dbf]{2,}/g);
  if (kanjiMatches) kanjiMatches.forEach(w => words.add(w));

  // カタカナの塊（2文字以上）
  const kataMatches = content.match(/[\u30a0-\u30ff]{2,}/g);
  if (kataMatches) kataMatches.forEach(w => words.add(w));

  // 英語単語（3文字以上、小文字化）
  const enMatches = content.match(/[a-zA-Z]{3,}/g);
  if (enMatches) enMatches.forEach(w => words.add(w.toLowerCase()));

  return [...words];
}

function txComplete(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

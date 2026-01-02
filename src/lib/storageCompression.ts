import { deflate, inflate } from "pako";

/**
 * LocalStorage容量制限対策用の圧縮ユーティリティ
 * LZ-string互換アルゴリズムとpakoによるDEFLATE圧縮の両方を利用
 */

const RAW_PREFIX = "__raw__:";
const LZ_PREFIX = "__lz__:";
const PAKO_PREFIX = "__pako__:";
const CHUNK_META_PREFIX = "__chunks__:";
const CHUNK_KEY_SEPARATOR = "::chunk::";
const CHUNK_SIZE = 4_000_000; // 4MB相当（ローカルストレージ制限の緩衝）
const textEncoder = typeof TextEncoder !== "undefined" ? new TextEncoder() : null;
const textDecoder = typeof TextDecoder !== "undefined" ? new TextDecoder() : null;

/**
 * LocalStorageの使用状況を取得
 */
export function getStorageUsage(): { used: number; total: number; available: number } {
  if (typeof window === "undefined") {
    return { used: 0, total: 5 * 1024 * 1024, available: 5 * 1024 * 1024 };
  }

  let used = 0;
  try {
    for (const key in window.localStorage) {
      if (Object.prototype.hasOwnProperty.call(window.localStorage, key)) {
        // UTF-16なので2バイト/文字
        used += (window.localStorage[key].length + key.length) * 2;
      }
    }
  } catch {
    // ignore
  }

  // ブラウザのLocalStorage制限は通常5MB（一部10MB）
  const total = 5 * 1024 * 1024;
  return { used, total, available: Math.max(0, total - used) };
}

/**
 * 指定キーの使用容量を取得
 */
export function getKeyUsage(key: string): number {
  if (typeof window === "undefined") {
    return 0;
  }

  let size = 0;
  try {
    const meta = window.localStorage.getItem(key);
    if (meta) {
      size += (key.length + meta.length) * 2;
      if (meta.startsWith(CHUNK_META_PREFIX)) {
        const count = Number.parseInt(meta.slice(CHUNK_META_PREFIX.length), 10);
        if (Number.isFinite(count) && count > 0) {
          for (let i = 0; i < count; i++) {
            const chunkKey = `${key}${CHUNK_KEY_SEPARATOR}${i}`;
            const chunk = window.localStorage.getItem(chunkKey);
            if (chunk) {
              size += (chunkKey.length + chunk.length) * 2;
            }
          }
        }
      }
    }
  } catch {
    // ignore
  }
  return size;
}

/**
 * clinic-analytics配下のキー一覧を取得（サイズ順）
 */
export function getClinicAnalyticsKeys(): Array<{ key: string; size: number }> {
  if (typeof window === "undefined") {
    return [];
  }

  const keys: Array<{ key: string; size: number }> = [];
  const seen = new Set<string>();

  try {
    for (const key in window.localStorage) {
      if (!Object.prototype.hasOwnProperty.call(window.localStorage, key)) continue;
      if (!key.startsWith("clinic-analytics/")) continue;

      // チャンクキーは親キーにまとめる
      const baseKey = key.includes(CHUNK_KEY_SEPARATOR)
        ? key.split(CHUNK_KEY_SEPARATOR)[0]
        : key;

      if (seen.has(baseKey)) continue;
      seen.add(baseKey);

      keys.push({ key: baseKey, size: getKeyUsage(baseKey) });
    }
  } catch {
    // ignore
  }

  return keys.sort((a, b) => b.size - a.size);
}

/**
 * 文字列をUTF-16でエンコード
 */
function compress(uncompressed: string): string {
  if (uncompressed === null || uncompressed === undefined) {
    return "";
  }

  const context_dictionary: Record<string, number> = {};
  const context_dictionaryToCreate: Record<string, boolean> = {};
  let context_c = "";
  let context_wc = "";
  let context_w = "";
  let context_enlargeIn = 2;
  let context_dictSize = 3;
  let context_numBits = 2;
  const context_data: number[] = [];
  let context_data_val = 0;
  let context_data_position = 0;

  for (let ii = 0; ii < uncompressed.length; ii += 1) {
    context_c = uncompressed.charAt(ii);
    if (!Object.prototype.hasOwnProperty.call(context_dictionary, context_c)) {
      context_dictionary[context_c] = context_dictSize++;
      context_dictionaryToCreate[context_c] = true;
    }

    context_wc = context_w + context_c;
    if (Object.prototype.hasOwnProperty.call(context_dictionary, context_wc)) {
      context_w = context_wc;
    } else {
      if (Object.prototype.hasOwnProperty.call(context_dictionaryToCreate, context_w)) {
        if (context_w.charCodeAt(0) < 256) {
          for (let i = 0; i < context_numBits; i++) {
            context_data_val = context_data_val << 1;
            if (context_data_position === 15) {
              context_data_position = 0;
              context_data.push(context_data_val);
              context_data_val = 0;
            } else {
              context_data_position++;
            }
          }
          let value = context_w.charCodeAt(0);
          for (let i = 0; i < 8; i++) {
            context_data_val = (context_data_val << 1) | (value & 1);
            if (context_data_position === 15) {
              context_data_position = 0;
              context_data.push(context_data_val);
              context_data_val = 0;
            } else {
              context_data_position++;
            }
            value = value >> 1;
          }
        } else {
          let value = 1;
          for (let i = 0; i < context_numBits; i++) {
            context_data_val = (context_data_val << 1) | value;
            if (context_data_position === 15) {
              context_data_position = 0;
              context_data.push(context_data_val);
              context_data_val = 0;
            } else {
              context_data_position++;
            }
            value = 0;
          }
          value = context_w.charCodeAt(0);
          for (let i = 0; i < 16; i++) {
            context_data_val = (context_data_val << 1) | (value & 1);
            if (context_data_position === 15) {
              context_data_position = 0;
              context_data.push(context_data_val);
              context_data_val = 0;
            } else {
              context_data_position++;
            }
            value = value >> 1;
          }
        }
        context_enlargeIn--;
        if (context_enlargeIn === 0) {
          context_enlargeIn = Math.pow(2, context_numBits);
          context_numBits++;
        }
        delete context_dictionaryToCreate[context_w];
      } else {
        let value = context_dictionary[context_w];
        for (let i = 0; i < context_numBits; i++) {
          context_data_val = (context_data_val << 1) | (value & 1);
          if (context_data_position === 15) {
            context_data_position = 0;
            context_data.push(context_data_val);
            context_data_val = 0;
          } else {
            context_data_position++;
          }
          value = value >> 1;
        }
      }
      context_enlargeIn--;
      if (context_enlargeIn === 0) {
        context_enlargeIn = Math.pow(2, context_numBits);
        context_numBits++;
      }
      context_dictionary[context_wc] = context_dictSize++;
      context_w = String(context_c);
    }
  }

  if (context_w !== "") {
    if (Object.prototype.hasOwnProperty.call(context_dictionaryToCreate, context_w)) {
      if (context_w.charCodeAt(0) < 256) {
        for (let i = 0; i < context_numBits; i++) {
          context_data_val = context_data_val << 1;
          if (context_data_position === 15) {
            context_data_position = 0;
            context_data.push(context_data_val);
            context_data_val = 0;
          } else {
            context_data_position++;
          }
        }
        let value = context_w.charCodeAt(0);
        for (let i = 0; i < 8; i++) {
          context_data_val = (context_data_val << 1) | (value & 1);
          if (context_data_position === 15) {
            context_data_position = 0;
            context_data.push(context_data_val);
            context_data_val = 0;
          } else {
            context_data_position++;
          }
          value = value >> 1;
        }
      } else {
        let value = 1;
        for (let i = 0; i < context_numBits; i++) {
          context_data_val = (context_data_val << 1) | value;
          if (context_data_position === 15) {
            context_data_position = 0;
            context_data.push(context_data_val);
            context_data_val = 0;
          } else {
            context_data_position++;
          }
          value = 0;
        }
        value = context_w.charCodeAt(0);
        for (let i = 0; i < 16; i++) {
          context_data_val = (context_data_val << 1) | (value & 1);
          if (context_data_position === 15) {
            context_data_position = 0;
            context_data.push(context_data_val);
            context_data_val = 0;
          } else {
            context_data_position++;
          }
          value = value >> 1;
        }
      }
      context_enlargeIn--;
      if (context_enlargeIn === 0) {
        context_enlargeIn = Math.pow(2, context_numBits);
        context_numBits++;
      }
      delete context_dictionaryToCreate[context_w];
    } else {
      let value = context_dictionary[context_w];
      for (let i = 0; i < context_numBits; i++) {
        context_data_val = (context_data_val << 1) | (value & 1);
        if (context_data_position === 15) {
          context_data_position = 0;
          context_data.push(context_data_val);
          context_data_val = 0;
        } else {
          context_data_position++;
        }
        value = value >> 1;
      }
    }
    context_enlargeIn--;
    if (context_enlargeIn === 0) {
      context_enlargeIn = Math.pow(2, context_numBits);
      context_numBits++;
    }
  }

  let value = 2;
  for (let i = 0; i < context_numBits; i++) {
    context_data_val = (context_data_val << 1) | (value & 1);
    if (context_data_position === 15) {
      context_data_position = 0;
      context_data.push(context_data_val);
      context_data_val = 0;
    } else {
      context_data_position++;
    }
    value = value >> 1;
  }

  while (true) {
    context_data_val = context_data_val << 1;
    if (context_data_position === 15) {
      context_data.push(context_data_val);
      break;
    } else {
      context_data_position++;
    }
  }

  let result = "";
  for (let i = 0; i < context_data.length; i++) {
    result += String.fromCharCode(context_data[i]);
  }
  return result;
}

/**
 * 圧縮された文字列をデコード
 */
function decompress(compressed: string): string {
  if (compressed === null || compressed === undefined || compressed === "") {
    return "";
  }

  const dictionary: string[] = [];
  let enlargeIn = 4;
  let dictSize = 4;
  let numBits = 3;
  let entry = "";
  let result = "";
  let w: string;
  let bits;
  let resb;
  let maxpower;
  let power;
  let c: string | number = "";
  const data = { val: compressed.charCodeAt(0), position: 0, index: 1 };

  for (let i = 0; i < 3; i += 1) {
    dictionary[i] = String(i);
  }

  bits = 0;
  maxpower = Math.pow(2, 2);
  power = 1;
  while (power !== maxpower) {
    resb = data.val & data.position;
    data.position >>= 1;
    if (data.position === 0) {
      data.position = 32768;
      data.val = compressed.charCodeAt(data.index++);
    }
    bits |= (resb > 0 ? 1 : 0) * power;
    power <<= 1;
  }

  switch (bits) {
    case 0:
      bits = 0;
      maxpower = Math.pow(2, 8);
      power = 1;
      while (power !== maxpower) {
        resb = data.val & data.position;
        data.position >>= 1;
        if (data.position === 0) {
          data.position = 32768;
          data.val = compressed.charCodeAt(data.index++);
        }
        bits |= (resb > 0 ? 1 : 0) * power;
        power <<= 1;
      }
      c = String.fromCharCode(bits);
      break;
    case 1:
      bits = 0;
      maxpower = Math.pow(2, 16);
      power = 1;
      while (power !== maxpower) {
        resb = data.val & data.position;
        data.position >>= 1;
        if (data.position === 0) {
          data.position = 32768;
          data.val = compressed.charCodeAt(data.index++);
        }
        bits |= (resb > 0 ? 1 : 0) * power;
        power <<= 1;
      }
      c = String.fromCharCode(bits);
      break;
    case 2:
      return "";
  }
  dictionary[3] = c as string;
  w = c as string;
  result = c as string;
  while (true) {
    if (data.index > compressed.length) {
      return "";
    }

    bits = 0;
    maxpower = Math.pow(2, numBits);
    power = 1;
    while (power !== maxpower) {
      resb = data.val & data.position;
      data.position >>= 1;
      if (data.position === 0) {
        data.position = 32768;
        data.val = compressed.charCodeAt(data.index++);
      }
      bits |= (resb > 0 ? 1 : 0) * power;
      power <<= 1;
    }

    switch ((c = bits)) {
      case 0:
        bits = 0;
        maxpower = Math.pow(2, 8);
        power = 1;
        while (power !== maxpower) {
          resb = data.val & data.position;
          data.position >>= 1;
          if (data.position === 0) {
            data.position = 32768;
            data.val = compressed.charCodeAt(data.index++);
          }
          bits |= (resb > 0 ? 1 : 0) * power;
          power <<= 1;
        }

        dictionary[dictSize++] = String.fromCharCode(bits);
        c = dictSize - 1;
        enlargeIn--;
        break;
      case 1:
        bits = 0;
        maxpower = Math.pow(2, 16);
        power = 1;
        while (power !== maxpower) {
          resb = data.val & data.position;
          data.position >>= 1;
          if (data.position === 0) {
            data.position = 32768;
            data.val = compressed.charCodeAt(data.index++);
          }
          bits |= (resb > 0 ? 1 : 0) * power;
          power <<= 1;
        }
        dictionary[dictSize++] = String.fromCharCode(bits);
        c = dictSize - 1;
        enlargeIn--;
        break;
      case 2:
        return result;
    }

    if (enlargeIn === 0) {
      enlargeIn = Math.pow(2, numBits);
      numBits++;
    }

    if (dictionary[c as number]) {
      entry = dictionary[c as number];
    } else {
      if (c === dictSize) {
        entry = w + w.charAt(0);
      } else {
        return "";
      }
    }
    result += entry;

    dictionary[dictSize++] = w + entry.charAt(0);
    enlargeIn--;

    w = entry;

    if (enlargeIn === 0) {
      enlargeIn = Math.pow(2, numBits);
      numBits++;
    }
  }
}

const encodeBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
};

const decodeBase64 = (base64: string): Uint8Array => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

const buildChunkKey = (key: string, index: number) => `${key}${CHUNK_KEY_SEPARATOR}${index}`;

const clearChunkEntries = (key: string) => {
  if (typeof window === "undefined") {
    return;
  }
  try {
    const meta = window.localStorage.getItem(key);
    if (meta && meta.startsWith(CHUNK_META_PREFIX)) {
      const count = Number.parseInt(meta.slice(CHUNK_META_PREFIX.length), 10);
      if (Number.isFinite(count) && count > 0) {
        for (let index = 0; index < count; index += 1) {
          window.localStorage.removeItem(buildChunkKey(key, index));
        }
      }
    }
  } catch (error) {
    console.error("チャンク削除エラー:", error);
  }
};

const isQuotaExceeded = (error: unknown): boolean => {
  if (typeof DOMException !== "undefined" && error instanceof DOMException) {
    return (
      error.name === "QuotaExceededError" ||
      error.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
      error.code === 22 ||
      error.code === 1014
    );
  }
  return false;
};

const storePayload = (key: string, payload: string) => {
  if (typeof window === "undefined") {
    return;
  }

  clearChunkEntries(key);

  // まずは単一キーでの保存を試みる
  if (payload.length <= CHUNK_SIZE) {
    try {
      window.localStorage.setItem(key, payload);
      return;
    } catch (error) {
      if (!isQuotaExceeded(error)) {
        throw error;
      }
      // quota に達した場合はチャンク保存へフォールバック
    }
  }

  // チャンク保存（サイズを段階的に縮小しながら試行）
  const sizes = [CHUNK_SIZE, 2_000_000, 1_000_000, 512_000, 256_000, 128_000];
  let lastError: unknown = null;

  const tryChunkedSave = (chunkSize: number): boolean => {
    const chunkCount = Math.ceil(payload.length / chunkSize);
    try {
      for (let index = 0; index < chunkCount; index += 1) {
        const start = index * chunkSize;
        const chunk = payload.slice(start, start + chunkSize);
        window.localStorage.setItem(buildChunkKey(key, index), chunk);
      }
      window.localStorage.setItem(key, `${CHUNK_META_PREFIX}${chunkCount}`);
      return true;
    } catch (error) {
      // 失敗した場合は部分的に保存されたチャンクを削除
      for (let index = 0; index < chunkCount; index += 1) {
        window.localStorage.removeItem(buildChunkKey(key, index));
      }
      lastError = error;
      return false;
    }
  };

  for (const size of sizes) {
    if (tryChunkedSave(size)) {
      return;
    }
  }

  // すべて失敗した場合は最後のエラーを投げる
  if (lastError) {
    throw lastError;
  }
  throw new Error("Failed to store payload in localStorage");
};

/**
 * LocalStorageに圧縮して保存
 */
export function setCompressedItem(key: string, value: string): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    const candidates: Array<{ payload: string; validate: () => boolean }> = [
      { payload: `${RAW_PREFIX}${value}`, validate: () => true },
    ];

    if (textEncoder && textDecoder) {
      try {
        const encoded = textEncoder.encode(value);
        const compressedBytes = deflate(encoded, { level: 9 });
        const base64 = encodeBase64(compressedBytes);
        const payload = `${PAKO_PREFIX}${base64}`;
        candidates.push({
          payload,
          validate: () => {
            try {
              const restoredBytes = inflate(decodeBase64(base64));
              const restored = textDecoder.decode(restoredBytes);
              return restored === value;
            } catch {
              return false;
            }
          },
        });
      } catch (error) {
        console.error("pako圧縮エラー:", error);
      }
    }

    try {
      const lzCompressed = compress(value);
      candidates.push({
        payload: `${LZ_PREFIX}${lzCompressed}`,
        validate: () => {
          try {
            return decompress(lzCompressed) === value;
          } catch {
            return false;
          }
        },
      });
    } catch (error) {
      console.error("LZ圧縮エラー:", error);
    }

    const validCandidates = candidates.filter((candidate) => candidate.validate());
    const chosen =
      validCandidates.length > 0
        ? validCandidates.reduce((smallest, current) =>
            current.payload.length < smallest.payload.length ? current : smallest,
          )
        : candidates[0];

    storePayload(key, chosen.payload);
  } catch (error) {
    console.error("圧縮保存エラー:", error);
    throw new Error(`LocalStorageへの保存に失敗しました: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * LocalStorageから解凍して取得
 */
const decodeStoredPayload = (payload: string): string => {
  if (payload.startsWith(RAW_PREFIX)) {
    return payload.slice(RAW_PREFIX.length);
  }

  if (payload.startsWith(PAKO_PREFIX)) {
    if (!textDecoder) {
      throw new Error("TextDecoderが利用できないため展開できません");
    }
    const base64 = payload.slice(PAKO_PREFIX.length);
    const restoredBytes = inflate(decodeBase64(base64));
    return textDecoder.decode(restoredBytes);
  }

  const body = payload.startsWith(LZ_PREFIX)
    ? payload.slice(LZ_PREFIX.length)
    : payload;
  return decompress(body);
};

const assembleChunkPayload = (key: string, meta: string): string | null => {
  if (typeof window === "undefined") {
    return null;
  }
  const count = Number.parseInt(meta.slice(CHUNK_META_PREFIX.length), 10);
  if (!Number.isFinite(count) || count <= 0) {
    return null;
  }
  let combined = "";
  for (let index = 0; index < count; index += 1) {
    const chunk = window.localStorage.getItem(buildChunkKey(key, index));
    if (chunk === null) {
      return null;
    }
    combined += chunk;
  }
  return combined;
};

export function getCompressedItem(key: string): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const stored = window.localStorage.getItem(key);
    if (!stored) {
      return null;
    }

    const payload = stored.startsWith(CHUNK_META_PREFIX)
      ? assembleChunkPayload(key, stored)
      : stored;

    if (!payload) {
      return null;
    }

    return decodeStoredPayload(payload);
  } catch (error) {
    console.error("解凍取得エラー:", error);
    return null;
  }
}

export function clearCompressedItem(key: string): void {
  if (typeof window === "undefined") {
    return;
  }
  clearChunkEntries(key);
  window.localStorage.removeItem(key);
}

/**
 * 圧縮率を計算
 */
export function getCompressionRatio(original: string, compressed: string): number {
  const originalSize = new Blob([original]).size;
  const compressedSize = new Blob([compressed]).size;
  return Math.round((1 - compressedSize / originalSize) * 100);
}

/**
 * LocalStorage容量制限対策用の圧縮ユーティリティ
 * LZ-string互換の軽量圧縮を実装
 */

const RAW_PREFIX = "__raw__:";
const COMPRESSED_PREFIX = "__lz__:";

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

/**
 * LocalStorageに圧縮して保存
 */
export function setCompressedItem(key: string, value: string): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    const compressed = compress(value);
    let useRaw = compressed.length === 0 && value.length > 0;

    if (!useRaw) {
      try {
        const restored = decompress(compressed);
        if (restored !== value) {
          useRaw = true;
        }
      } catch (error) {
        console.error("圧縮データ検証エラー:", error);
        useRaw = true;
      }
    }

    if (useRaw) {
      window.localStorage.setItem(key, `${RAW_PREFIX}${value}`);
    } else {
      window.localStorage.setItem(key, `${COMPRESSED_PREFIX}${compressed}`);
    }
  } catch (error) {
    console.error("圧縮保存エラー:", error);
    throw new Error(`LocalStorageへの保存に失敗しました: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * LocalStorageから解凍して取得
 */
export function getCompressedItem(key: string): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const compressed = window.localStorage.getItem(key);
    if (!compressed) {
      return null;
    }

    if (compressed.startsWith(RAW_PREFIX)) {
      return compressed.slice(RAW_PREFIX.length);
    }

    const payload = compressed.startsWith(COMPRESSED_PREFIX)
      ? compressed.slice(COMPRESSED_PREFIX.length)
      : compressed;

    return decompress(payload);
  } catch (error) {
    console.error("解凍取得エラー:", error);
    return null;
  }
}

/**
 * 圧縮率を計算
 */
export function getCompressionRatio(original: string, compressed: string): number {
  const originalSize = new Blob([original]).size;
  const compressedSize = new Blob([compressed]).size;
  return Math.round((1 - compressedSize / originalSize) * 100);
}

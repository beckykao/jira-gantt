// AES-GCM encryption for Jira API tokens at rest.
//
// The key comes from the ENCRYPTION_KEY environment variable (base64, 32
// bytes). Generate one with:
//   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
// then: wrangler pages secret put ENCRYPTION_KEY --project-name=jira-gantt

import { AppError } from './types';

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

async function importKey(rawKey: string | undefined): Promise<CryptoKey> {
  if (!rawKey) {
    throw new AppError(
      '系統尚未設定加密金鑰，無法安全儲存 Jira Token。請聯絡管理員設定 ENCRYPTION_KEY 環境變數。',
      500,
      'encryption_not_configured'
    );
  }
  let bytes: Uint8Array;
  try {
    bytes = b64ToBytes(rawKey.trim());
  } catch {
    throw new AppError('加密金鑰格式錯誤，請確認 ENCRYPTION_KEY 是 base64 字串。', 500, 'encryption_key_invalid');
  }
  if (bytes.length !== 32) {
    throw new AppError('加密金鑰長度需為 32 bytes（base64 編碼後約 44 字元）。', 500, 'encryption_key_invalid');
  }
  return crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/** Returns "<base64 iv>.<base64 ciphertext>". */
export async function encryptSecret(plaintext: string, rawKey: string | undefined): Promise<string> {
  const key = await importKey(rawKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(plaintext);
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
  return `${bytesToB64(iv)}.${bytesToB64(new Uint8Array(cipher))}`;
}

export async function decryptSecret(stored: string, rawKey: string | undefined): Promise<string> {
  const key = await importKey(rawKey);
  const [ivB64, dataB64] = stored.split('.');
  if (!ivB64 || !dataB64) {
    throw new AppError('儲存的 Jira Token 已毀損，請到「Jira 連線設定」重新輸入一次。', 500, 'secret_corrupt');
  }
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: b64ToBytes(ivB64) },
      key,
      b64ToBytes(dataB64)
    );
    return new TextDecoder().decode(plain);
  } catch {
    throw new AppError(
      '無法解開已儲存的 Jira Token（加密金鑰可能已更換），請重新輸入一次。',
      500,
      'secret_undecryptable'
    );
  }
}

/** What the browser is allowed to see: ATATT****k3f9 */
export function maskSecret(plainLength: number, tail = ''): string {
  if (!plainLength) return '';
  return `${'•'.repeat(Math.min(8, Math.max(4, plainLength - 4)))}${tail}`;
}

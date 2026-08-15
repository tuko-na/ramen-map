/**
 * utils.js
 * パイプライン全体で利用する共通ヘルパー関数
 */

import { writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * プロセス強制終了時の破損を防ぐアトミックなJSON保存
 * @param {string} filePath - 保存先パス
 * @param {Object} data - 保存するデータ
 */
export function writeJsonAtomic(filePath, data) {
  const tmpPath = `${filePath}.tmp`;
  const dir = dirname(filePath);
  
  // ディレクトリが存在しない場合は作成
  mkdirSync(dir, { recursive: true });

  // 1. 一時ファイルに書き込む
  writeFileSync(tmpPath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  
  // 2. OSレベルのアトミック操作でファイルを置き換える
  renameSync(tmpPath, filePath);
}

/**
 * Gemini 等が返すマークダウン記法を取り除き、安全に JSON をパースする
 * @param {string} text - JSON文字列（マークダウンを含む可能性がある）
 * @returns {Object} パース済みのオブジェクト
 */
export function parseSafeJson(text) {
  // コードブロックのバッククォートを除去
  const cleanedText = text.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
  
  try {
    return JSON.parse(cleanedText);
  } catch (err) {
    throw new Error(`JSONパースエラー: ${err.message}\n元テキスト: ${text}`);
  }
}

/**
 * 非同期関数のリトライ処理（Exponential Backoff）
 * @param {Function} fn - 実行する非同期関数
 * @param {number} [maxRetries=3] - 最大リトライ回数
 * @param {number} [baseDelayMs=1000] - 基本の待機時間（ミリ秒）
 * @returns {Promise<any>}
 */
export async function withRetry(fn, maxRetries = 3, baseDelayMs = 1000) {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      attempt++;
      const safeMsg = redactSecrets(err.message);
      if (attempt > maxRetries) {
        throw new Error(`[Retry] ${maxRetries}回のリトライに失敗しました: ${safeMsg}`);
      }
      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      console.warn(`[Retry] エラー発生。${delay}ms 後に再試行します (${attempt}/${maxRetries}): ${safeMsg}`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

/**
 * 文字列中のAPIキー・トークンを伏せ字にするサニタイザー
 *
 * URLクエリパラメータ（?key=...&token=...）と、
 * よくある "key: ..." 形式の文字列の両方に対応する。
 *
 * @param {string} text - サニタイズ対象の文字列
 * @returns {string} キー部分が [REDACTED] に置換された文字列
 */
export function redactSecrets(text) {
  if (!text || typeof text !== 'string') return text || '';

  // URLクエリパラメータ: ?key=VALUE&token=VALUE 等
  let sanitized = text.replace(
    /([?&](?:key|token|secret|api_?key|access_?token|password))=([^&\s]+)/gi,
    '$1=[REDACTED]'
  );

  // ヘッダー風の表記: "X-Goog-Api-Key: VALUE" 等
  sanitized = sanitized.replace(
    /((?:api[_-]?key|token|secret|authorization|x-goog-api-key)\s*[:=]\s*)(\S+)/gi,
    '$1[REDACTED]'
  );

  return sanitized;
}

/**
 * エラーオブジェクトからログ出力に安全なメッセージを生成する
 * err 全体を出力する代わりに、message のみを抽出しサニタイズする。
 *
 * @param {Error|string} err - エラーオブジェクトまたはメッセージ文字列
 * @returns {string} サニタイズ済みのエラーメッセージ
 */
export function safeErrorMessage(err) {
  if (!err) return '(不明なエラー)';
  const msg = typeof err === 'string' ? err : (err.message || String(err));
  return redactSecrets(msg);
}

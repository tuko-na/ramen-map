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
 * Gemini API 呼び出し間隔を制御するスロットル
 *
 * 従量課金プラン: 1000RPM 以上のため、連射防止の最低間隔のみ保証する。
 * 万が一のバグによる無限ループに備え、1パイプライン実行あたりの
 * 呼び出し上限（安全ブレーキ）も設ける。
 *
 * 使い方: Gemini の generateContent を呼ぶ前に await geminiThrottle() する
 */
let _lastGeminiCallMs = 0;
let _geminiCallCount = 0;
const GEMINI_MIN_INTERVAL_MS = 1000; // 1秒（連射防止）
const GEMINI_MAX_CALLS_PER_RUN = 200; // 安全ブレーキ: 1実行あたりの上限

export async function geminiThrottle() {
  _geminiCallCount++;
  if (_geminiCallCount > GEMINI_MAX_CALLS_PER_RUN) {
    throw new Error(
      `[安全ブレーキ] Gemini API 呼び出しが ${GEMINI_MAX_CALLS_PER_RUN} 回を超えました。` +
      `無限ループの可能性があるため強制停止します。`
    );
  }
  const now = Date.now();
  const elapsed = now - _lastGeminiCallMs;
  if (_lastGeminiCallMs > 0 && elapsed < GEMINI_MIN_INTERVAL_MS) {
    const wait = GEMINI_MIN_INTERVAL_MS - elapsed;
    await new Promise(resolve => setTimeout(resolve, wait));
  }
  _lastGeminiCallMs = Date.now();
}

/**
 * 非同期関数のリトライ処理（レートリミット対応）
 *
 * - 429 応答に含まれる retryDelay を解析し、API が指定した秒数だけ待つ
 * - 429 / 503 はレートリミット起因のため、通常リトライとは別に最大5回まで再試行する
 * - それ以外のエラーは従来通り maxRetries 回で打ち切る
 *
 * @param {Function} fn - 実行する非同期関数
 * @param {number} [maxRetries=3] - 通常エラーの最大リトライ回数
 * @param {number} [baseDelayMs=1000] - 通常エラーの基本待機時間（ミリ秒）
 * @returns {Promise<any>}
 */
export async function withRetry(fn, maxRetries = 3, baseDelayMs = 1000) {
  const MAX_RATE_LIMIT_RETRIES = 5;
  let attempt = 0;
  let rateLimitAttempt = 0;

  while (true) {
    try {
      return await fn();
    } catch (err) {
      const safeMsg = redactSecrets(err.message || String(err));
      const isRateLimit = /429|RESOURCE_EXHAUSTED|503|UNAVAILABLE/i.test(err.message || '');

      if (isRateLimit) {
        rateLimitAttempt++;
        if (rateLimitAttempt > MAX_RATE_LIMIT_RETRIES) {
          throw new Error(`[Retry] レートリミット ${MAX_RATE_LIMIT_RETRIES}回のリトライに失敗しました: ${safeMsg}`);
        }
        // API の retryDelay を解析（"retryDelay":"19s" や "Please retry in 19.54s" 等）
        const apiDelay = parseRetryDelay(err.message || '');
        // API 指定があればそれ + 2秒のバッファ、なければ15秒固定
        const delay = apiDelay ? (apiDelay + 2) * 1000 : 15000;
        console.warn(`[Retry] レートリミット。${Math.round(delay / 1000)}秒後に再試行します (${rateLimitAttempt}/${MAX_RATE_LIMIT_RETRIES}): ${safeMsg}`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        attempt++;
        if (attempt > maxRetries) {
          throw new Error(`[Retry] ${maxRetries}回のリトライに失敗しました: ${safeMsg}`);
        }
        const delay = baseDelayMs * Math.pow(2, attempt - 1);
        console.warn(`[Retry] エラー発生。${delay}ms 後に再試行します (${attempt}/${maxRetries}): ${safeMsg}`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
}

/**
 * エラーメッセージから API が指定するリトライ待機秒数を抽出する
 * @param {string} message - エラーメッセージ
 * @returns {number|null} 秒数（小数点以下切り上げ）、見つからなければ null
 */
function parseRetryDelay(message) {
  // "retryDelay":"19s" パターン
  const match1 = message.match(/retryDelay["\s:]+(\d+(?:\.\d+)?)\s*s/i);
  if (match1) return Math.ceil(parseFloat(match1[1]));

  // "Please retry in 19.542367176s" パターン
  const match2 = message.match(/retry\s+in\s+(\d+(?:\.\d+)?)\s*s/i);
  if (match2) return Math.ceil(parseFloat(match2[1]));

  return null;
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

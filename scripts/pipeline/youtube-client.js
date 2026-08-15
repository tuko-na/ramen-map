/**
 * youtube-client.js
 * YouTube Data API v3 による動画片方向逆引き
 *
 * 責務:
 *   - 確定した店名で "SUSURU TV {店名}" を YouTube 検索
 *   - 一致する動画があれば youtubeUrl を返却、なければ null
 *   - 既に youtubeUrl が設定されている場合は API 呼び出し自体をスキップ（クォータ節約）
 *
 * 環境変数:
 *   YOUTUBE_API_KEY - YouTube Data API v3 キー
 */

import { safeErrorMessage } from './utils.js';

const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';

/**
 * SUSURU TV のチャンネルで店名に一致する動画を検索する
 * @param {string} shopName - 確定した店舗名
 * @param {string|null} existingYoutubeUrl - 既存の youtubeUrl（設定済みならスキップ）
 * @returns {Promise<string|null>} YouTube 動画 URL または null
 */
export async function findYoutubeVideo(shopName, existingYoutubeUrl) {
  // 既に URL が設定済みの場合はスキップ（クォータ節約）
  if (existingYoutubeUrl) {
    console.log(`[youtube] youtubeUrl 設定済み。スキップします: ${existingYoutubeUrl}`);
    return existingYoutubeUrl;
  }

  const apiKey = process.env.YOUTUBE_API_KEY;

  if (!apiKey) {
    console.warn('[youtube] YOUTUBE_API_KEY が未設定です。スキップします。');
    return null;
  }

  const query = `SUSURU TV ${shopName}`;
  console.log(`[youtube] 検索: "${query}"`);

  const params = new URLSearchParams({
    part: 'snippet',
    q: query,
    type: 'video',
    maxResults: '3',
    key: apiKey,
  });

  const res = await fetch(`${YOUTUBE_API_BASE}/search?${params}`);

  if (!res.ok) {
    console.warn(`[youtube] API エラー: ${res.status}`);
    return null;
  }

  const data = await res.json();
  const items = data.items || [];

  if (items.length === 0) {
    console.log('[youtube] 該当動画なし');
    return null;
  }

  // 最も関連度の高い最初の結果を使用
  const videoId = items[0].id?.videoId;
  if (!videoId) {
    console.log('[youtube] videoId を取得できませんでした');
    return null;
  }

  const url = `https://www.youtube.com/watch?v=${videoId}`;
  console.log(`[youtube] 動画発見: ${url}`);
  return url;
}

// --- 単体テスト用エントリーポイント ---
if (import.meta.url === `file://${process.argv[1]}`) {
  import('dotenv').then(d => d.config());
  setTimeout(async () => {
    try {
      // テスト1: 新規検索
      console.log('\n=== テスト1: 新規検索 ===');
      const r1 = await findYoutubeVideo('中華そば しば田', null);
      console.log('結果:', r1);

      // テスト2: 設定済みスキップ
      console.log('\n=== テスト2: 設定済みスキップ ===');
      const r2 = await findYoutubeVideo('麺屋武蔵', 'https://www.youtube.com/watch?v=existing');
      console.log('結果:', r2);
    } catch (err) {
      console.error('エラー:', safeErrorMessage(err));
      process.exit(1);
    }
  }, 100);
}

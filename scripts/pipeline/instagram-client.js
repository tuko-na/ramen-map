/**
 * instagram-client.js
 * Apify 経由で SUSURU の Instagram 最新投稿を取得する
 *
 * 責務:
 *   - Apify の Instagram Scraper を呼び出し、最新投稿データを取得
 *   - 各投稿から必要なフィールド（id, url, caption, hashtags, timestamp, locationName）を正規化して返却
 *
 * 環境変数:
 *   APIFY_API_TOKEN - Apify API トークン
 */

import { ApifyClient } from 'apify-client';

/** SUSURU の Instagram ユーザー名 */
const SUSURU_USERNAME = 'susuru_tv';

/** Apify Instagram Scraper のアクター ID */
const ACTOR_ID = 'apify/instagram-post-scraper';

/**
 * Apify から SUSURU の最新投稿を取得する
 * @param {Object} options
 * @param {number} [options.maxPosts=20] - 取得する最大投稿数
 * @returns {Promise<Array<Object>>} 正規化された投稿データの配列
 */
export async function fetchLatestPosts({ maxPosts = 20 } = {}) {
  const token = process.env.APIFY_API_TOKEN;

  if (!token) {
    console.warn('[instagram-client] APIFY_API_TOKEN が未設定です。モックデータを返します。');
    return getMockPosts();
  }

  const client = new ApifyClient({ token });

  console.log(`[instagram-client] Apify でSUSURUの最新 ${maxPosts} 件を取得中...`);

  const run = await client.actor(ACTOR_ID).call({
    directUrls: [`https://www.instagram.com/${SUSURU_USERNAME}/`],
    resultsLimit: maxPosts,
    resultsType: 'posts',
    addParentData: false,
  });

  const { items } = await client.dataset(run.defaultDatasetId).listItems();

  console.log(`[instagram-client] ${items.length} 件の投稿を取得しました。`);

  return items.map(normalizePost);
}

/**
 * Apify のレスポンスから必要なフィールドを正規化する
 * @param {Object} item - Apify の生レスポンスアイテム
 * @returns {Object} 正規化された投稿オブジェクト
 */
function normalizePost(item) {
  return {
    /** Instagram 投稿 ID (重複チェック用。"ig_" プレフィックス付与) */
    postId: `ig_${item.id || item.shortCode}`,
    /** 投稿 URL */
    postUrl: item.url || `https://www.instagram.com/p/${item.shortCode}/`,
    /** キャプション本文 */
    caption: item.caption || '',
    /** ハッシュタグ配列 */
    hashtags: item.hashtags || extractHashtags(item.caption || ''),
    /** 投稿日時 (ISO 8601) */
    timestamp: item.timestamp || item.takenAt || null,
    /**
     * 位置情報タグ (Apify レスポンスに含まれるか要検証)
     * Instagram の「場所」タグが付与されている場合に取得可能
     */
    locationName: item.locationName || item.location?.name || null,
  };
}

/**
 * キャプション本文からハッシュタグを抽出する（フォールバック）
 * @param {string} caption
 * @returns {string[]}
 */
function extractHashtags(caption) {
  const matches = caption.match(/#[\w\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]+/g);
  return matches || [];
}

/**
 * APIキー未設定時のモックデータ
 * @returns {Array<Object>}
 */
function getMockPosts() {
  return [
    {
      postId: 'ig_mock_001',
      postUrl: 'https://www.instagram.com/p/MOCK001/',
      caption: '今日は東京・新宿にある麺屋武蔵 新宿本店さんへ！\n濃厚なつけ汁が絡む太麺が最高！\nこれは超うまい！\n\n#ラーメン #新宿 #つけ麺 #麺屋武蔵',
      hashtags: ['#ラーメン', '#新宿', '#つけ麺', '#麺屋武蔵'],
      timestamp: new Date().toISOString(),
      locationName: '麺屋武蔵 新宿本店',
    },
    {
      postId: 'ig_mock_002',
      postUrl: 'https://www.instagram.com/p/MOCK002/',
      caption: '渋谷にある中華そば しば田さん！\n鶏と魚介のWスープが繊細で超超うまい！\nTRY2023名店部門受賞の実力は本物！\n\n#ラーメン #渋谷 #醤油ラーメン #しば田 #TRYラーメン大賞',
      hashtags: ['#ラーメン', '#渋谷', '#醤油ラーメン', '#しば田', '#TRYラーメン大賞'],
      timestamp: new Date().toISOString(),
      locationName: null,
    },
    {
      postId: 'ig_mock_003',
      postUrl: 'https://www.instagram.com/p/MOCK003/',
      caption: 'SUSURUグッズ第3弾、本日から予約受付開始！\n詳しくはプロフィールのリンクから🔗\n\n#SUSURUTV #グッズ',
      hashtags: ['#SUSURUTV', '#グッズ'],
      timestamp: new Date().toISOString(),
      locationName: null,
    },
  ];
}

// --- 単体テスト用エントリーポイント ---
if (import.meta.url === `file://${process.argv[1]}`) {
  import('dotenv').then(d => d.config());
  // dotenv の読み込み完了を待つ
  setTimeout(async () => {
    try {
      const posts = await fetchLatestPosts({ maxPosts: 5 });
      console.log('\n=== 取得結果 ===');
      console.log(JSON.stringify(posts, null, 2));
    } catch (err) {
      const { safeErrorMessage } = await import('./utils.js');
      console.error('エラー:', safeErrorMessage(err));
      process.exit(1);
    }
  }, 100);
}

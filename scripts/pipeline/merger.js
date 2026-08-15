/**
 * merger.js
 * placeId に基づく GeoJSON 名寄せ (Upsert)
 *
 * 責務:
 *   - placeId をキーに ramen-shops.json (GeoJSON FeatureCollection) へ Upsert
 *   - 既存店舗（再訪問）: 最新投稿の値で項目を上書きし、processedIds に postId を追加
 *   - 新規店舗: 新しい Feature オブジェクトを作成して追加
 *
 * Upsert 項目別ルール (GEMINI.md セクション5.1):
 *   - rating: 最新投稿の評価で上書き
 *   - processedIds: 新 postId を既存配列へ追記（上書きではない）
 *   - instagramUrl: 最新の投稿URLに更新
 *   - youtubeUrl: 既存値があればそのまま保持（API呼び出しスキップは youtube-client.js で実施済み）
 *   - entryMethod / ticketBuy / 設備タグ等: 新投稿で not null の値が得られた場合のみ更新
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { writeJsonAtomic } from './utils.js';

/** ramen-shops.json のパス */
const DATA_PATH = resolve(import.meta.dirname, '../../public/data/ramen-shops.json');

/**
 * GeoJSON FeatureCollection を読み込む
 * @returns {Object} GeoJSON FeatureCollection
 */
export function loadShopData() {
  try {
    const raw = readFileSync(DATA_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return { type: 'FeatureCollection', features: [] };
  }
}

/**
 * GeoJSON FeatureCollection を保存する
 * @param {Object} geojson
 */
export function saveShopData(geojson) {
  writeJsonAtomic(DATA_PATH, geojson);
  console.log(`[merger] ramen-shops.json を保存しました (${geojson.features.length} 件)`);
}

/**
 * 全 processedIds を収集する（重複チェック用）
 * @param {Object} geojson
 * @returns {Set<string>}
 */
export function getAllProcessedIds(geojson) {
  const ids = new Set();
  for (const feature of geojson.features) {
    const pids = feature.properties?.processedIds;
    if (Array.isArray(pids)) {
      pids.forEach(id => ids.add(id));
    }
  }
  return ids;
}

/**
 * 店舗データを GeoJSON に Upsert する
 * @param {Object} geojson - 既存の GeoJSON FeatureCollection
 * @param {Object} shopData - Upsert するデータ
 * @param {string} shopData.placeId - Google Place ID (主キー)
 * @param {string} shopData.postId - Instagram 投稿 ID
 * @param {string} shopData.postUrl - Instagram 投稿 URL
 * @param {string} shopData.name - 店舗名
 * @param {string} shopData.address - 住所
 * @param {number} shopData.lat - 緯度
 * @param {number} shopData.lng - 経度
 * @param {string|null} shopData.rating - 味の評価
 * @param {Array} shopData.genre - ジャンル
 * @param {Object|null} shopData.try - TRY受賞歴
 * @param {Object|null} shopData.hours - 営業時間
 * @param {string|null} shopData.entryMethod - 入店方式
 * @param {string|null} shopData.ticketBuy - 食券購入タイミング
 * @param {boolean|null} shopData.cashless
 * @param {boolean|null} shopData.parking
 * @param {boolean|null} shopData.tableSeating
 * @param {boolean|null} shopData.nonsmoking
 * @param {string} shopData.googleMapsUrl
 * @param {string|null} shopData.youtubeUrl
 * @returns {Object} 更新後の GeoJSON FeatureCollection
 */
export function upsertShop(geojson, shopData) {
  const existingIndex = geojson.features.findIndex(
    f => f.properties?.id === shopData.placeId
  );

  if (existingIndex >= 0) {
    // === 既存店舗: 再訪問 Upsert ===
    console.log(`[merger] 再訪問: "${shopData.name}" (${shopData.placeId})`);
    const existing = geojson.features[existingIndex];
    const props = existing.properties;

    // rating: 最新投稿の評価で上書き
    props.rating = shopData.rating;

    // instagramUrl: 最新の投稿URLに更新
    props.instagramUrl = shopData.postUrl;

    // processedIds: 新 postId を追記（上書きではなくpush）
    if (!Array.isArray(props.processedIds)) {
      props.processedIds = [];
    }
    if (!props.processedIds.includes(shopData.postId)) {
      // 参照渡し防止のためスプレッド構文で再生成
      props.processedIds = [...props.processedIds, shopData.postId];
    }

    // entryMethod / ticketBuy / 設備タグ: not null の場合のみ更新
    if (shopData.entryMethod !== null) props.entryMethod = shopData.entryMethod;
    if (shopData.ticketBuy !== null) props.ticketBuy = shopData.ticketBuy;
    if (shopData.cashless !== null) props.cashless = shopData.cashless;
    if (shopData.parking !== null) props.parking = shopData.parking;
    if (shopData.tableSeating !== null) props.tableSeating = shopData.tableSeating;
    if (shopData.nonsmoking !== null) props.nonsmoking = shopData.nonsmoking;

    // genre: 重複を排除してマージ（配列の結合）
    if (shopData.genre && shopData.genre.length > 0) {
      const existingGenres = props.genre || [];
      // Set を用いて重複を排除した新しい配列を生成
      props.genre = Array.from(new Set([...existingGenres, ...shopData.genre]));
    }

    // try: 新しい値があれば更新
    if (shopData.try !== null) {
      props.try = shopData.try;
    }

    // youtubeUrl: 値が渡された場合のみ更新（既存値は保持）
    if (shopData.youtubeUrl && !props.youtubeUrl) {
      props.youtubeUrl = shopData.youtubeUrl;
    }

  } else {
    // === 新規店舗: Feature を追加 ===
    console.log(`[merger] 新規追加: "${shopData.name}" (${shopData.placeId})`);

    const newFeature = {
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [shopData.lng, shopData.lat],
      },
      properties: {
        id: shopData.placeId,
        name: shopData.name,
        address: shopData.address,
        rating: shopData.rating,
        genre: shopData.genre || [],
        try: shopData.try || null,
        hours: shopData.hours || null,
        entryMethod: shopData.entryMethod || null,
        ticketBuy: shopData.ticketBuy || null,
        cashless: shopData.cashless ?? null,
        parking: shopData.parking ?? null,
        tableSeating: shopData.tableSeating ?? null,
        nonsmoking: shopData.nonsmoking ?? null,
        googleMapsUrl: shopData.googleMapsUrl,
        youtubeUrl: shopData.youtubeUrl || null,
        instagramUrl: shopData.postUrl || null,
        processedIds: [shopData.postId],
      },
    };

    geojson.features.push(newFeature);
  }

  return geojson;
}

// --- 単体テスト用エントリーポイント ---
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('\n=== merger.js 単体テスト ===');

  // テスト用の一時データで動作確認
  let testGeo = { type: 'FeatureCollection', features: [] };

  // テスト1: 新規追加
  console.log('\n--- テスト1: 新規追加 ---');
  testGeo = upsertShop(testGeo, {
    placeId: 'ChIJ_test_001',
    postId: 'ig_test_001',
    postUrl: 'https://www.instagram.com/p/TEST001/',
    name: 'テストラーメン店',
    address: '東京都テスト区',
    lat: 35.68,
    lng: 139.76,
    rating: '超うまい',
    genre: ['醤油'],
    try: null,
    hours: null,
    entryMethod: '並び順',
    ticketBuy: '先買い',
    cashless: true,
    parking: false,
    tableSeating: true,
    nonsmoking: true,
    googleMapsUrl: 'https://www.google.com/maps/place/?q=place_id:ChIJ_test_001',
    youtubeUrl: null,
  });
  console.log(`features 数: ${testGeo.features.length}`);
  console.log(`processedIds: ${JSON.stringify(testGeo.features[0].properties.processedIds)}`);

  // テスト2: 再訪問 Upsert
  console.log('\n--- テスト2: 再訪問 Upsert ---');
  testGeo = upsertShop(testGeo, {
    placeId: 'ChIJ_test_001',
    postId: 'ig_test_002',
    postUrl: 'https://www.instagram.com/p/TEST002/',
    name: 'テストラーメン店',
    address: '東京都テスト区',
    lat: 35.68,
    lng: 139.76,
    rating: 'ちょめめ',        // 評価が上がった
    genre: ['醤油', 'つけ麺'], // ジャンル追加
    try: null,
    hours: null,
    entryMethod: null,          // null → 既存値を保持
    ticketBuy: null,            // null → 既存値を保持
    cashless: null,
    parking: null,
    tableSeating: null,
    nonsmoking: null,
    googleMapsUrl: 'https://www.google.com/maps/place/?q=place_id:ChIJ_test_001',
    youtubeUrl: 'https://www.youtube.com/watch?v=new_video',
  });
  const props = testGeo.features[0].properties;
  console.log(`features 数: ${testGeo.features.length} (追加ではなく更新)`);
  console.log(`rating: ${props.rating} (ちょめめ に更新されたはず)`);
  console.log(`processedIds: ${JSON.stringify(props.processedIds)} (2件あるはず)`);
  console.log(`entryMethod: ${props.entryMethod} (並び順 が保持されたはず)`);
  console.log(`youtubeUrl: ${props.youtubeUrl} (新規設定されたはず)`);
}

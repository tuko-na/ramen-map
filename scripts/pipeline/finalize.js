/**
 * finalize.js
 * 店舗情報の最終確定フロー（補完、営業時間取得、YouTube検索、保存）を統一管理
 */

import { enrichNullFields } from './enricher.js';
import { fetchOpeningHours, buildGoogleMapsUrl } from './geocoder.js';
import { findYoutubeVideo } from './youtube-client.js';
import { upsertShop, loadShopData, saveShopData } from './merger.js';
import { withRetry } from './utils.js';

/**
 * 未確定の店舗データと位置情報を確定させ、ramen-shops.json へ保存する
 * @param {Object} post - 元の投稿オブジェクト
 * @param {Object} extracted - Geminiから抽出された店舗データ
 * @param {Object} resolvedPlace - Places API から確定した位置情報 (placeId, lat, lng, name, address)
 * @returns {Promise<Object>} 確定したFeatureオブジェクト
 */
export async function finalizeShop(post, extracted, resolvedPlace) {
  console.log(`[finalize] ${extracted.name} の確定フローを開始します`);

  // 1. null項目の補完
  const enriched = await enrichNullFields(post.caption, extracted);

  // 2. 営業時間の取得 (新規のみ)
  let hours = null;
  const geojson = loadShopData();
  const existingFeature = geojson.features.find(f => f.properties.id === resolvedPlace.placeId);
  
  if (!existingFeature || !existingFeature.properties.hours) {
    hours = await withRetry(() => fetchOpeningHours(resolvedPlace.placeId));
  } else {
    hours = existingFeature.properties.hours;
  }

  // 3. YouTube 動画の検索 (新規のみ)
  let youtubeUrl = null;
  if (!existingFeature || !existingFeature.properties.youtubeUrl) {
    youtubeUrl = await withRetry(() => findYoutubeVideo(extracted.name));
  } else {
    youtubeUrl = existingFeature.properties.youtubeUrl;
  }

  // 4. データ結合と保存
  const shopData = {
    postId: post.postId,
    postUrl: post.postUrl,
    placeId: resolvedPlace.placeId,
    name: resolvedPlace.name,
    address: resolvedPlace.address,
    lat: resolvedPlace.lat,
    lng: resolvedPlace.lng,
    rating: enriched.rating,
    genre: enriched.genre,
    try: enriched.try,
    hours,
    entryMethod: enriched.entryMethod,
    ticketBuy: enriched.ticketBuy,
    cashless: enriched.cashless,
    parking: enriched.parking,
    tableSeating: enriched.tableSeating,
    nonsmoking: enriched.nonsmoking,
    googleMapsUrl: buildGoogleMapsUrl(resolvedPlace.placeId),
    youtubeUrl,
  };

  const updatedGeojson = upsertShop(geojson, shopData);
  saveShopData(updatedGeojson);
  
  console.log(`[finalize] ${extracted.name} の確定フローが完了しました`);
  return shopData;
}

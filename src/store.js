/**
 * Global Store for State Management (Single Source of Truth)
 */
import { toggleFavorite as toggleFavoriteStorage, getFavorites, toggleVisited as toggleVisitedStorage, getVisited } from './favorites.js';
import { enrichWithOpenStatus } from './opening-hours.js';

// --- State ---
const state = {
  rawData: null, // 生の GeoJSON (FeatureCollection)
  favorites: new Set(getFavorites()),
  visited: new Set(getVisited()), // 訪問済みリストを追加
  filters: {
    openOnly: false,
    unvisitedOnly: false,
    tryOnly: false,
    ratings: new Set(),
    genres: new Set(),
    entries: new Set(),
    tickets: new Set(),
    facilities: new Set(),
  },
  searchQuery: '',
  activeShopId: null, // ボトムシートで選択中の店舗ID
};

// --- Pub/Sub ---
const listeners = new Set();

function notify() {
  const derived = getDerivedData();
  
  // アクティブな店舗が表示対象から外れた場合はシートを閉じる(nullにする)
  if (state.activeShopId) {
    const isVisible = derived.features.some(f => f.properties.id === state.activeShopId);
    if (!isVisible) {
      state.activeShopId = null;
    }
  }

  listeners.forEach(listener => listener(state, derived));
}

export function subscribe(listener) {
  listeners.add(listener);
  // 初回呼び出し
  listener(state, getDerivedData());
  return () => listeners.delete(listener);
}

export function getState() {
  return state;
}

// --- Actions ---

/**
 * データを初期セットまたは更新する
 */
export function setRawData(geoJson) {
  state.rawData = enrichWithOpenStatus(geoJson);
  notify();
}

/**
 * 営業状態（1分ごとの更新用）を再計算する
 * フィルター状態は維持される
 */
export function updateOpenStatus() {
  if (!state.rawData) return;
  
  const oldFeatures = state.rawData.features;
  const newData = enrichWithOpenStatus(state.rawData);
  
  // 変更があったかどうかの差分チェック
  let hasChanges = false;
  for (let i = 0; i < oldFeatures.length; i++) {
    const oldProps = oldFeatures[i].properties;
    const newProps = newData.features[i].properties;
    if (oldProps.isOpenNow !== newProps.isOpenNow || oldProps.openStatus !== newProps.openStatus) {
      hasChanges = true;
      break;
    }
  }

  if (hasChanges) {
    state.rawData = newData;
    notify();
  }
}

/**
 * フィルター状態を完全に上書きする
 */
export function setFilters(newFilters) {
  state.filters = newFilters;
  notify();
}

/**
 * 検索クエリを更新する
 */
export function setSearchQuery(query) {
  state.searchQuery = query;
  notify();
}

/**
 * お気に入りをトグルする
 */
export function toggleFavorite(shopId) {
  toggleFavoriteStorage(shopId);
  state.favorites = new Set(getFavorites());
  notify();
}

/**
 * 訪問済みをトグルする
 */
export function toggleVisited(shopId) {
  toggleVisitedStorage(shopId);
  state.visited = new Set(getVisited());
  notify();
}

/**
 * 選択中の店舗（ボトムシート用）を更新する
 */
export function setActiveShopId(shopId) {
  state.activeShopId = shopId;
  notify();
}

// --- Getters ---

/**
 * 現在のフィルターと検索条件を適用した最終的な GeoJSON を計算して返す
 */
export function getDerivedData() {
  if (!state.rawData) return { type: 'FeatureCollection', features: [] };

  // 1. フィルター適用
  let features = state.rawData.features.filter(feature => {
    const props = feature.properties;
    const f = state.filters;

    if (f.openOnly && !props.isOpenNow) return false;
    
    // 未訪問フィルターは visited を見る
    if (f.unvisitedOnly && state.visited.has(props.id)) return false; 

    if (f.tryOnly) {
      const hasTry = (props.try && props.try !== 'null') || (props.sry && props.sry !== 'null');
      if (!hasTry) return false;
    }

    if (f.ratings.size > 0 && !f.ratings.has(props.rating)) return false;

    if (f.genres.size > 0) {
      let genres = props.genre;
      if (typeof genres === 'string') {
        try { genres = JSON.parse(genres); } catch { genres = []; }
      }
      if (!Array.isArray(genres)) genres = [];
      if (!genres.some(g => f.genres.has(g))) return false;
    }

    if (f.entries.size > 0 && !f.entries.has(props.entryMethod)) return false;
    if (f.tickets.size > 0 && !f.tickets.has(props.ticketBuy)) return false;

    if (f.facilities.size > 0) {
      for (const fac of f.facilities) {
        if (props[fac] !== true) return false;
      }
    }

    return true;
  });

  return { type: 'FeatureCollection', features };
}

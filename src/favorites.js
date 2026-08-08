/**
 * お気に入り & 訪問管理 (localStorage)
 */

const STORAGE_KEYS = {
  favorites: 'ramen-map-favorites',
  visited: 'ramen-map-visited',
};

/**
 * localStorageからセットを読み込む
 * @param {string} key
 * @returns {Set<string>}
 */
function loadSet(key) {
  try {
    const data = localStorage.getItem(key);
    if (data) {
      return new Set(JSON.parse(data));
    }
  } catch {
    // localStorage 非対応やパースエラー時
  }
  return new Set();
}

/**
 * セットをlocalStorageに保存する
 * @param {string} key
 * @param {Set<string>} set
 */
function saveSet(key, set) {
  try {
    localStorage.setItem(key, JSON.stringify([...set]));
  } catch {
    // クォータ超過等を無視
  }
}

/** お気に入りセット */
let favorites = loadSet(STORAGE_KEYS.favorites);

/** 訪問済みセット */
let visited = loadSet(STORAGE_KEYS.visited);

// ===== お気に入り =====

/**
 * お気に入りかどうかを判定する
 * @param {string} shopId
 * @returns {boolean}
 */
export function isFavorite(shopId) {
  return favorites.has(shopId);
}

/**
 * お気に入りをトグルする
 * @param {string} shopId
 * @returns {boolean} - トグル後の状態
 */
export function toggleFavorite(shopId) {
  if (favorites.has(shopId)) {
    favorites.delete(shopId);
  } else {
    favorites.add(shopId);
  }
  saveSet(STORAGE_KEYS.favorites, favorites);
  return favorites.has(shopId);
}

/**
 * お気に入り一覧を取得する
 * @returns {string[]}
 */
export function getFavorites() {
  return [...favorites];
}

// ===== 訪問済み =====

/**
 * 訪問済みかどうかを判定する
 * @param {string} shopId
 * @returns {boolean}
 */
export function isVisited(shopId) {
  return visited.has(shopId);
}

/**
 * 訪問済みをトグルする
 * @param {string} shopId
 * @returns {boolean} - トグル後の状態
 */
export function toggleVisited(shopId) {
  if (visited.has(shopId)) {
    visited.delete(shopId);
  } else {
    visited.add(shopId);
  }
  saveSet(STORAGE_KEYS.visited, visited);
  return visited.has(shopId);
}

/**
 * 訪問済み一覧を取得する
 * @returns {string[]}
 */
export function getVisited() {
  return [...visited];
}

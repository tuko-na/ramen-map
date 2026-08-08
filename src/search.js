/**
 * Fuse.js による店舗あいまい検索
 */
import Fuse from 'fuse.js';

/** @type {Fuse|null} */
let fuse = null;

const searchInput = document.getElementById('search-input');
const searchClear = document.getElementById('search-clear');
const searchResults = document.getElementById('search-results');

/** @type {Function|null} */
let onSelectCallback = null;

/** 評価ラベルごとの色 */
const RATING_COLORS_MAP = {
  'ちょめめ': '#ffd700',
  '超超うまい': '#ff4444',
  '超うまい': '#ff8c00',
  'うまい': '#ffcc00',
};

/**
 * 検索機能の初期化
 * @param {Array} features - GeoJSON features 配列
 * @param {Function} onSelect - 検索結果選択時のコールバック (feature)
 */
export function initSearch(features, onSelect) {
  onSelectCallback = onSelect;

  // Fuse.js インデックス構築
  const items = features.map(f => ({
    feature: f,
    name: f.properties.name,
    address: f.properties.address,
    genre: Array.isArray(f.properties.genre)
      ? f.properties.genre.join(' ')
      : (f.properties.genre || ''),
    rating: f.properties.rating || '',
  }));

  fuse = new Fuse(items, {
    keys: [
      { name: 'name', weight: 0.6 },
      { name: 'address', weight: 0.2 },
      { name: 'genre', weight: 0.15 },
      { name: 'rating', weight: 0.05 },
    ],
    threshold: 0.4,
    includeScore: true,
    minMatchCharLength: 1,
  });

  // イベント設定
  searchInput.addEventListener('input', handleInput);
  searchInput.addEventListener('focus', () => {
    if (searchInput.value.trim()) {
      handleInput();
    }
  });

  searchClear.addEventListener('click', clearSearch);

  // 地図クリック時に検索結果を閉じる
  document.getElementById('map').addEventListener('click', () => {
    hideResults();
  });
}

/**
 * 入力ハンドラー
 */
function handleInput() {
  const query = searchInput.value.trim();

  if (!query) {
    hideResults();
    searchClear.style.display = 'none';
    return;
  }

  searchClear.style.display = 'flex';

  if (!fuse) return;

  const results = fuse.search(query, { limit: 8 });

  if (results.length === 0) {
    searchResults.innerHTML = '<div class="search-no-results">一致する店舗がありません</div>';
    searchResults.style.display = 'block';
    return;
  }

  searchResults.innerHTML = results.map(result => {
    const props = result.item.feature.properties;
    const ratingColor = RATING_COLORS_MAP[props.rating] || '#888';

    let genres = props.genre;
    if (typeof genres === 'string') {
      try { genres = JSON.parse(genres); } catch { genres = []; }
    }
    const genreText = Array.isArray(genres) ? genres.join('・') : '';

    return `
      <div class="search-result-item" data-id="${props.id}">
        <div class="search-result-icon">🍜</div>
        <div class="search-result-info">
          <div class="search-result-name">${escapeHtml(props.name)}</div>
          <div class="search-result-meta">
            <span class="search-result-rating" style="color: ${ratingColor}">★ ${escapeHtml(props.rating || '')}</span>
            <span>${escapeHtml(genreText)}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');

  // 結果クリックイベント
  searchResults.querySelectorAll('.search-result-item').forEach(item => {
    item.addEventListener('click', () => {
      const id = item.dataset.id;
      const result = results.find(r => r.item.feature.properties.id === id);
      if (result && onSelectCallback) {
        onSelectCallback(result.item.feature);
        hideResults();
        searchInput.value = result.item.feature.properties.name;
      }
    });
  });

  searchResults.style.display = 'block';
}

/**
 * 検索をクリア
 */
function clearSearch() {
  searchInput.value = '';
  searchClear.style.display = 'none';
  hideResults();
  searchInput.focus();
}

/**
 * 検索結果を非表示にする
 */
function hideResults() {
  searchResults.style.display = 'none';
}

/**
 * HTMLエスケープ
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * 検索インデックスを更新する
 * @param {Array} features - 新しい features 配列
 */
export function updateSearchIndex(features) {
  if (!fuse) return;

  const items = features.map(f => ({
    feature: f,
    name: f.properties.name,
    address: f.properties.address,
    genre: Array.isArray(f.properties.genre)
      ? f.properties.genre.join(' ')
      : (f.properties.genre || ''),
    rating: f.properties.rating || '',
  }));

  fuse.setCollection(items);
}

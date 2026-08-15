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
let debounceTimer = null;

/** 評価ラベルごとの色 */
const RATING_COLORS_MAP = {
  'ちょめめ': '#EF9F27',
  '超超うまい': '#D85A30',
  '超うまい': '#F0997B',
  'うまい': '#FAEEDA',
};

/**
 * 検索機能の初期化
 * @param {Function} onSelect - 検索結果選択時のコールバック (feature)
 */
export function initSearch(onSelect) {
  onSelectCallback = onSelect;

  // イベント設定
  searchInput.addEventListener('input', () => {
    // 150ms のデバウンス処理
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(handleInput, 150);
  });
  
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
 * 検索インデックスを更新する
 * Store から derivedData（フィルター適用済み）が流れてきた際に呼ばれる
 * これにより、フィルターと検索の完全な AND 結合が実現される
 * @param {Array} features - フィルター済みの features 配列
 */
export function updateSearchIndex(features) {
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
  
  // インデックス更新時に、現在入力中の文字列があれば再検索してサジェストを更新する
  if (searchInput.value.trim() && searchResults.style.display === 'block') {
    handleInput();
  }
}

/**
 * 入力ハンドラー (デバウンス済み)
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

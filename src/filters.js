/**
 * フィルタリングロジック
 * クイックフィルター + フィルターモーダルの管理
 */
import { isVisited } from './favorites.js';

/**
 * フィルター状態
 */
const state = {
  openOnly: false,
  unvisitedOnly: false,
  sryOnly: false,
  ratings: new Set(),
  genres: new Set(),
  entries: new Set(),
  tickets: new Set(),
  facilities: new Set(),
};

/** @type {Function|null} */
let onChangeCallback = null;

/**
 * フィルターUIの初期化
 * @param {Function} onChange - フィルター変更時のコールバック
 */
export function initFilters(onChange) {
  onChangeCallback = onChange;

  // クイックフィルター
  document.getElementById('filter-open').addEventListener('click', function () {
    state.openOnly = !state.openOnly;
    this.classList.toggle('active', state.openOnly);
    fireChange();
  });

  document.getElementById('filter-unvisited').addEventListener('click', function () {
    state.unvisitedOnly = !state.unvisitedOnly;
    this.classList.toggle('active', state.unvisitedOnly);
    fireChange();
  });

  document.getElementById('filter-sry').addEventListener('click', function () {
    state.sryOnly = !state.sryOnly;
    this.classList.toggle('active', state.sryOnly);
    fireChange();
  });

  // フィルターモーダル開閉
  const modal = document.getElementById('filter-modal');
  const backdrop = document.getElementById('modal-backdrop');

  document.getElementById('filter-toggle').addEventListener('click', () => {
    modal.classList.add('open');
    backdrop.classList.add('open');
  });

  document.getElementById('filter-modal-close').addEventListener('click', closeModal);
  backdrop.addEventListener('click', closeModal);

  document.getElementById('filter-apply').addEventListener('click', () => {
    closeModal();
    fireChange();
  });

  document.getElementById('filter-reset').addEventListener('click', () => {
    resetFilters();
    fireChange();
  });

  function closeModal() {
    modal.classList.remove('open');
    backdrop.classList.remove('open');
  }

  // モーダル内チップトグル
  setupChipGroup('.chip.rating', state.ratings, 'value');
  setupChipGroup('.chip.genre', state.genres, 'value');
  setupChipGroup('.chip.entry', state.entries, 'value');
  setupChipGroup('.chip.ticket', state.tickets, 'value');
  setupChipGroup('.chip.facility', state.facilities, 'value');
}

/**
 * チップグループのトグルを設定
 */
function setupChipGroup(selector, set, dataAttr) {
  document.querySelectorAll(selector).forEach(btn => {
    btn.addEventListener('click', function () {
      const val = this.dataset[dataAttr];
      if (!val) return;
      if (set.has(val)) {
        set.delete(val);
        this.classList.remove('active');
      } else {
        set.add(val);
        this.classList.add('active');
      }
    });
  });
}

function fireChange() {
  if (onChangeCallback) onChangeCallback(state);
}

/**
 * GeoJSONをフィルター状態に基づいて絞り込む
 */
export function applyFilters(geojson, filterState = state) {
  const filtered = geojson.features.filter(feature => {
    const props = feature.properties;

    if (filterState.openOnly && !props.isOpenNow) return false;

    if (filterState.unvisitedOnly && isVisited(props.id)) return false;

    if (filterState.sryOnly) {
      if (!props.sry || props.sry === 'null') return false;
    }

    if (filterState.ratings.size > 0) {
      if (!filterState.ratings.has(props.rating)) return false;
    }

    if (filterState.genres.size > 0) {
      let genres = props.genre;
      if (typeof genres === 'string') {
        try { genres = JSON.parse(genres); } catch { genres = []; }
      }
      if (!Array.isArray(genres)) genres = [];
      if (!genres.some(g => filterState.genres.has(g))) return false;
    }

    if (filterState.entries.size > 0) {
      if (!filterState.entries.has(props.entryMethod)) return false;
    }

    if (filterState.tickets.size > 0) {
      if (!filterState.tickets.has(props.ticketBuy)) return false;
    }

    if (filterState.facilities.size > 0) {
      for (const f of filterState.facilities) {
        if (!props[f]) return false;
      }
    }

    return true;
  });

  return { type: 'FeatureCollection', features: filtered };
}

/**
 * フィルターをリセットする
 */
export function resetFilters() {
  state.openOnly = false;
  state.unvisitedOnly = false;
  state.sryOnly = false;
  state.ratings.clear();
  state.genres.clear();
  state.entries.clear();
  state.tickets.clear();
  state.facilities.clear();

  document.querySelectorAll('.chip.active').forEach(c => c.classList.remove('active'));
}

/**
 * 現在のフィルター状態を取得
 */
export function getFilterState() {
  return { ...state };
}

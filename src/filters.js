/**
 * フィルタリングUIロジック
 */
import { setFilters, getState } from './store.js';

let localFilters = null;

/**
 * フィルターUIの初期化
 */
export function initFilters() {
  const state = getState().filters;

  // クイックフィルター (即座反映)
  setupQuickFilter('filter-open', 'openOnly');
  setupQuickFilter('filter-unvisited', 'unvisitedOnly');
  setupQuickFilter('filter-try', 'tryOnly');
  setupQuickFilter('filter-sry', 'tryOnly'); // 古いID互換用

  function setupQuickFilter(id, stateKey) {
    const el = document.getElementById(id);
    if (!el) return;
    
    // 初期状態の反映
    if (state[stateKey]) el.classList.add('active');

    el.addEventListener('click', function () {
      const currentState = getState().filters[stateKey];
      // 既存のStore状態をマージして更新
      setFilters({ ...getState().filters, [stateKey]: !currentState });
      this.classList.toggle('active', !currentState);
    });
  }

  // フィルターモーダル開閉
  const modal = document.getElementById('filter-modal');
  const backdrop = document.getElementById('modal-backdrop');

  document.getElementById('filter-toggle').addEventListener('click', () => {
    // モーダルを開く際に、現在の Store 状態をローカルにコピーする
    const currentStoreFilters = getState().filters;
    localFilters = {
      ratings: new Set(currentStoreFilters.ratings),
      genres: new Set(currentStoreFilters.genres),
      entries: new Set(currentStoreFilters.entries),
      tickets: new Set(currentStoreFilters.tickets),
      facilities: new Set(currentStoreFilters.facilities),
    };
    
    syncModalUIWithLocalFilters();
    
    modal.classList.add('open');
    backdrop.classList.add('open');
  });

  document.getElementById('filter-modal-close').addEventListener('click', closeModal);
  backdrop.addEventListener('click', closeModal);

  document.getElementById('filter-apply').addEventListener('click', () => {
    // 適用ボタンを押した時に Store へ一括反映
    setFilters({ ...getState().filters, ...localFilters });
    closeModal();
  });

  document.getElementById('filter-reset').addEventListener('click', () => {
    // モーダル内のローカルステートをクリアし、即座に適用して閉じる
    const cleared = {
      ratings: new Set(),
      genres: new Set(),
      entries: new Set(),
      tickets: new Set(),
      facilities: new Set(),
    };
    
    // クイックフィルターのUI状態もリセットする（こちらは即座に外れる）
    document.querySelectorAll('.quick-filter-btn.active').forEach(c => c.classList.remove('active'));
    
    // Store 全体のフィルターをリセット (クイックフィルター込みで全解除)
    setFilters({
      openOnly: false,
      unvisitedOnly: false,
      tryOnly: false,
      ...cleared
    });
    
    syncModalUIWithLocalFilters(cleared);
    closeModal();
  });

  function closeModal() {
    modal.classList.remove('open');
    backdrop.classList.remove('open');
  }

  // モーダル内チップトグル (ローカルステートのみ更新)
  setupChipGroup('.chip.rating', 'ratings');
  setupChipGroup('.chip.genre', 'genres');
  setupChipGroup('.chip.entry', 'entries');
  setupChipGroup('.chip.ticket', 'tickets');
  setupChipGroup('.chip.facility', 'facilities');
}

/**
 * モーダル内のUIを localFilters に同期させる
 */
function syncModalUIWithLocalFilters(filtersToUse) {
  const filters = filtersToUse || localFilters;
  if (!filters) return;
  
  const groups = [
    { selector: '.chip.rating', key: 'ratings' },
    { selector: '.chip.genre', key: 'genres' },
    { selector: '.chip.entry', key: 'entries' },
    { selector: '.chip.ticket', key: 'tickets' },
    { selector: '.chip.facility', key: 'facilities' },
  ];
  
  groups.forEach(group => {
    document.querySelectorAll(group.selector).forEach(btn => {
      const val = btn.dataset.value;
      if (val && filters[group.key].has(val)) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  });
}

/**
 * チップグループのトグルを設定 (ローカルステートに対する操作)
 */
function setupChipGroup(selector, stateKey) {
  document.querySelectorAll(selector).forEach(btn => {
    btn.addEventListener('click', function () {
      if (!localFilters) return;
      const val = this.dataset.value;
      if (!val) return;
      
      const newSet = localFilters[stateKey];
      
      if (newSet.has(val)) {
        newSet.delete(val);
        this.classList.remove('active');
      } else {
        newSet.add(val);
        this.classList.add('active');
      }
    });
  });
}


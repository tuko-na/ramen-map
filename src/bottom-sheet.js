/**
 * ボトムシート (店舗詳細カード) - UIデモ準拠
 */
import { getOpenStatus } from './opening-hours.js';
import { isFavorite, toggleFavorite, isVisited, toggleVisited } from './favorites.js';

const sheet = document.getElementById('bottom-sheet');
const nameEl = document.getElementById('sheet-name');
const badgesEl = document.getElementById('sheet-badges');
const statusRow = document.getElementById('sheet-status-row');
const entryTags = document.getElementById('sheet-entry-tags');
const actionRoute = document.getElementById('sheet-action-route');
const actionInstagram = document.getElementById('sheet-action-instagram');
const actionYoutube = document.getElementById('sheet-action-youtube');
const favoriteBtn = document.getElementById('sheet-favorite');
const visitedBtn = document.getElementById('sheet-visited');

/** @type {Object|null} */
let currentShop = null;

/** 評価色マッピング */
const RATING_STYLES = {
  'ちょめめ': { bg: '#EF9F27', text: '#412402' },
  '超超うまい': { bg: '#D85A30', text: '#4A1B0C' },
  '超うまい': { bg: '#F0997B', text: '#4A1B0C' },
  'うまい': { bg: '#FAEEDA', text: '#633806' },
};

/** ステータス色マッピング */
const STATUS_STYLES = {
  open: { dot: '#1D9E75', text: '#0F6E56', label: '営業中' },
  break: { dot: '#EF9F27', text: '#854F0B', label: '準備中(中休み)' },
  closed: { dot: '#B4B2A9', text: '#5F5E5A', label: '閉店' },
  holiday: { dot: '#B4B2A9', text: '#5F5E5A', label: '本日定休' },
};

/**
 * 初期化
 */
export function initBottomSheet() {
  document.getElementById('sheet-close').addEventListener('click', closeSheet);

  // スワイプダウンで閉じる
  const handle = document.getElementById('sheet-handle');
  if (handle) {
    let startY = 0;
    handle.addEventListener('touchstart', (e) => { startY = e.touches[0].clientY; }, { passive: true });
    handle.addEventListener('touchend', (e) => {
      if (e.changedTouches[0].clientY - startY > 50) closeSheet();
    });
  }

  favoriteBtn.addEventListener('click', () => {
    if (!currentShop) return;
    toggleFavorite(currentShop.properties.id);
    updateFavoriteUI();
  });

  visitedBtn.addEventListener('click', () => {
    if (!currentShop) return;
    toggleVisited(currentShop.properties.id);
    updateVisitedUI();
  });

  // 経路ボタン
  actionRoute.addEventListener('click', () => {
    if (!currentShop) return;
    const [lng, lat] = currentShop.geometry.coordinates;
    const url = currentShop.properties.googleMapsUrl ||
      `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
    window.open(url, '_blank', 'noopener');
  });
}

/**
 * ボトムシートを開く
 */
export function openSheet(feature) {
  currentShop = feature;
  const props = feature.properties;

  // 店名
  nameEl.textContent = props.name;

  // バッジ
  badgesEl.innerHTML = '';
  if (props.rating && RATING_STYLES[props.rating]) {
    const s = RATING_STYLES[props.rating];
    const badge = document.createElement('span');
    badge.className = 'sheet-rating-badge';
    badge.style.background = s.bg;
    badge.style.color = s.text;
    badge.textContent = props.rating;
    badgesEl.appendChild(badge);
  }

  let genres = props.genre;
  if (typeof genres === 'string') {
    try { genres = JSON.parse(genres); } catch { genres = []; }
  }
  if (Array.isArray(genres)) {
    genres.forEach(g => {
      const tag = document.createElement('span');
      tag.className = 'sheet-genre-tag';
      tag.textContent = g;
      badgesEl.appendChild(tag);
    });
  }

  // TRY
  let tryData = props.try || props.sry;
  if (typeof tryData === 'string') {
    try { tryData = JSON.parse(tryData); } catch { tryData = null; }
  }
  const tryEl = document.getElementById('sheet-try') || document.getElementById('sheet-sry');
  if (tryEl) {
    if (tryData && tryData.year) {
      tryEl.classList.add('visible');
      tryEl.innerHTML = `<i class="ti ti-trophy"></i><span>TRY ${tryData.year} ${tryData.category || ''} 受賞</span>`;
    } else {
      tryEl.classList.remove('visible');
    }
  }

  // 営業ステータス
  let hours = props.hours;
  if (typeof hours === 'string') {
    try { hours = JSON.parse(hours); } catch { hours = null; }
  }
  const status = getOpenStatus(hours);
  const sc = STATUS_STYLES[status.status] || STATUS_STYLES.closed;
  const hoursDisplay = status.hoursText ? status.hoursText : (hours ? '' : '営業時間情報なし');
  statusRow.innerHTML = `
    <span style="display:inline-flex;align-items:center;gap:6px;">
      <span class="status-dot" style="background:${sc.dot}"></span>
      <span class="status-label" style="color:${sc.text}">${sc.label}</span>
    </span>
    <span class="status-hours">${hoursDisplay}</span>
  `;

  // 入店・食券タグ
  entryTags.innerHTML = '';
  if (props.entryMethod) {
    entryTags.innerHTML += `<span class="entry-tag"><i class="ti ti-notebook"></i>${props.entryMethod}</span>`;
  }
  if (props.ticketBuy) {
    entryTags.innerHTML += `<span class="entry-tag"><i class="ti ti-ticket"></i>食券${props.ticketBuy}</span>`;
  }

  // Instagram / YouTube リンク (SUSURU + 店名 検索)
  const q = encodeURIComponent('SUSURU ' + props.name);
  actionInstagram.href = `https://www.instagram.com/explore/search/keyword/?q=${q}`;
  actionYoutube.href = `https://www.youtube.com/results?search_query=${q}`;

  // お気に入り・訪問済み
  updateFavoriteUI();
  updateVisitedUI();

  // 表示
  sheet.classList.add('open');
}

/**
 * ボトムシートを閉じる
 */
export function closeSheet() {
  sheet.classList.remove('open');
  currentShop = null;
}

function updateFavoriteUI() {
  if (!currentShop) return;
  favoriteBtn.classList.toggle('active', isFavorite(currentShop.properties.id));
}

function updateVisitedUI() {
  if (!currentShop) return;
  visitedBtn.classList.toggle('active', isVisited(currentShop.properties.id));
}

export function getCurrentShop() {
  return currentShop;
}

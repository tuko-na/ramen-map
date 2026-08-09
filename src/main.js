/**
 * ラーメンマップ - メインエントリーポイント
 */

// --- CSS ---
import 'maplibre-gl/dist/maplibre-gl.css';
import './styles/index.css';
import './styles/header.css';
import './styles/map.css';
import './styles/search.css';
import './styles/filters.css';
import './styles/bottom-nav.css';
import './styles/bottom-sheet.css';

// --- MapLibre Worker (v6 ESM) ---
import { setWorkerUrl } from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
setWorkerUrl(maplibreWorkerUrl);

// --- Modules ---
import { initMap, updateMapData, flyToLocation, getVisibleShopCount } from './map.js';
import { initFilters, applyFilters } from './filters.js';
import { initBottomSheet, openSheet } from './bottom-sheet.js';
import { initSearch } from './search.js';
import { initGeolocation } from './geolocation.js';
import { enrichWithOpenStatus } from './opening-hours.js';

/** @type {Object|null} */
let allShopData = null;
/** @type {Object|null} */
let enrichedData = null;

const totalCountEl = document.getElementById('total-count');
const visibleCountEl = document.getElementById('visible-count');

/** 凡例データ */
const LEGEND_ITEMS = [
  { label: 'ちょめめ', color: '#EF9F27' },
  { label: '超超うまい', color: '#D85A30' },
  { label: '超うまい', color: '#F0997B' },
  { label: 'うまい', color: '#FAEEDA' },
];

/**
 * アプリ初期化
 */
async function init() {
  try {
    // 1. データ読み込み
    const res = await fetch('/data/ramen-shops.json');
    if (!res.ok) throw new Error(`データ読み込みエラー: ${res.status}`);
    allShopData = await res.json();

    // 2. 営業ステータス付与
    enrichedData = enrichWithOpenStatus(allShopData);
    totalCountEl.textContent = enrichedData.features.length;

    // 3. 凡例描画
    renderLegend();

    // 4. マップ初期化
    const map = initMap(handleShopClick, handleMapMove);

    map.on('error', (e) => {
      console.error('[RamenMap] Map error:', e.error?.message || e);
    });

    map.on('load', () => {
      // フラット配列の導出 (必要に応じて各モジュールで直接アクセス可能)
      const shopsFlat = enrichedData.features.map(f => ({
        ...f.properties,
        coordinates: f.geometry.coordinates,
      }));

      updateMapData(enrichedData);
      updateShopCount();

      initFilters(handleFilterChange);
      initSearch(enrichedData.features, handleSearchSelect);
      initBottomSheet();
      initGeolocation();
      initNavigation();

      // 営業ステータス定期更新 (1分ごと)
      setInterval(refreshOpenStatus, 60000);
    });

  } catch (err) {
    console.error('初期化エラー:', err);
    showInitError();
  }
}

function renderLegend() {
  const el = document.getElementById('map-legend');
  if (!el) return;
  el.innerHTML = LEGEND_ITEMS.map(item => `
    <div class="legend-item">
      <span class="legend-dot" style="background:${item.color}"></span>
      <span class="legend-text">${item.label}</span>
    </div>
  `).join('');
}

function initNavigation() {
  const allTabs = document.querySelectorAll('.nav-tab');
  allTabs.forEach(tab => {
    tab.addEventListener('click', function () {
      const tabName = this.dataset.tab;
      allTabs.forEach(t => t.classList.remove('active'));
      allTabs.forEach(t => {
        if (t.dataset.tab === tabName) t.classList.add('active');
      });
    });
  });
}

function handleShopClick(feature) {
  openSheet(feature);
}

function handleFilterChange(filterState) {
  if (!enrichedData) return;
  const filtered = applyFilters(enrichedData, filterState);
  updateMapData(filtered);
  setTimeout(updateShopCount, 100);
}

function handleSearchSelect(feature) {
  const coords = feature.geometry.coordinates;
  flyToLocation(coords, 16);
  setTimeout(() => openSheet(feature), 500);
}

function handleMapMove() {
  updateShopCount();
}

function updateShopCount() {
  const count = getVisibleShopCount();
  visibleCountEl.textContent = count;
}

function refreshOpenStatus() {
  if (!allShopData) return;
  enrichedData = enrichWithOpenStatus(allShopData);
  handleFilterChange({
    openOnly: false, unvisitedOnly: false, tryOnly: false,
    ratings: new Set(), genres: new Set(),
    entries: new Set(), tickets: new Set(), facilities: new Set(),
  });
}

function showInitError() {
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#f5f5f2;color:#1a1a17;font-family:sans-serif;z-index:999;padding:24px;text-align:center;';
  el.innerHTML = `
    <div style="font-size:48px;margin-bottom:16px;">🍜</div>
    <h1 style="font-size:18px;font-weight:700;margin-bottom:8px;">読み込みエラー</h1>
    <p style="color:#9a9a94;margin-bottom:24px;font-size:13px;">データの読み込みに失敗しました。</p>
    <button onclick="location.reload()" style="padding:10px 24px;border-radius:10px;background:#D85A30;color:#fff;font-weight:600;font-size:13px;border:none;cursor:pointer;">再読み込み</button>
  `;
  document.body.appendChild(el);
}

init();

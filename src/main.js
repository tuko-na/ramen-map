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
import { initFilters } from './filters.js';
import { initBottomSheet, openSheet, closeSheet } from './bottom-sheet.js';
import { initSearch, updateSearchIndex } from './search.js';
import { initGeolocation } from './geolocation.js';

import { subscribe, setRawData, updateOpenStatus, setActiveShopId } from './store.js';

const totalCountEl = document.getElementById('total-count');
const visibleCountEl = document.getElementById('visible-count');
let timerId = null;

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
    const geoJson = await res.json();

    // 2. 凡例描画
    renderLegend();

    // 3. マップ初期化
    const map = initMap(handleShopClick, handleMapMove);

    map.on('error', (e) => {
      console.error('[RamenMap] Map error:', e.error?.message || e);
    });

    map.on('load', () => {
      // 4. 各UIモジュールの初期化
      initFilters();
      initSearch(handleSearchSelect); // データの流し込みは後述のsubscribeで行う
      initBottomSheet();
      initGeolocation();
      initNavigation();

      // 5. Store の状態を購読 (Pub/Sub)
      subscribe((state, derivedData) => {
        // マップの更新
        updateMapData(derivedData, state.activeShopId);
        
        // 検索インデックスの更新
        updateSearchIndex(derivedData.features);
        
        // ヘッダーの合計件数更新
        if (state.rawData) {
           totalCountEl.textContent = state.rawData.features.length;
        }

        // 表示件数（画面内の店舗数）の更新遅延実行
        setTimeout(updateShopCount, 100);

        // ボトムシートの自動クローズ
        if (!state.activeShopId) {
           closeSheet();
        }
      });

      // 6. データの初期セット (Storeに通知され、一斉に描画が走る)
      setRawData(geoJson);

      // 7. 営業ステータス定期更新 (1分ごと)
      // setInterval のコールバック内では Store の Action (updateOpenStatus) を呼ぶのみ。
      // 古い状態のクロージャは発生しない。
      if (timerId) clearInterval(timerId);
      timerId = setInterval(() => {
        updateOpenStatus();
      }, 60000);
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
  setActiveShopId(feature.properties.id);
  openSheet(feature);
}

function handleSearchSelect(feature) {
  const coords = feature.geometry.coordinates;
  flyToLocation(coords, 16); // 検索は特定の店舗へ飛ぶための機能なので、flyToを呼ぶ
  setTimeout(() => {
    setActiveShopId(feature.properties.id);
    openSheet(feature);
  }, 500);
}

function handleMapMove() {
  updateShopCount();
}

function updateShopCount() {
  const count = getVisibleShopCount();
  visibleCountEl.textContent = count;
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

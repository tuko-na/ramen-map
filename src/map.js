/**
 * MapLibre GL JS 初期化・レイヤー管理
 */
import { Map as MaplibreMap, Marker } from 'maplibre-gl';

/** @type {maplibregl.Map|null} */
let map = null;

/** @type {maplibregl.Marker|null} */
let locationMarker = null;

/** 評価ラベルごとのピン色 */
const RATING_COLORS = {
  'ちょめめ': '#ffd700',
  '超超うまい': '#ff4444',
  '超うまい': '#ff8c00',
  'うまい': '#ffcc00',
};

const DEFAULT_PIN_COLOR = '#ff6b35';

/**
 * マップを初期化する
 * @param {Function} onShopClick - 店舗ピンクリック時のコールバック
 * @param {Function} onMapMove - マップ移動時のコールバック
 * @returns {maplibregl.Map}
 */
export function initMap(onShopClick, onMapMove) {
  map = new MaplibreMap({
    container: 'map',
    style: 'https://tiles.openfreemap.org/styles/liberty',
    center: [139.767125, 35.681236],
    zoom: 12,
    maxPixelRatio: 2,
    attributionControl: true,
  });

  // モバイル操作最適化: 回転を無効化
  map.dragRotate.disable();
  map.touchZoomRotate.disableRotation();

  map.on('load', () => {
    setupLayers();
    setupInteractions(onShopClick);

    if (onMapMove) {
      map.on('moveend', onMapMove);
    }
  });

  return map;
}

/**
 * GeoJSONソースとレイヤーを設定する
 */
function setupLayers() {
  // GeoJSONソース（クラスタリング有効）
  map.addSource('ramen-shops', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
    cluster: true,
    clusterMaxZoom: 14,
    clusterRadius: 50,
  });

  // --- クラスタ円レイヤー ---
  map.addLayer({
    id: 'clusters',
    type: 'circle',
    source: 'ramen-shops',
    filter: ['has', 'point_count'],
    paint: {
      'circle-color': [
        'step', ['get', 'point_count'],
        '#ff6b35',  // < 10件
        10, '#ff4444',  // 10〜29件
        30, '#cc2200',  // 30件以上
      ],
      'circle-radius': [
        'step', ['get', 'point_count'],
        18,   // < 10件
        10, 24, // 10〜29件
        30, 30, // 30件以上
      ],
      'circle-stroke-width': 2,
      'circle-stroke-color': 'rgba(255, 255, 255, 0.3)',
    },
  });

  // --- クラスタ件数テキスト ---
  map.addLayer({
    id: 'cluster-count',
    type: 'symbol',
    source: 'ramen-shops',
    filter: ['has', 'point_count'],
    layout: {
      'text-field': '{point_count_abbreviated}',
      'text-size': 13,
      'text-font': ['Noto Sans Regular'],
    },
    paint: {
      'text-color': '#ffffff',
    },
  });

  // --- 個別店舗ピン（外側の円） ---
  map.addLayer({
    id: 'unclustered-point',
    type: 'circle',
    source: 'ramen-shops',
    filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-color': [
        'match', ['get', 'rating'],
        'ちょめめ', RATING_COLORS['ちょめめ'],
        '超超うまい', RATING_COLORS['超超うまい'],
        '超うまい', RATING_COLORS['超うまい'],
        'うまい', RATING_COLORS['うまい'],
        DEFAULT_PIN_COLOR,
      ],
      'circle-radius': 9,
      'circle-stroke-width': 2.5,
      'circle-stroke-color': '#ffffff',
    },
  });

  // --- 営業中インジケーター (内側の小さな緑の点) ---
  map.addLayer({
    id: 'open-indicator',
    type: 'circle',
    source: 'ramen-shops',
    filter: ['all',
      ['!', ['has', 'point_count']],
      ['==', ['get', 'isOpenNow'], true],
    ],
    paint: {
      'circle-color': '#22c55e',
      'circle-radius': 4,
      'circle-stroke-width': 1,
      'circle-stroke-color': '#ffffff',
      'circle-translate': [8, -8],
    },
  });
}

/**
 * インタラクションを設定する
 * @param {Function} onShopClick
 */
function setupInteractions(onShopClick) {
  // クラスタクリック → ズームイン
  map.on('click', 'clusters', (e) => {
    const features = map.queryRenderedFeatures(e.point, { layers: ['clusters'] });
    if (!features.length) return;

    const clusterId = features[0].properties.cluster_id;
    map.getSource('ramen-shops').getClusterExpansionZoom(clusterId).then(zoom => {
      map.easeTo({
        center: features[0].geometry.coordinates,
        zoom: zoom,
      });
    });
  });

  // 個別店舗クリック → ボトムシート
  map.on('click', 'unclustered-point', (e) => {
    if (!e.features || !e.features.length) return;
    const feature = e.features[0];

    // properties内のJSON文字列をパースする
    const props = { ...feature.properties };
    ['genre', 'hours', 'sry'].forEach(key => {
      if (typeof props[key] === 'string') {
        try { props[key] = JSON.parse(props[key]); } catch { /* ignore */ }
      }
    });

    if (onShopClick) {
      onShopClick({
        ...feature,
        properties: props,
      });
    }

    // 地図をピン位置に移動
    map.easeTo({
      center: feature.geometry.coordinates,
      offset: [0, -100],
      duration: 400,
    });
  });

  // ホバーカーソル
  map.on('mouseenter', 'clusters', () => {
    map.getCanvas().style.cursor = 'pointer';
  });
  map.on('mouseleave', 'clusters', () => {
    map.getCanvas().style.cursor = '';
  });
  map.on('mouseenter', 'unclustered-point', () => {
    map.getCanvas().style.cursor = 'pointer';
  });
  map.on('mouseleave', 'unclustered-point', () => {
    map.getCanvas().style.cursor = '';
  });
}

/**
 * マップデータを更新する
 * @param {Object} geojson - GeoJSON FeatureCollection
 */
export function updateMapData(geojson) {
  if (!map) return;

  const source = map.getSource('ramen-shops');
  if (source) {
    source.setData(geojson);
  }
}

/**
 * 表示中の店舗数を取得する
 * @returns {number}
 */
export function getVisibleShopCount() {
  if (!map) return 0;
  try {
    const features = map.queryRenderedFeatures({ layers: ['unclustered-point'] });
    return features.length;
  } catch {
    return 0;
  }
}

/**
 * 特定座標にマップを移動する
 * @param {[number, number]} coords - [lng, lat]
 * @param {number} [zoom=15]
 */
export function flyToLocation(coords, zoom = 15) {
  if (!map) return;
  map.flyTo({
    center: coords,
    zoom: zoom,
    duration: 1000,
  });
}

/**
 * 現在地マーカーを表示/更新する
 * @param {[number, number]} coords - [lng, lat]
 */
export function showLocationMarker(coords) {
  if (locationMarker) {
    locationMarker.setLngLat(coords);
    return;
  }

  const el = document.createElement('div');
  el.className = 'current-location-outer';
  el.innerHTML = `
    <div class="current-location-pulse"></div>
    <div class="current-location-marker"></div>
  `;
  el.style.cssText = 'position:relative;width:40px;height:40px;display:flex;align-items:center;justify-content:center;';

  locationMarker = new Marker({ element: el })
    .setLngLat(coords)
    .addTo(map);
}

/**
 * マップインスタンスを取得する
 * @returns {maplibregl.Map|null}
 */
export function getMap() {
  return map;
}

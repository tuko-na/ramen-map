/**
 * 現在地取得 (Geolocation API)
 */
import { flyToLocation, showLocationMarker } from './map.js';

const geolocateBtn = document.getElementById('geolocate-btn');

/** @type {boolean} */
let isTracking = false;

/** @type {number|null} */
let watchId = null;

/**
 * 現在地機能の初期化
 */
export function initGeolocation() {
  geolocateBtn.addEventListener('click', handleGeolocateClick);
}

/**
 * 現在地ボタンのクリックハンドラー
 */
function handleGeolocateClick() {
  if (!('geolocation' in navigator)) {
    showError('お使いのブラウザは位置情報に対応していません');
    return;
  }

  if (isTracking) {
    stopTracking();
    return;
  }

  startTracking();
}

/**
 * 位置情報のトラッキングを開始
 */
function startTracking() {
  isTracking = true;
  geolocateBtn.classList.add('active');

  // まず現在地を即座に取得
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const coords = [pos.coords.longitude, pos.coords.latitude];
      showLocationMarker(coords);
      flyToLocation(coords, 14);
    },
    (err) => {
      handleGeolocationError(err);
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 30000,
    }
  );

  // 継続的にウォッチ
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const coords = [pos.coords.longitude, pos.coords.latitude];
      showLocationMarker(coords);
    },
    () => {
      // ウォッチ中のエラーはサイレントに処理
    },
    {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 10000,
    }
  );
}

/**
 * トラッキングを停止
 */
function stopTracking() {
  isTracking = false;
  geolocateBtn.classList.remove('active');

  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
}

/**
 * 位置情報エラーのハンドリング
 * @param {GeolocationPositionError} err
 */
function handleGeolocationError(err) {
  stopTracking();

  switch (err.code) {
    case err.PERMISSION_DENIED:
      showError('位置情報の使用が許可されていません。ブラウザの設定をご確認ください。');
      break;
    case err.POSITION_UNAVAILABLE:
      showError('位置情報を取得できませんでした。');
      break;
    case err.TIMEOUT:
      showError('位置情報の取得がタイムアウトしました。');
      break;
    default:
      showError('位置情報の取得でエラーが発生しました。');
  }
}

/**
 * エラーメッセージを一時表示する
 * @param {string} message
 */
function showError(message) {
  // 簡易的なトースト表示
  const toast = document.createElement('div');
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed;
    top: 140px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(239, 68, 68, 0.95);
    color: white;
    padding: 10px 20px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 500;
    z-index: 100;
    max-width: 90vw;
    text-align: center;
    backdrop-filter: blur(8px);
    animation: fadeIn 0.2s ease;
  `;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'fadeOut 0.3s ease forwards';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

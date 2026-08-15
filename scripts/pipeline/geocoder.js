/**
 * geocoder.js
 * Google Places API (New) を用いた地理解決・同名店判定・営業時間変換
 *
 * 責務:
 *   - Text Search (Essentials SKU): "{name} {area_hint}" で候補を検索
 *   - 候補件数判定: 1件→自動確定、複数/0件→キュー退避用オブジェクトを返却
 *   - Place Details (Enterprise SKU): 新規 placeId のみ regularOpeningHours を取得
 *   - 営業時間を opening-hours.js 互換フォーマット（26:00表記・2部制・定休日null）に変換
 *
 * 環境変数:
 *   GOOGLE_PLACES_API_KEY - Google Maps Platform API キー
 */

const PLACES_API_BASE = 'https://places.googleapis.com/v1/places';
const DAY_MAP = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/**
 * 店名と地域ヒントから Places API で位置を解決する
 * @param {string} name - 店舗名
 * @param {string|null} areaHint - 地域ヒント（市区町村レベル）
 * @param {Object} [options]
 * @param {string[]} [options.existingPlaceIds] - 既存店舗の placeId 一覧（重複チェック用）
 * @returns {Promise<Object>} 位置解決結果
 */
export async function resolveLocation(name, areaHint, options = {}) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;

  if (!apiKey) {
    console.warn('[geocoder] GOOGLE_PLACES_API_KEY が未設定です。モック結果を返します。');
    return getMockGeoResult(name, areaHint);
  }

  const query = areaHint ? `${name} ${areaHint}` : name;
  console.log(`[geocoder] Text Search: "${query}"`);

  // Text Search (Essentials SKU)
  const searchRes = await fetch(`${PLACES_API_BASE}:searchText`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location',
    },
    body: JSON.stringify({
      textQuery: query,
      languageCode: 'ja',
      regionCode: 'JP',
      maxResultCount: 5,
    }),
  });

  if (!searchRes.ok) {
    const errText = await searchRes.text();
    throw new Error(`Places API Text Search エラー: ${searchRes.status} ${errText}`);
  }

  const searchData = await searchRes.json();
  const places = searchData.places || [];

  console.log(`[geocoder] 候補件数: ${places.length}`);

  const candidates = places.map(p => ({
    placeId: p.id,
    name: p.displayName?.text || '',
    address: p.formattedAddress || '',
    lat: p.location?.latitude || 0,
    lng: p.location?.longitude || 0,
  }));

  // 候補件数による分岐
  if (candidates.length === 1) {
    return {
      resolved: true,
      isPendingLocation: false,
      place: candidates[0],
      candidates,
    };
  } else if (candidates.length === 0) {
    return {
      resolved: false,
      isPendingLocation: true,
      reason: 'LOCATION_NOT_FOUND',
      place: null,
      candidates: [],
    };
  } else {
    return {
      resolved: false,
      isPendingLocation: true,
      reason: 'LOCATION_AMBIGUOUS',
      place: null,
      candidates,
    };
  }
}

/**
 * Place Details (Enterprise SKU) で営業時間を取得し、opening-hours.js 互換に変換する
 * @param {string} placeId - Google Place ID
 * @returns {Promise<Object|null>} opening-hours.js 互換の営業時間オブジェクト。取得失敗時は null
 */
export async function fetchOpeningHours(placeId) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;

  if (!apiKey) {
    console.warn('[geocoder] GOOGLE_PLACES_API_KEY が未設定です。モック営業時間を返します。');
    return getMockHours();
  }

  console.log(`[geocoder] Place Details (営業時間): ${placeId}`);

  // places/{placeId} で Place Details を取得
  const placeName = `places/${placeId}`;
  const res = await fetch(`${PLACES_API_BASE}/${placeId}`, {
    method: 'GET',
    headers: {
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'regularOpeningHours',
    },
  });

  if (!res.ok) {
    console.warn(`[geocoder] Place Details エラー: ${res.status}`);
    return null;
  }

  const data = await res.json();
  const periods = data.regularOpeningHours?.periods;

  if (!periods || periods.length === 0) {
    console.warn('[geocoder] 営業時間データが空です');
    return null;
  }

  return convertToHoursFormat(periods);
}

/**
 * Place ID から店舗情報（名前、住所、座標）を取得する
 * @param {string} placeId
 * @returns {Promise<Object|null>}
 */
export async function fetchPlaceDetailsForId(placeId) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return null;

  console.log(`[geocoder] Place Details (座標取得): ${placeId}`);
  const res = await fetch(`${PLACES_API_BASE}/${placeId}`, {
    method: 'GET',
    headers: {
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'id,displayName,formattedAddress,location',
    },
  });

  if (!res.ok) return null;
  const data = await res.json();
  if (!data) return null;

  return {
    placeId: data.id,
    name: data.displayName?.text || '',
    address: data.formattedAddress || '',
    lat: data.location?.latitude || 0,
    lng: data.location?.longitude || 0,
  };
}

/**
 * Google Places API の regularOpeningHours.periods を opening-hours.js 互換フォーマットに変換
 *
 * 変換ルール (GEMINI.md セクション5.2):
 *   - 曜日マッピング: Google の 0 (Sunday) 〜 6 (Saturday) → ["sun","mon","tue","wed","thu","fri","sat"]
 *   - 2部制配列化: 同一曜日に昼/夜の複数枠がある場合は配列に複数要素
 *   - 24時越え変換: クローズが翌日未明（例: hour:2）の場合は hour + 24 (= "26:00")
 *   - 定休日: 該当曜日の periods が未存在なら null
 *
 * @param {Array} periods - Google Places API の periods 配列
 * @returns {Object} opening-hours.js 互換の営業時間オブジェクト
 */
export function convertToHoursFormat(periods) {
  // 曜日ごとに枠を収集
  const daySlots = { sun: [], mon: [], tue: [], wed: [], thu: [], fri: [], sat: [] };

  for (const period of periods) {
    const openDay = period.open?.day;
    const closeDay = period.close?.day;
    const openHour = period.open?.hour ?? 0;
    const openMin = period.open?.minute ?? 0;
    const closeHour = period.close?.hour ?? 0;
    const closeMin = period.close?.minute ?? 0;

    if (openDay === undefined || openDay === null) continue;

    const dayKey = DAY_MAP[openDay];
    if (!dayKey) continue;

    const openTime = `${String(openHour).padStart(2, '0')}:${String(openMin).padStart(2, '0')}`;

    // 24時越え判定: クローズが翌日（openDay と異なる日）の場合
    let adjustedCloseHour = closeHour;
    if (closeDay !== undefined && closeDay !== openDay) {
      // 翌日にまたがる場合、hour + 24 で表記
      adjustedCloseHour = closeHour + 24;
    }

    const closeTime = `${String(adjustedCloseHour).padStart(2, '0')}:${String(closeMin).padStart(2, '0')}`;

    daySlots[dayKey].push({ open: openTime, close: closeTime });
  }

  // 枠がない曜日は null（定休日）
  const hours = {};
  for (const [day, slots] of Object.entries(daySlots)) {
    hours[day] = slots.length > 0 ? slots : null;
  }

  return hours;
}

/**
 * Google Maps URL を生成
 * @param {string} placeId
 * @returns {string}
 */
export function buildGoogleMapsUrl(placeId) {
  return `https://www.google.com/maps/place/?q=place_id:${placeId}`;
}

/**
 * モック位置解決結果
 */
function getMockGeoResult(name, areaHint) {
  // 「麺屋武蔵」の場合は同名店衝突をシミュレート
  if (name.includes('麺屋武蔵') && !name.includes('新宿本店')) {
    return {
      resolved: false,
      isPendingLocation: true,
      reason: 'LOCATION_AMBIGUOUS',
      place: null,
      candidates: [
        {
          placeId: 'ChIJ_mock_musashi_1',
          name: '麺屋武蔵 新宿本店',
          address: '東京都新宿区西新宿7-2-6',
          lat: 35.693841,
          lng: 139.698675,
        },
        {
          placeId: 'ChIJ_mock_musashi_2',
          name: '創始 麺屋武蔵',
          address: '東京都新宿区西新宿7-2-6 1F',
          lat: 35.69391,
          lng: 139.69872,
        },
      ],
    };
  }

  return {
    resolved: true,
    isPendingLocation: false,
    place: {
      placeId: `ChIJ_mock_${name.slice(0, 5)}`,
      name,
      address: `東京都${areaHint || '渋谷区'}（モック住所）`,
      lat: 35.68 + Math.random() * 0.05,
      lng: 139.7 + Math.random() * 0.05,
    },
    candidates: [{
      placeId: `ChIJ_mock_${name.slice(0, 5)}`,
      name,
      address: `東京都${areaHint || '渋谷区'}（モック住所）`,
      lat: 35.68 + Math.random() * 0.05,
      lng: 139.7 + Math.random() * 0.05,
    }],
  };
}

/**
 * モック営業時間
 */
function getMockHours() {
  return {
    mon: [{ open: '11:00', close: '15:00' }, { open: '17:00', close: '22:00' }],
    tue: [{ open: '11:00', close: '15:00' }, { open: '17:00', close: '22:00' }],
    wed: null,
    thu: [{ open: '11:00', close: '15:00' }, { open: '17:00', close: '22:00' }],
    fri: [{ open: '11:00', close: '15:00' }, { open: '17:00', close: '26:00' }],
    sat: [{ open: '11:00', close: '26:00' }],
    sun: [{ open: '11:00', close: '21:00' }],
  };
}

// --- 単体テスト用エントリーポイント ---
if (import.meta.url === `file://${process.argv[1]}`) {
  import('dotenv').then(d => d.config());
  setTimeout(async () => {
    try {
      // テスト1: 単一店舗（正常）
      console.log('\n=== テスト1: 単一店舗 ===');
      const r1 = await resolveLocation('中華そば しば田', '渋谷');
      console.log(JSON.stringify(r1, null, 2));

      // テスト2: 同名店（衝突）
      console.log('\n=== テスト2: 同名店衝突 ===');
      const r2 = await resolveLocation('麺屋武蔵', '新宿');
      console.log(JSON.stringify(r2, null, 2));

      // テスト3: 営業時間取得
      if (r1.place) {
        console.log('\n=== テスト3: 営業時間取得 ===');
        const hours = await fetchOpeningHours(r1.place.placeId);
        console.log(JSON.stringify(hours, null, 2));
      }
    } catch (err) {
      const { safeErrorMessage } = await import('./utils.js');
      console.error('エラー:', safeErrorMessage(err));
      process.exit(1);
    }
  }, 100);
}

/**
 * 営業時間判定ユーティリティ
 * 
 * 深夜営業（26:00 = 翌日02:00）に対応。
 * 0:00〜4:00 付近の時刻は「前日の深夜営業の延長」として扱う。
 */

/** 曜日キー配列 (0=日曜 → 6=土曜) */
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/**
 * 時刻文字列 "HH:MM" を分単位の数値に変換する
 * 24:00以上の表記（例: "26:00"）にも対応
 * @param {string} timeStr - "11:00", "26:00" 等
 * @returns {number} 分単位の値（例: "11:00" → 660, "26:00" → 1560）
 */
export function parseTime(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

/**
 * 分単位の値を "HH:MM" 形式に変換（表示用）
 * @param {number} minutes
 * @returns {string}
 */
export function formatTime(minutes) {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * 営業ステータスの判定結果
 * @typedef {'open' | 'break' | 'closed' | 'holiday'} OpenStatus
 */

/**
 * 営業状態の詳細
 * @typedef {Object} OpenStatusResult
 * @property {OpenStatus} status - 'open' | 'break' | 'closed' | 'holiday'
 * @property {string} label - 表示用テキスト（例: "営業中", "中休み", "本日定休", "閉店"）
 * @property {string|null} hoursText - 営業時間テキスト（例: "11:00〜15:00 / 18:00〜22:00"）
 */

/**
 * 指定日時における営業ステータスを判定する
 * 
 * 深夜営業ロジック:
 * - close が 24:00 を超える場合（例: "26:00"）、翌日の 02:00 まで営業中と判定
 * - 現在時刻が 0:00〜4:00 の場合、前日の深夜営業枠もチェックする
 * 
 * @param {Object} hours - 曜日ごとの営業時間データ
 * @param {Date} [now] - 判定する日時（省略時は現在日時）
 * @returns {OpenStatusResult}
 */
export function getOpenStatus(hours, now = new Date()) {
  if (!hours) {
    return { status: 'closed', label: '情報なし', hoursText: null };
  }

  const dayIndex = now.getDay();     // 0=Sun ... 6=Sat
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const dayKey = DAY_KEYS[dayIndex];
  const todaySlots = hours[dayKey];

  // --- 今日の営業枠をチェック ---
  if (todaySlots && todaySlots.length > 0) {
    const result = checkSlots(todaySlots, currentMinutes);
    if (result.status === 'open') return result;
    // 「中休み」の場合も今日の営業時間テキストを返す
    if (result.status === 'break') {
      return {
        ...result,
        hoursText: formatSlots(todaySlots),
      };
    }
  }

  // --- 前日の深夜営業延長をチェック（現在時刻が 0:00〜4:00 の場合） ---
  if (currentMinutes < 240) { // 4:00 = 240分
    const prevDayIndex = (dayIndex + 6) % 7;
    const prevDayKey = DAY_KEYS[prevDayIndex];
    const prevSlots = hours[prevDayKey];

    if (prevSlots && prevSlots.length > 0) {
      // 前日の最後の営業枠が24:00を超えるか確認
      const lastSlot = prevSlots[prevSlots.length - 1];
      const closeMinutes = parseTime(lastSlot.close);

      if (closeMinutes > 1440) { // 24:00 = 1440分を超えている
        // 現在時刻を「前日の基準」に変換（例: 01:30 → 25:30 = 1530分）
        const adjustedMinutes = currentMinutes + 1440;
        if (adjustedMinutes >= parseTime(lastSlot.open) && adjustedMinutes < closeMinutes) {
          return {
            status: 'open',
            label: '営業中',
            hoursText: `${formatTime(parseTime(lastSlot.open))}〜${formatTime(closeMinutes)}（深夜）`,
          };
        }
      }
    }
  }

  // --- 本日定休 ---
  if (!todaySlots || todaySlots.length === 0) {
    return { status: 'holiday', label: '本日定休', hoursText: null };
  }

  // --- 営業枠はあるが時間外 ---
  return {
    status: 'closed',
    label: '閉店',
    hoursText: formatSlots(todaySlots),
  };
}

/**
 * 営業枠配列と現在時刻で営業中/中休みを判定
 * @param {Array<{open: string, close: string}>} slots
 * @param {number} currentMinutes
 * @returns {{status: OpenStatus, label: string, hoursText: string|null}}
 */
function checkSlots(slots, currentMinutes) {
  for (const slot of slots) {
    const openMin = parseTime(slot.open);
    let closeMin = parseTime(slot.close);

    // close が open より小さい場合（例: open=22:00, close=02:00 は close=26:00 として扱う）
    // ただし、"26:00" のような明示的な表記はそのまま parseTime で処理済み
    if (closeMin <= openMin && closeMin <= 240) {
      closeMin += 1440;
    }

    if (currentMinutes >= openMin && currentMinutes < closeMin) {
      return {
        status: 'open',
        label: '営業中',
        hoursText: formatSlots(slots),
      };
    }
  }

  // 営業枠間の「中休み」判定
  for (let i = 0; i < slots.length - 1; i++) {
    const prevClose = parseTime(slots[i].close);
    const nextOpen = parseTime(slots[i + 1].open);
    if (currentMinutes >= prevClose && currentMinutes < nextOpen) {
      return {
        status: 'break',
        label: '中休み',
        hoursText: formatSlots(slots),
      };
    }
  }

  return { status: 'closed', label: '閉店', hoursText: formatSlots(slots) };
}

/**
 * 営業枠配列を表示用テキストに変換
 * @param {Array<{open: string, close: string}>} slots
 * @returns {string}
 */
function formatSlots(slots) {
  return slots.map(s => {
    const closeMin = parseTime(s.close);
    const closeDisplay = closeMin > 1440
      ? formatTime(closeMin)  // 26:00 → "02:00"
      : s.close;
    return `${s.open}〜${closeDisplay}`;
  }).join(' / ');
}

/**
 * 店舗データ全体に isOpenNow プロパティを付与する
 * @param {Object} geojson - GeoJSON FeatureCollection
 * @param {Date} [now]
 * @returns {Object} - 更新済みの GeoJSON
 */
export function enrichWithOpenStatus(geojson, now = new Date()) {
  const features = geojson.features.map(feature => {
    const status = getOpenStatus(feature.properties.hours, now);
    return {
      ...feature,
      properties: {
        ...feature.properties,
        isOpenNow: status.status === 'open',
        openStatus: status.status,
        openLabel: status.label,
        hoursText: status.hoursText,
      },
    };
  });

  return { ...geojson, features };
}

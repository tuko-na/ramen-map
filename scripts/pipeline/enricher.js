/**
 * enricher.js
 * Gemini Web Grounding による null 項目差分補完
 *
 * 責務:
 *   - parser.js の一次抽出結果で null だった項目のみ、Gemini Web Grounding で検索補完
 *   - 一次情報（キャプション由来の確定データ）は絶対に上書きしない
 *
 * 環境変数:
 *   GEMINI_API_KEY - Gemini API キー
 */

import { GoogleGenAI } from '@google/genai';
import { parseSafeJson, withRetry } from './utils.js';

/** 補完対象のフィールド一覧 (rating, name, isRamenPost, area_hint は対象外) */
const ENRICHABLE_FIELDS = [
  'genre', 'try', 'entryMethod', 'ticketBuy',
  'cashless', 'parking', 'tableSeating', 'nonsmoking',
];

/**
 * parser.js の抽出結果で null のフィールドを Gemini Web Grounding で補完する
 * @param {Object} extracted - parser.js の出力
 * @param {string} shopName - 確定した店舗名
 * @param {string|null} address - 確定した住所（あれば精度向上）
 * @returns {Promise<Object>} 補完済みの抽出結果（一次情報は保持）
 */
export async function enrichNullFields(extracted, shopName, address) {
  // null のフィールドを抽出
  const nullFields = ENRICHABLE_FIELDS.filter(f => {
    const val = extracted[f];
    // null、空配列、undefined を「未取得」と判定
    if (val === null || val === undefined) return true;
    if (Array.isArray(val) && val.length === 0) return true;
    return false;
  });

  if (nullFields.length === 0) {
    console.log('[enricher] 補完が必要なフィールドはありません');
    return extracted;
  }

  console.log(`[enricher] 補完対象フィールド: ${nullFields.join(', ')}`);

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    console.warn('[enricher] GEMINI_API_KEY が未設定です。補完をスキップします。');
    return extracted;
  }

  const ai = new GoogleGenAI({ apiKey });

  const prompt = buildEnrichPrompt(shopName, address, nullFields);

  try {
    const response = await withRetry(() => ai.models.generateContent({
      model: 'gemini-3.7-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        tools: [{ googleSearch: {} }],
      },
    }));

    const text = response.text;
    const enriched = parseSafeJson(text);

    // 差分マージ: 一次情報は絶対に上書きしない
    const merged = { ...extracted };
    for (const field of nullFields) {
      if (enriched[field] !== undefined && enriched[field] !== null) {
        merged[field] = enriched[field];
        console.log(`[enricher] 補完: ${field} = ${JSON.stringify(enriched[field])}`);
      }
    }

    return merged;
  } catch (err) {
    console.warn(`[enricher] Grounding 補完に失敗しました: ${err.message}`);
    return extracted;
  }
}

/**
 * 補完用のプロンプトを構築
 * @param {string} shopName
 * @param {string|null} address
 * @param {string[]} nullFields
 * @returns {string}
 */
function buildEnrichPrompt(shopName, address, nullFields) {
  const location = address ? `（住所: ${address}）` : '';

  const fieldDescriptions = {
    genre: 'ジャンル（醤油/塩/味噌/豚骨/二郎系/家系/煮干し/鶏白湯/辛い系/つけ麺/油そば・まぜそばの中から該当するものを配列で）',
    try: 'TRYラーメン大賞の受賞歴（{year: 年度, category: "名店部門 醤油"} の形式、受賞歴なければ null）',
    entryMethod: '入店方式（"並び順"/"記帳制"/"整理券制"/"予約制" のいずれか、不明なら null）',
    ticketBuy: '食券購入タイミング（"先買い"/"後買い"/"なし" のいずれか、不明なら null）',
    cashless: 'キャッシュレス対応（true/false、不明なら null）',
    parking: '駐車場あり（true/false、不明なら null）',
    tableSeating: 'テーブル席あり（true/false、不明なら null）',
    nonsmoking: '全席禁煙（true/false、不明なら null）',
  };

  const requestedFields = nullFields
    .map(f => `- ${f}: ${fieldDescriptions[f] || f}`)
    .join('\n');

  return [
    `以下のラーメン店について、Web検索で情報を収集してください。`,
    ``,
    `店舗名: ${shopName}${location}`,
    ``,
    `以下のフィールドの情報を JSON で返してください。確実な情報のみ入れ、不確実なものは null にしてください。`,
    ``,
    requestedFields,
  ].join('\n');
}

// --- 単体テスト用エントリーポイント ---
if (import.meta.url === `file://${process.argv[1]}`) {
  import('dotenv').then(d => d.config());
  setTimeout(async () => {
    const testExtracted = {
      isRamenPost: true,
      name: '中華そば しば田',
      area_hint: '渋谷',
      rating: '超超うまい',
      genre: [],          // 空 → 補完対象
      try: null,           // null → 補完対象
      entryMethod: null,   // null → 補完対象
      ticketBuy: '先買い', // 値あり → 保持
      cashless: null,      // null → 補完対象
      parking: null,       // null → 補完対象
      tableSeating: null,  // null → 補完対象
      nonsmoking: null,    // null → 補完対象
    };

    console.log('\n--- 入力 ---');
    console.log(JSON.stringify(testExtracted, null, 2));

    const result = await enrichNullFields(testExtracted, '中華そば しば田', '東京都渋谷区');
    console.log('\n--- 補完結果 ---');
    console.log(JSON.stringify(result, null, 2));
  }, 100);
}

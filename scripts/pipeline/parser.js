/**
 * parser.js
 * Gemini API (Structured Outputs) によるキャプション一次抽出
 *
 * 責務:
 *   - Instagram キャプション・ハッシュタグ・位置タグから、店名・評価・属性を一括抽出
 *   - isRamenPost === false の場合は後続処理をスキップするためのフラグを返す
 *   - 判明する属性はすべてここで取得し、enricher.js での二重取得を避ける
 *
 * 環境変数:
 *   GEMINI_API_KEY - Gemini API キー
 */

import { GoogleGenAI } from '@google/genai';
import { parseSafeJson, withRetry } from './utils.js';

/**
 * Gemini 抽出スキーマ確定版
 * GEMINI.md セクション「参考：Gemini抽出スキーマ確定版」に準拠
 */
const EXTRACTION_SCHEMA = {
  type: 'object',
  properties: {
    isRamenPost: { type: 'boolean' },
    name: { type: 'string' },
    area_hint: { type: ['string', 'null'] },
    rating: {
      type: ['string', 'null'],
      enum: ['ちょめめ', '超超うまい', '超うまい', 'うまい', null],
    },
    genre: {
      type: 'array',
      items: {
        type: 'string',
        enum: [
          '醤油', '塩', '味噌', '豚骨', '二郎系', '家系',
          '煮干し', '鶏白湯', '辛い系', 'つけ麺', '油そば・まぜそば',
        ],
      },
    },
    try: {
      type: ['object', 'null'],
      properties: {
        year: { type: ['integer', 'null'] },
        category: { type: ['string', 'null'] },
      },
    },
    entryMethod: {
      type: ['string', 'null'],
      enum: ['並び順', '記帳制', '整理券制', '予約制', null],
    },
    ticketBuy: {
      type: ['string', 'null'],
      enum: ['先買い', '後買い', 'なし', null],
    },
    cashless: { type: ['boolean', 'null'] },
    parking: { type: ['boolean', 'null'] },
    tableSeating: { type: ['boolean', 'null'] },
    nonsmoking: { type: ['boolean', 'null'] },
  },
  required: [
    'isRamenPost', 'name', 'area_hint', 'rating', 'genre', 'try',
    'entryMethod', 'ticketBuy', 'cashless', 'parking', 'tableSeating', 'nonsmoking',
  ],
};

/**
 * Gemini API を使ってキャプションから店舗情報を一次抽出する
 * @param {Object} post - normalizePost() の出力
 * @param {string} post.caption - キャプション本文
 * @param {string[]} post.hashtags - ハッシュタグ配列
 * @param {string|null} post.locationName - Instagram 位置タグ
 * @returns {Promise<Object>} 抽出結果（EXTRACTION_SCHEMA 準拠）
 */
export async function parseCaption(post) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    console.warn('[parser] GEMINI_API_KEY が未設定です。モック抽出結果を返します。');
    return getMockExtraction(post);
  }

  const ai = new GoogleGenAI({ apiKey });

  const prompt = buildPrompt(post);

  const response = await withRetry(() => ai.models.generateContent({
    model: 'gemini-3.7-flash',
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: EXTRACTION_SCHEMA,
    },
  }));

  const text = response.text;
  const result = parseSafeJson(text);

  console.log(`[parser] 抽出完了: isRamen=${result.isRamenPost}, name="${result.name}", rating="${result.rating}"`);

  return result;
}

/**
 * Gemini に渡すプロンプトを構築
 * @param {Object} post
 * @returns {string}
 */
function buildPrompt(post) {
  const parts = [
    'あなたはラーメンYouTuber「SUSURU」のInstagram投稿を分析するアシスタントです。',
    '以下のInstagram投稿から、ラーメン店舗に関する情報を抽出してください。',
    '',
    '## ルール',
    '- グッズ告知・イベント告知・コラボ告知など、ラーメン店舗の訪問レポートではない投稿の場合、isRamenPost を false にしてください。',
    '- 味の評価は「ちょめめ」「超超うまい」「超うまい」「うまい」の4段階のみです。これ以外の表現は null にしてください。',
    '- area_hint はキャプション本文・ハッシュタグ・位置タグから推測できる地域名（市区町村レベル）を入れてください。',
    '- genre は複数選択可能です。該当するものをすべて配列に入れてください。',
    '- TRYラーメン大賞に関する言及があれば try オブジェクトに年度とカテゴリを入れてください。',
    '- 判明しない項目は null にしてください（推測で埋めないでください）。',
    '',
    '## 投稿データ',
    `キャプション: ${post.caption}`,
    `ハッシュタグ: ${(post.hashtags || []).join(', ')}`,
    `位置タグ: ${post.locationName || 'なし'}`,
  ];

  return parts.join('\n');
}

/**
 * APIキー未設定時のモック抽出（キャプション内容による簡易判定）
 * @param {Object} post
 * @returns {Object}
 */
function getMockExtraction(post) {
  const caption = post.caption || '';

  // グッズ・告知系のキーワードがあれば非ラーメン投稿
  const isNotRamen = /グッズ|予約受付|コラボ|お知らせ|プレゼント企画/.test(caption);
  if (isNotRamen) {
    return {
      isRamenPost: false,
      name: '',
      area_hint: null,
      rating: null,
      genre: [],
      try: null,
      entryMethod: null,
      ticketBuy: null,
      cashless: null,
      parking: null,
      tableSeating: null,
      nonsmoking: null,
    };
  }

  // 簡易的な評価抽出
  let rating = null;
  if (caption.includes('ちょめめ')) rating = 'ちょめめ';
  else if (caption.includes('超超うまい')) rating = '超超うまい';
  else if (caption.includes('超うまい')) rating = '超うまい';
  else if (caption.includes('うまい')) rating = 'うまい';

  // 簡易的な店名抽出（「〜さんへ」「〜さん！」パターン）
  const nameMatch = caption.match(/(?:にある|の)(.+?)さん[へ！。\n]/);
  const name = nameMatch ? nameMatch[1].trim() : '（不明）';

  return {
    isRamenPost: true,
    name,
    area_hint: post.locationName || null,
    rating,
    genre: [],
    try: caption.includes('TRY') ? { year: 2023, category: null } : null,
    entryMethod: null,
    ticketBuy: null,
    cashless: null,
    parking: null,
    tableSeating: null,
    nonsmoking: null,
  };
}

// --- 単体テスト用エントリーポイント ---
if (import.meta.url === `file://${process.argv[1]}`) {
  import('dotenv').then(d => d.config());
  setTimeout(async () => {
    const testPosts = [
      {
        caption: '今日は東京・新宿にある麺屋武蔵 新宿本店さんへ！\n濃厚なつけ汁が絡む太麺が最高！\nこれは超うまい！\n\n#ラーメン #新宿 #つけ麺 #麺屋武蔵',
        hashtags: ['#ラーメン', '#新宿', '#つけ麺', '#麺屋武蔵'],
        locationName: '麺屋武蔵 新宿本店',
      },
      {
        caption: 'SUSURUグッズ第3弾、本日から予約受付開始！\n詳しくはプロフィールのリンクから🔗\n\n#SUSURUTV #グッズ',
        hashtags: ['#SUSURUTV', '#グッズ'],
        locationName: null,
      },
    ];

    for (const post of testPosts) {
      console.log('\n--- 入力 ---');
      console.log(post.caption.slice(0, 60) + '...');
      const result = await parseCaption(post);
      console.log('--- 抽出結果 ---');
      console.log(JSON.stringify(result, null, 2));
    }
  }, 100);
}

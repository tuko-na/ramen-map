import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { writeJsonAtomic } from './utils.js';

const DICT_PATH = resolve(import.meta.dirname, '../../public/data/rating-mapping.json');

/**
 * 辞書を読み込む
 */
export function loadDictionary() {
  try {
    const raw = readFileSync(DICT_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/**
 * 辞書を保存する
 */
export function saveDictionary(dict) {
  writeJsonAtomic(DICT_PATH, dict);
}

/**
 * 表現を正規化する
 * - 前後の空白除去
 * - 感嘆符等の連続を1つに畳む
 * - 長音の連続を1つに畳む
 * - 全角を半角に、などの処理
 */
export function normalizePhrase(text) {
  if (!text) return '';
  return text
    .trim()
    .replace(/[！!]{2,}/g, '！')
    .replace(/[？?]{2,}/g, '？')
    .replace(/[ー〜-]{2,}/g, 'ー')
    .replace(/[ぁ-んァ-ン]/g, function(s) {
      // 連続する小文字をどう扱うか... ここは単純な連続文字削除に留める
      return s;
    })
    // 連続する文字をある程度まとめるのは難しいので、まずは長音と感嘆符のみ
    .replace(/\n/g, ' ')
    .replace(/\s+/g, ' ');
}

/**
 * 辞書を引いてラベルを返す
 * @param {string} rawPhrase 
 * @returns {string|null} "ちょめめ" | "超超うまい" | "超うまい" | "うまい" | "ignore" | null
 */
export function lookupRating(rawPhrase) {
  if (!rawPhrase) return null;
  const dict = loadDictionary();
  const normalized = normalizePhrase(rawPhrase);
  return dict[normalized] || null;
}

/**
 * 辞書に新しい表現を登録して保存する
 * @param {string} rawPhrase 
 * @param {string} rating 
 */
export function addToDictionary(rawPhrase, rating) {
  if (!rawPhrase || !rating) return;
  const dict = loadDictionary();
  const normalized = normalizePhrase(rawPhrase);
  // 既存のキーがあれば上書きする（人間が手動で上書きするケース）
  dict[normalized] = rating;
  saveDictionary(dict);
}

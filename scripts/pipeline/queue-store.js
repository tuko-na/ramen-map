/**
 * queue-store.js
 * 確認キュー (review-queue.json) の読み書き・管理モジュール
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { writeJsonAtomic } from './utils.js';

/** review-queue.json のパス */
const QUEUE_PATH = resolve(import.meta.dirname, '../../public/data/review-queue.json');

/**
 * review-queue.json を読み込む
 * @returns {Array}
 */
export function loadQueue() {
  try {
    const raw = readFileSync(QUEUE_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

/**
 * review-queue.json を安全に保存する（アトミック書き込み）
 * @param {Array} queue
 */
export function saveQueue(queue) {
  writeJsonAtomic(QUEUE_PATH, queue);
  console.log(`[queue] review-queue.json を保存しました (${queue.length} 件)`);
}

/**
 * review-queue.json の全 postId を収集する
 * @param {Array} queue
 * @returns {Set<string>}
 */
export function getQueuePostIds(queue) {
  return new Set(queue.map(item => item.postId));
}

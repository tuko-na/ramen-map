/**
 * index.js
 * パイプライン統合オーケストレーター
 *
 * 責務:
 *   1. ramen-shops.json の processedIds + review-queue.json の postId を読み込み、未処理投稿のみ抽出
 *   2. parser.js で一次抽出 → isRamenPost === false ならスキップ
 *   3. geocoder.js で位置解決
 *   4. rating 確定 AND 位置1件確定 → finalize.js で補完・営業時間・YouTube逆引き・Upsert
 *   5. rating null OR 位置複数/0件 → review-queue.json に退避（都度保存）
 *   6. 結果サマリーを出力して終了
 */

import 'dotenv/config';

import { fetchLatestPosts } from './instagram-client.js';
import { parseCaption } from './parser.js';
import { resolveLocation } from './geocoder.js';
import { loadShopData, getAllProcessedIds } from './merger.js';
import { loadQueue, saveQueue, getQueuePostIds } from './queue-store.js';
import { finalizeShop } from './finalize.js';
import { safeErrorMessage } from './utils.js';

/**
 * パイプラインのメインエントリーポイント
 */
async function runPipeline() {
  console.log('=== ラーメンマップ データ収集パイプライン開始 ===');
  console.log(`実行日時: ${new Date().toISOString()}`);

  // 1. 既存データ読み込み
  const geojson = loadShopData();
  const queue = loadQueue();
  const processedIds = getAllProcessedIds(geojson);
  const queuePostIds = getQueuePostIds(queue);

  console.log(`\n[pipeline] 既存店舗: ${geojson.features.length} 件`);
  console.log(`[pipeline] 処理済み投稿ID: ${processedIds.size} 件`);
  console.log(`[pipeline] 確認キュー: ${queue.length} 件`);

  // 2. Instagram 最新投稿を取得
  const posts = await fetchLatestPosts({ maxPosts: 20 });
  console.log(`\n[pipeline] 取得投稿: ${posts.length} 件`);

  // 3. 未処理投稿のみフィルタリング
  // 重複判定: ramen-shops.json の processedIds と review-queue.json の postId の両方を確認
  const newPosts = posts.filter(p =>
    !processedIds.has(p.postId) && !queuePostIds.has(p.postId)
  );
  console.log(`[pipeline] 未処理投稿: ${newPosts.length} 件`);

  if (newPosts.length === 0) {
    console.log('\n[pipeline] 新規投稿はありません。処理を終了します。');
    return;
  }

  // 4. 各投稿を処理
  let addedCount = 0;
  let queuedCount = 0;
  let skippedCount = 0;

  for (const post of newPosts) {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`[pipeline] 処理中: ${post.postId}`);
    console.log(`[pipeline] URL: ${post.postUrl}`);

    try {
      // 4-1. Gemini 一次抽出
      const extracted = await parseCaption(post);

      // 4-2. 非ラーメン投稿のスキップ
      if (!extracted.isRamenPost) {
        console.log('[pipeline] 非ラーメン投稿 → スキップ');
        skippedCount++;
        continue;
      }

      // 4-3. 位置解決
      const geoResult = await resolveLocation(extracted.name, extracted.area_hint);

      // 4-4. 退避判定: rating null OR 位置未確定
      const reasons = [];
      if (!extracted.rating) reasons.push('RATING_MISSING');
      if (geoResult.isPendingLocation) reasons.push(geoResult.reason);

      if (reasons.length > 0) {
        // review-queue.json に退避（都度保存：クラッシュ時のデータ消失を防ぐ）
        console.log(`[pipeline] 確認キューに退避: reasons=${reasons.join(', ')}`);
        queue.push({
          postId: post.postId,
          postUrl: post.postUrl,
          caption: post.caption,
          extracted,
          reasons,
          candidates: geoResult.candidates,
          createdAt: new Date().toISOString(),
        });
        saveQueue(queue);
        queuedCount++;
        continue;
      }

      // 4-5. 自動確定ルート (finalize.js への委譲)
      // finalize.js 内で ramen-shops.json への保存も1件ごとに行われる
      await finalizeShop(post, extracted, geoResult.place);
      addedCount++;

    } catch (err) {
      console.error(`[pipeline] 投稿 ${post.postId} の処理中にエラー: ${safeErrorMessage(err)}`);
    }
  }

  // 5. 結果サマリー
  console.log(`\n${'═'.repeat(60)}`);
  console.log('=== パイプライン完了 ===');
  console.log(`  追加/更新: ${addedCount} 件`);
  console.log(`  キュー退避: ${queuedCount} 件`);
  console.log(`  スキップ: ${skippedCount} 件`);
  const finalGeojson = loadShopData();
  console.log(`  総店舗数: ${finalGeojson.features.length} 件`);
  console.log(`  未確定キュー: ${queue.length} 件`);
}

// 実行
runPipeline().catch(err => {
  console.error(`[pipeline] 致命的エラー: ${safeErrorMessage(err)}`);
  process.exit(1);
});

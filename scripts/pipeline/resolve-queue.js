/**
 * resolve-queue.js
 * 確認キュー (review-queue.json) の対話型解消 CLI スクリプト
 *
 * 使い方:
 *   npm run resolve-queue
 *
 * 責務:
 *   - review-queue.json を順次読み込み、コンソールに対話メニューを表示
 *   - 位置複数候補 → 番号入力で確定
 *   - 位置0件 → 手打ち再検索 / Place ID 直接入力 / 保留 / 破棄
 *   - 評価未確定 → 1〜4の番号選択で確定
 *   - 両方未確定 → 1回の対話で両方解消
 *   - 解消完了後 → finalize.js 経由で補完・営業時間・YouTubeを取得し ramen-shops.json へ統合
 */

import 'dotenv/config';
import { createInterface } from 'node:readline';

import { resolveLocation, fetchPlaceDetailsForId } from './geocoder.js';
import { loadQueue, saveQueue } from './queue-store.js';
import { finalizeShop } from './finalize.js';
import { safeErrorMessage } from './utils.js';

const RATING_OPTIONS = ['ちょめめ', '超超うまい', '超うまい', 'うまい'];

/**
 * readline の Promise ラッパー
 */
function createPrompt() {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = (question) => new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });

  return { rl, ask };
}

/**
 * メイン処理
 */
async function main() {
  const queue = loadQueue();

  if (queue.length === 0) {
    console.log('✅ 確認キューは空です。解消すべき項目はありません。');
    return;
  }

  console.log(`\n📋 確認キュー: ${queue.length} 件の未確定データがあります\n`);

  const { rl, ask } = createPrompt();
  const resolvedIndices = [];

  for (let i = 0; i < queue.length; i++) {
    const item = queue[i];

    console.log(`${'─'.repeat(60)}`);
    console.log(`📌 [${i + 1}/${queue.length}] ${item.extracted?.name || '（店名不明）'}`);
    console.log(`   投稿: ${item.postUrl}`);
    console.log(`   理由: ${item.reasons.join(', ')}`);
    console.log(`   キャプション: ${(item.caption || '').slice(0, 80)}...`);
    console.log();

    let resolvedPlace = null;
    let resolvedRating = item.extracted?.rating || null;

    // --- 位置解決 ---
    if (item.reasons.includes('LOCATION_AMBIGUOUS')) {
      console.log('📍 位置の候補が複数あります:');
      item.candidates.forEach((c, idx) => {
        console.log(`   ${idx + 1}. ${c.name} (${c.address})`);
      });
      console.log();

      const choice = await ask('番号を入力して確定してください (s=スキップ, d=破棄): ');

      if (choice.toLowerCase() === 'd') {
        console.log('🗑️ 破棄しました\n');
        resolvedIndices.push(i);
        continue;
      } else if (choice.toLowerCase() === 's') {
        console.log('⏭️ スキップしました\n');
        continue;
      }

      const num = parseInt(choice, 10);
      if (num >= 1 && num <= item.candidates.length) {
        resolvedPlace = item.candidates[num - 1];
        console.log(`✅ "${resolvedPlace.name}" に確定しました\n`);
      } else {
        console.log('⚠️ 無効な入力です。スキップします\n');
        continue;
      }

    } else if (item.reasons.includes('LOCATION_NOT_FOUND')) {
      console.log('📍 位置が見つかりませんでした。');
      console.log('   1. キーワードを入力して再検索');
      console.log('   2. Google Place ID を直接入力');
      console.log('   3. スキップ（保留）');
      console.log('   4. 破棄');
      console.log();

      const choice = await ask('選択してください (1-4): ');

      if (choice === '1') {
        const keyword = await ask('検索キーワードを入力: ');
        const result = await resolveLocation(keyword, null);
        if (result.resolved && result.place) {
          resolvedPlace = result.place;
          console.log(`✅ "${resolvedPlace.name}" (${resolvedPlace.address}) に確定しました\n`);
        } else if (result.candidates.length > 0) {
          console.log('候補:');
          result.candidates.forEach((c, idx) => {
            console.log(`   ${idx + 1}. ${c.name} (${c.address})`);
          });
          const num = await ask('番号を入力: ');
          const idx = parseInt(num, 10) - 1;
          if (idx >= 0 && idx < result.candidates.length) {
            resolvedPlace = result.candidates[idx];
            console.log(`✅ "${resolvedPlace.name}" に確定しました\n`);
          } else {
            console.log('⚠️ スキップします\n');
            continue;
          }
        } else {
          console.log('❌ 見つかりませんでした。スキップします\n');
          continue;
        }
      } else if (choice === '2') {
        const placeId = await ask('Google Place ID を入力: ');
        const details = await fetchPlaceDetailsForId(placeId);
        if (details) {
          resolvedPlace = details;
          console.log(`✅ Place ID "${placeId}" ("${resolvedPlace.name}") で確定しました\n`);
        } else {
          console.log(`❌ Place ID から情報を取得できませんでした。スキップします\n`);
          continue;
        }
      } else if (choice === '4') {
        console.log('🗑️ 破棄しました\n');
        resolvedIndices.push(i);
        continue;
      } else {
        console.log('⏭️ スキップしました\n');
        continue;
      }
    }

    // --- 評価解決 ---
    if (item.reasons.includes('RATING_MISSING') || !resolvedRating) {
      console.log('⭐ 味の評価を選択してください:');
      RATING_OPTIONS.forEach((r, idx) => {
        console.log(`   ${idx + 1}. ${r}`);
      });
      console.log('   5. スキップ（保留）');
      console.log();

      const choice = await ask('番号を入力: ');
      const num = parseInt(choice, 10);

      if (num >= 1 && num <= 4) {
        resolvedRating = RATING_OPTIONS[num - 1];
        console.log(`✅ 評価: "${resolvedRating}" に確定しました\n`);
      } else {
        console.log('⏭️ スキップしました\n');
        continue;
      }
    }

    // --- 位置が確定していない場合（位置は問題なく、評価のみ未確定だった場合）---
    if (!resolvedPlace && item.candidates?.length === 1) {
      resolvedPlace = item.candidates[0];
    } else if (!resolvedPlace) {
      // 位置の問題がなかった場合、geocoder で再解決
      const geoResult = await resolveLocation(
        item.extracted?.name || '',
        item.extracted?.area_hint || null
      );
      if (geoResult.resolved && geoResult.place) {
        resolvedPlace = geoResult.place;
      } else {
        console.log('⚠️ 位置が解決できませんでした。スキップします\n');
        continue;
      }
    }

    // --- 確定処理 ---
    console.log('🔄 補完処理を実行中...');
    
    await finalizeShop(
      item,
      { ...item.extracted, rating: resolvedRating },
      resolvedPlace
    );

    resolvedIndices.push(i);
    console.log(`✅ "${resolvedPlace.name}" を ramen-shops.json に統合しました\n`);
  }

  // --- キューから解決済み項目を削除 ---
  const updatedQueue = queue.filter((_, i) => !resolvedIndices.includes(i));
  saveQueue(updatedQueue);

  rl.close();

  console.log(`${'═'.repeat(60)}`);
  console.log(`✅ 解消: ${resolvedIndices.length} 件`);
  console.log(`⏳ 残りキュー: ${updatedQueue.length} 件`);

  if (resolvedIndices.length > 0) {
    console.log(`\n💡 変更をリポジトリに反映するには:`);
    console.log(`   git pull --rebase origin main && git add -A && git commit -m "resolve: キュー ${resolvedIndices.length} 件解消" && git push`);
  }
}

main().catch(err => {
  console.error('エラー:', safeErrorMessage(err));
  process.exit(1);
});

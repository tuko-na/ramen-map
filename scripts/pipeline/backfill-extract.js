import 'dotenv/config';
import { createInterface } from 'node:readline';
import { fetchLatestPosts } from './instagram-client.js';
import { GoogleGenAI } from '@google/genai';
import { parseSafeJson, withRetry, geminiThrottle } from './utils.js';
import { normalizePhrase, addToDictionary, lookupRating } from './rating-dictionary.js';

const RATING_OPTIONS = ['ちょめめ', '超超うまい', '超うまい', 'うまい'];

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

async function extractRatingOnly(post) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { raw_rating_phrase: null, rating_inferred: null };

  const ai = new GoogleGenAI({ apiKey });
  
  const schema = {
    type: 'object',
    properties: {
      raw_rating_phrase: { type: ['string', 'null'] },
      rating_inferred: {
        type: ['string', 'null'],
        enum: ['ちょめめ', '超超うまい', '超うまい', 'うまい', null],
      },
    },
    required: ['raw_rating_phrase', 'rating_inferred']
  };

  const prompt = [
    'あなたはラーメンYouTuber「SUSURU」のInstagram投稿を分析するアシスタントです。',
    '以下のInstagram投稿キャプションから、味の評価表現のみを抽出してください。',
    '- raw_rating_phrase: キャプション中の味の評価に相当する原文表現（例: "ウンメエ！"）',
    '- rating_inferred: 原文から推測される公式ラベル（ちょめめ / 超超うまい / 超うまい / うまい / null）',
    `キャプション: ${post.caption}`
  ].join('\n');

  await geminiThrottle();
  // 追加のディレイ（レートリミット対策）
  await new Promise(r => setTimeout(r, 1000));

  const response = await withRetry(() => ai.models.generateContent({
    model: 'gemini-3.7-flash',
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: schema,
    },
  }));

  return parseSafeJson(response.text);
}

async function main() {
  const { rl, ask } = createPrompt();
  
  const limitStr = await ask('取得する過去投稿の件数を入力してください (例: 100): ');
  const limit = parseInt(limitStr, 10) || 100;

  console.log(`\nApifyから過去 ${limit} 件の投稿を取得します...`);
  const posts = await fetchLatestPosts({ maxPosts: limit });
  console.log(`${posts.length} 件取得しました。\n`);

  console.log('Gemini API で評価フレーズの抽出を開始します（時間がかかります）...');
  
  const phraseCounts = {};
  const inferredMap = {}; // 推測値も参考のために保持

  let processed = 0;
  for (const post of posts) {
    if (!post.caption) continue;
    
    // ラーメン投稿かどうかの簡易判定
    if (!post.caption.includes('ラーメン') && !post.caption.includes('らーめん') && !post.caption.includes('麺') && !post.caption.includes('つけ')) {
      continue;
    }

    processed++;
    process.stdout.write(`\r抽出中... ${processed}/${posts.length} `);

    try {
      const extracted = await extractRatingOnly(post);
      if (extracted.raw_rating_phrase) {
        const norm = normalizePhrase(extracted.raw_rating_phrase);
        if (norm) {
          phraseCounts[norm] = (phraseCounts[norm] || 0) + 1;
          // 一番最初に出た推測値を保持
          if (!inferredMap[norm]) inferredMap[norm] = extracted.rating_inferred;
        }
      }
    } catch (err) {
      // エラーは無視して続行
    }
  }
  console.log('\n抽出完了。\n');

  // 未登録のものだけフィルタリングして頻度順にソート
  const unknownPhrases = Object.keys(phraseCounts)
    .filter(phrase => lookupRating(phrase) === null)
    .map(phrase => ({
      phrase,
      count: phraseCounts[phrase],
      inferred: inferredMap[phrase]
    }))
    .sort((a, b) => b.count - a.count);

  if (unknownPhrases.length === 0) {
    console.log('辞書に未登録の新しいフレーズは見つかりませんでした。');
    rl.close();
    return;
  }

  const totalUnknown = unknownPhrases.reduce((sum, item) => sum + item.count, 0);
  console.log(`辞書未登録のフレーズが ${unknownPhrases.length} 種類（合計 ${totalUnknown} 回）見つかりました。\n`);

  // 上位20件を表示
  console.log('=== 出現頻度上位の未登録フレーズ ===');
  let cumulative = 0;
  for (let i = 0; i < Math.min(20, unknownPhrases.length); i++) {
    const item = unknownPhrases[i];
    cumulative += item.count;
    const cov = ((cumulative / totalUnknown) * 100).toFixed(1);
    console.log(`${i + 1}. "${item.phrase}" (${item.count}回, 累積カバー率: ${cov}%) - 推測: ${item.inferred}`);
  }

  const doRegister = await ask('\n上位のフレーズを今すぐ一括登録しますか？ (y/n): ');
  if (doRegister.toLowerCase() !== 'y') {
    console.log('終了します。');
    rl.close();
    return;
  }

  const registerCountStr = await ask(`何件目まで登録しますか？ (1-${unknownPhrases.length}): `);
  const registerCount = parseInt(registerCountStr, 10) || 5;

  for (let i = 0; i < Math.min(registerCount, unknownPhrases.length); i++) {
    const item = unknownPhrases[i];
    console.log(`\n---------------------------------`);
    console.log(`対象: "${item.phrase}" (出現 ${item.count}回)`);
    console.log(`Gemini推測: ${item.inferred}`);
    
    RATING_OPTIONS.forEach((r, idx) => console.log(`${idx + 1}. ${r}`));
    console.log('5. スキップ (登録しない)');
    console.log('6. 適用外 (ignore/破棄)');

    const choice = await ask('番号を選択: ');
    const num = parseInt(choice, 10);

    if (num >= 1 && num <= 4) {
      addToDictionary(item.phrase, RATING_OPTIONS[num - 1]);
      console.log(`✅ "${RATING_OPTIONS[num - 1]}" として登録しました`);
    } else if (num === 6) {
      addToDictionary(item.phrase, 'ignore');
      console.log(`✅ "ignore" として登録しました`);
    } else {
      console.log('⏭️ スキップしました');
    }
  }

  console.log('\n🎉 一括登録が完了しました！');
  rl.close();
}

main().catch(console.error);

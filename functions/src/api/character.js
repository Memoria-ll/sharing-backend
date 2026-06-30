// キャラクターデータ関連のAPI実装

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const db = admin.firestore();

// ユーティリティ関数のインポート
const { processOperatorData, isValidationError } = require('../utils/dataProcessor');
const { generateUniqueId } = require('../utils/idGenerator');

const MAX_REQUEST_BYTES = 128 * 1024;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * キャラクターデータを保存するCallable関数
 */
exports.saveCharacterData = functions.https.onCall(async (data, context) => {
  try {
    // 入力データのバリデーション
    if (!data) {
      throw new functions.https.HttpsError('invalid-argument', 'データが提供されていません');
    }

    validateCallablePayloadSize(data);

    // IDが提供されているか確認（更新ケース）
    const existingId = data.id;
    validateOptionalId(existingId);

    // データ部分の取得
    const characterData = data.data || data;

    // データを処理して必要な情報だけを抽出
    const processedData = processOperatorData(characterData);

    return await saveProcessedData(existingId, processedData);
  } catch (error) {
    console.error('データ保存エラー:', error);

    if (isValidationError(error)) {
      throw new functions.https.HttpsError('invalid-argument', error.message);
    }

    throw new functions.https.HttpsError('internal', error.message);
  }
});

/**
 * キャラクターデータを取得するCallable関数
 */
exports.getCharacterData = functions.https.onCall(async (data, context) => {
  try {
    // IDのバリデーション
    if (!data || !data.id) {
      throw new functions.https.HttpsError('invalid-argument', 'IDが提供されていません');
    }

    validateRequiredId(data.id);

    // Firestoreからデータを取得
    const doc = await db.collection('characterData').doc(data.id).get();

    if (!doc.exists) {
      throw new functions.https.HttpsError('not-found', 'データが見つかりませんでした');
    }

    // データを返す
    return doc.data();
  } catch (error) {
    console.error('データ取得エラー:', error);

    if (error instanceof functions.https.HttpsError) {
      throw error;
    }

    throw new functions.https.HttpsError('internal', error.message);
  }
});

/**
 * HTTP経由でデータを保存するハンドラー
 */
exports.handleSaveRequest = async (req, res) => {
  // POSTリクエストのみ許可
  if (req.method !== 'POST') {
    return res.status(405).send({ error: 'Method Not Allowed' });
  }

  const sizeValidation = validateHttpRequestSize(req);
  if (!sizeValidation.valid) {
    return res.status(413).send({ error: sizeValidation.message });
  }

  try {
    // データが提供されているか確認
    if (!req.body) {
      return res.status(400).send({ error: 'リクエストにデータがありません' });
    }

    // IDが提供されているか確認（更新ケース）
    const existingId = req.body.id;
    validateOptionalId(existingId);

    // データ部分の取得（idがプロパティとして含まれる場合とそうでない場合に対応）
    const characterData = req.body.data || req.body;

    // データを処理して必要な情報だけを抽出
    const processedData = processOperatorData(characterData);

    const result = await saveProcessedData(existingId, processedData);
    return res.status(200).json(result);
  } catch (error) {
    console.error('データ保存エラー:', error);

    if (isValidationError(error)) {
      return res.status(400).send({ error: error.message });
    }

    return res.status(500).send({ error: 'データの保存に失敗しました: ' + error.message });
  }
};

/**
 * HTTP経由でデータを取得するハンドラー
 */
exports.handleGetRequest = async (req, res) => {
  // GETリクエストのみ許可
  if (req.method !== 'GET') {
    return res.status(405).send({ error: 'Method Not Allowed' });
  }

  try {
    // URLクエリからIDを取得
    const id = req.query.id;
    if (!id) {
      return res.status(400).send({ error: 'IDパラメータが必要です' });
    }

    validateRequiredId(id);

    // Firestoreからデータを取得
    const doc = await db.collection('characterData').doc(id).get();

    if (!doc.exists) {
      return res.status(404).send({ error: 'データが見つかりませんでした' });
    }

    // データを返す
    return res.status(200).json(doc.data());
  } catch (error) {
    console.error('データ取得エラー:', error);

    if (isValidationError(error)) {
      return res.status(400).send({ error: error.message });
    }

    return res.status(500).send({ error: 'データの取得に失敗しました: ' + error.message });
  }
};

/**
 * 期限切れのデータをクリーンアップする関数
 * 最終更新から5年経過したデータを削除
 */
exports.cleanupExpiredData = async () => {
  try {
    const now = admin.firestore.Timestamp.now();
    const expiredRef = await db.collection('characterData')
      .where('expiresAt', '<', now)
      .get();

    if (expiredRef.empty) {
      console.log('期限切れのデータはありません');
      return null;
    }

    const batch = db.batch();
    expiredRef.docs.forEach(doc => {
      batch.delete(doc.ref);
    });

    await batch.commit();
    console.log(`${expiredRef.docs.length}件の期限切れデータを削除しました`);
    return null;
  } catch (error) {
    console.error('クリーンアップエラー:', error);
    return null;
  }
};

/**
 * 処理済みデータを保存または更新する。
 *
 * @param {string|undefined} existingId 既存ID
 * @param {Array} processedData 処理済みデータ
 * @returns {Promise<Object>} 保存結果
 */
async function saveProcessedData(existingId, processedData) {
  let docId;
  const now = admin.firestore.FieldValue.serverTimestamp();
  const fiveYearsLater = admin.firestore.Timestamp.fromDate(
    new Date(Date.now() + 1000 * 60 * 60 * 24 * 365 * 5) // 5年後
  );

  if (existingId) {
    // 既存IDが提供された場合は、そのドキュメントが存在するか確認
    const docRef = db.collection('characterData').doc(existingId);
    const doc = await docRef.get();

    if (doc.exists) {
      // ドキュメントが存在する場合は更新
      await docRef.update({
        characters: processedData,
        updatedAt: now,
        expiresAt: fiveYearsLater
      });
      docId = existingId;
      console.log(`ID ${existingId} のデータを更新しました`);
    } else {
      // 指定されたIDが存在しない場合は新規作成
      docId = await generateUniqueId();
      await db.collection('characterData').doc(docId).set({
        characters: processedData,
        createdAt: now,
        updatedAt: now,
        expiresAt: fiveYearsLater
      });
      console.log(`ID ${existingId} は存在しないため、新規ID ${docId} を作成しました`);
    }
  } else {
    // IDが提供されていない場合は新規作成
    docId = await generateUniqueId();
    await db.collection('characterData').doc(docId).set({
      characters: processedData,
      createdAt: now,
      updatedAt: now,
      expiresAt: fiveYearsLater
    });
    console.log(`新規ID ${docId} でデータを作成しました`);
  }

  // 生成または使用されたIDを返す
  return { id: docId };
}

/**
 * HTTPリクエストサイズを検証する。
 *
 * @param {Object} req HTTPリクエスト
 * @returns {Object} 検証結果
 */
function validateHttpRequestSize(req) {
  const contentLength = Number(req.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return { valid: false, message: 'リクエストサイズが大きすぎます' };
  }

  if (req.rawBody && req.rawBody.length > MAX_REQUEST_BYTES) {
    return { valid: false, message: 'リクエストサイズが大きすぎます' };
  }

  return { valid: true };
}

/**
 * Callable関数のペイロードサイズを検証する。
 *
 * @param {Object} data Callable ペイロード
 */
function validateCallablePayloadSize(data) {
  const byteLength = Buffer.byteLength(JSON.stringify(data), 'utf8');
  if (byteLength > MAX_REQUEST_BYTES) {
    const error = new Error('リクエストサイズが大きすぎます');
    error.code = 'invalid-argument';
    throw error;
  }
}

/**
 * 任意IDを検証する。
 *
 * @param {string|undefined} id 共有ID
 */
function validateOptionalId(id) {
  if (id === undefined || id === null || id === '') return;
  validateRequiredId(id);
}

/**
 * 必須IDを検証する。
 *
 * @param {string} id 共有ID
 */
function validateRequiredId(id) {
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
    const error = new Error('ID形式が不正です');
    error.code = 'invalid-argument';
    throw error;
  }
}

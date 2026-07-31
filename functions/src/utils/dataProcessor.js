/**
 * キャラクターデータを処理するユーティリティ関数
 */

const MAX_OPERATOR_COUNT = 1000;
// 実データの code は最大 6 文字。余裕を持たせつつ異常値を弾く。
const MAX_CODE_LENGTH = 10;
const CODE_PATTERN = /^[A-Za-z0-9_-]+$/;

// CurrentLevel のキーをモジュールとして受理する形式。前置詞は Module/module の2種のみ、
// 接尾辞は大文字A-Zと数字のみ1〜4文字（小文字を許すとPascalCase英単語フィールドと衝突し
// リクエスト全体が400になる）。
const MODULE_KEY_PATTERN = /^(?:Module|module)([A-Z0-9]{1,4})$/;
// MODULE_KEY_PATTERN には一致しないが Module/module 前置詞は一致するキーを検出する。
// 沈黙のデータ欠落（未知のモジュール接尾辞が無警告で無視される）を可観測にするための near-miss 判定。
const MODULE_NEAR_MISS_PATTERN = /^(?:Module|module)./;
const MODULE_RANGE = { min: 0, max: 3, defaultValue: 0 };
// ユニオンは1件のモジュール数を全件に増幅する（1件がNキー持つだけで保存される全1000件がNキーになる）。
// 入力サイズはNにほぼ依存しないため MAX_REQUEST_BYTES では止まらない。上限は必ずユニオン側に掛ける。
// 接尾辞1文字・1000件で Firestore の 1MiB 上限を破るのは N=59。N=20 なら約437KB（42%）。
const MAX_MODULE_COUNT = 20;

const RANGES = {
  potential: { min: 1, max: 6, defaultValue: 1 },
  elite: { min: 0, max: 2, defaultValue: 0 },
  level: { min: 1, max: 90, defaultValue: 1 },
  skill: { min: 1, max: 7, defaultValue: 7 },
  skill1: { min: 0, max: 3, defaultValue: 0 },
  skill2: { min: 0, max: 3, defaultValue: 0 },
  skill3: { min: 0, max: 3, defaultValue: 0 }
};

/**
 * 入力データから必要な情報だけを抽出し、整形する
 * @param {Object|Array} data 入力データ（単一オブジェクトまたは配列）
 * @returns {Array} 処理済みのデータ配列
 */
exports.processOperatorData = (data) => {
  const items = normalizeToArray(data);

  if (items.length === 0) {
    throwValidationError('有効なキャラクターデータがありません');
  }

  if (items.length > MAX_OPERATOR_COUNT) {
    throwValidationError(`キャラクターデータは${MAX_OPERATOR_COUNT}件以内にしてください`);
  }

  const nearMissSink = new Set();
  const suffixes = unionModuleSuffixes(items, nearMissSink);

  const processed = items.map((item, index) => processSingleItem(item, index, suffixes));

  if (nearMissSink.size > 0) {
    console.warn(`未知のモジュール接尾辞を無視しました: ${[...nearMissSink].join(', ')}`);
  }

  return processed;
};

/**
 * バリデーション関数 - 入力データの形式を検証
 * @param {Object} data 検証するデータ
 * @returns {boolean} データが有効かどうか
 */
exports.validateInputData = (data) => {
  try {
    exports.processOperatorData(data);
    return true;
  } catch (error) {
    return false;
  }
};

/**
 * バリデーションエラーかどうかを判定する。
 *
 * @param {Error} error 判定対象のエラー
 * @returns {boolean} バリデーションエラーなら true
 */
exports.isValidationError = (error) => {
  return Boolean(error && error.code === 'invalid-argument');
};

/**
 * 単一または配列の入力を配列化する。
 *
 * @param {Object|Array} data 入力データ
 * @returns {Array} 入力データ配列
 */
function normalizeToArray(data) {
  if (!data) return [];
  return Array.isArray(data) ? data : [data];
}

/**
 * 単一アイテムを検証・整形する。
 *
 * @param {Object} item 入力アイテム
 * @param {number} index 入力配列内の位置
 * @param {Array<string>} suffixes リクエスト全体のモジュール接尾辞ユニオン
 * @returns {Object} 整形済みアイテム
 */
function processSingleItem(item, index, suffixes) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    throwValidationError(`${index + 1}件目のデータ形式が不正です`);
  }

  const code = validateCode(getFirstDefined(item.Code, item.code), index);
  const currentLevel = getFirstDefined(item.CurrentLevel, item.currentLevel) || {};

  if (typeof currentLevel !== 'object' || Array.isArray(currentLevel)) {
    throwValidationError(`${index + 1}件目のCurrentLevel形式が不正です`);
  }

  const result = {
    code: code,
    potential: normalizeInteger(getFirstDefined(item.Potential, item.potential), RANGES.potential, 'Potential', index),
    elite: normalizeInteger(getFirstDefined(currentLevel.Elite, currentLevel.elite), RANGES.elite, 'Elite', index),
    level: normalizeInteger(getFirstDefined(currentLevel.Level, currentLevel.level), RANGES.level, 'Level', index),
    skill: normalizeInteger(getFirstDefined(currentLevel.Skill, currentLevel.skill), RANGES.skill, 'Skill', index),
    skill1: normalizeInteger(getFirstDefined(currentLevel.Skill1, currentLevel.skill1), RANGES.skill1, 'Skill1', index),
    skill2: normalizeInteger(getFirstDefined(currentLevel.Skill2, currentLevel.skill2), RANGES.skill2, 'Skill2', index),
    skill3: normalizeInteger(getFirstDefined(currentLevel.Skill3, currentLevel.skill3), RANGES.skill3, 'Skill3', index)
  };

  assignModuleFields(result, currentLevel, suffixes, index);

  return result;
}

/**
 * 1件の CurrentLevel からモジュール接尾辞を抽出する。
 *
 * @param {Object} currentLevel CurrentLevel オブジェクト
 * @param {Set<string>} nearMissSink near-miss キーの集約先
 * @returns {Array<string>} 接尾辞配列（初出順・重複排除）
 */
function collectModuleSuffixes(currentLevel, nearMissSink) {
  const suffixes = [];
  const seen = new Set();

  for (const key of Object.keys(currentLevel)) {
    const match = key.match(MODULE_KEY_PATTERN);
    if (match) {
      const suffix = match[1];
      if (!seen.has(suffix)) {
        seen.add(suffix);
        suffixes.push(suffix);
      }
      continue;
    }

    if (MODULE_NEAR_MISS_PATTERN.test(key)) {
      nearMissSink.add(key);
    }
  }

  return suffixes;
}

/**
 * リクエスト全体でモジュール接尾辞のユニオンを取る。
 *
 * @param {Array} items 正規化済みアイテム配列
 * @param {Set<string>} nearMissSink near-miss キーの集約先
 * @returns {Array<string>} 接尾辞配列（リクエスト全体・初出順・重複排除）
 */
function unionModuleSuffixes(items, nearMissSink) {
  const suffixes = [];
  const seen = new Set();

  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;

    const currentLevel = getFirstDefined(item.CurrentLevel, item.currentLevel);
    if (!currentLevel || typeof currentLevel !== 'object' || Array.isArray(currentLevel)) continue;

    for (const suffix of collectModuleSuffixes(currentLevel, nearMissSink)) {
      if (!seen.has(suffix)) {
        seen.add(suffix);
        suffixes.push(suffix);

        if (suffixes.length > MAX_MODULE_COUNT) {
          throwValidationError(`モジュール種別は${MAX_MODULE_COUNT}種類以内にしてください`);
        }
      }
    }
  }

  return suffixes;
}

/**
 * 接尾辞リストぶんのモジュールフィールドを PascalCase 優先で読み、target に加える。
 *
 * @param {Object} target 出力オブジェクト
 * @param {Object} currentLevel CurrentLevel オブジェクト
 * @param {Array<string>} suffixes 接尾辞配列
 * @param {number} index 入力配列内の位置
 */
function assignModuleFields(target, currentLevel, suffixes, index) {
  for (const suffix of suffixes) {
    const fieldName = `Module${suffix}`;
    const value = getFirstDefined(currentLevel[fieldName], currentLevel[`module${suffix}`]);
    target[`module${suffix}`] = normalizeInteger(value, MODULE_RANGE, fieldName, index);
  }
}

/**
 * code を検証する。
 *
 * @param {string} value code 値
 * @param {number} index 入力配列内の位置
 * @returns {string} 検証済み code
 */
function validateCode(value, index) {
  if (typeof value !== 'string') {
    throwValidationError(`${index + 1}件目のCodeが不正です`);
  }

  const code = value.trim();
  if (!code) {
    throwValidationError(`${index + 1}件目のCodeが空です`);
  }

  if (code.length > MAX_CODE_LENGTH || !CODE_PATTERN.test(code)) {
    throwValidationError(`${index + 1}件目のCode形式が不正です`);
  }

  return code;
}

/**
 * 整数値を検証・正規化する。
 *
 * @param {*} value 入力値
 * @param {Object} range 許容範囲
 * @param {string} fieldName フィールド名
 * @param {number} index 入力配列内の位置
 * @returns {number} 正規化済み整数
 */
function normalizeInteger(value, range, fieldName, index) {
  const normalizedValue = value === undefined || value === null || value === '' ? range.defaultValue : value;
  const parsed = Number(normalizedValue);

  if (!Number.isInteger(parsed) || parsed < range.min || parsed > range.max) {
    throwValidationError(
      `${index + 1}件目の${fieldName}は${range.min}〜${range.max}の整数にしてください`
    );
  }

  return parsed;
}

/**
 * undefined / null ではない最初の値を返す。
 *
 * @param {...*} values 候補値
 * @returns {*} 最初に定義されている値
 */
function getFirstDefined(...values) {
  return values.find(value => value !== undefined && value !== null);
}

/**
 * バリデーションエラーを送出する。
 *
 * @param {string} message エラーメッセージ
 */
function throwValidationError(message) {
  const error = new Error(message);
  error.code = 'invalid-argument';
  throw error;
}

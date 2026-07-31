'use strict';

// 走査契約（MODULE_KEY_PATTERN / ユニオン / Pascal優先）はここに複製しない。
// すべて processOperatorData の出力だけを観測する（seam ルールの real wiring 条項）。

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { processOperatorData } = require('../src/utils/dataProcessor');

/**
 * console.warn を差し替えて呼び出しを記録する。
 * @param {Function} fn 差し替え中に実行する処理
 * @returns {Array<Array<*>>} console.warn への呼び出し引数の配列
 */
function captureWarnings(fn) {
  const calls = [];
  const original = console.warn;
  console.warn = (...args) => { calls.push(args); };
  try {
    fn();
  } finally {
    console.warn = original;
  }
  return calls;
}

// ブリーフ逐語: ModuleX/Y/D/A/B を持つ2件（LM04 / RE10）。値はモジュールごとに異なる。
function fiveModulePayload() {
  return [
    {
      Code: 'LM04',
      Potential: 3,
      CurrentLevel: {
        Elite: 2, Level: 90, Skill: 7, Skill1: 3, Skill2: 0, Skill3: 0,
        ModuleX: 0, ModuleY: 1, ModuleD: 2, ModuleA: 3, ModuleB: 2
      }
    },
    {
      Code: 'RE10',
      Potential: 3,
      CurrentLevel: {
        Elite: 2, Level: 90, Skill: 7, Skill1: 3, Skill2: 0, Skill3: 0,
        ModuleX: 0, ModuleY: 1, ModuleD: 2, ModuleA: 3, ModuleB: 2
      }
    }
  ];
}

// README:52-85 の旧形式2件ペイロード（逐語）。
function legacyReadmePayload() {
  return [
    {
      Code: 'LM04',
      Potential: '3',
      CurrentLevel: {
        Elite: 2, Level: 51, Skill: 7, Skill1: 3, Skill2: 0, Skill3: 0,
        ModuleX: 0, ModuleY: 0, ModuleD: 0, ModuleA: 0
      }
    },
    {
      Code: 'GG01',
      Potential: 6,
      CurrentLevel: {
        Elite: 2, Level: 90, Skill: 7, Skill1: 3, Skill2: 3, Skill3: 3,
        ModuleX: 3, ModuleY: 0, ModuleD: 0, ModuleA: 0
      }
    }
  ];
}

/**
 * 1000件ペイロードを生成する。1件目だけ moduleSuffixes ぶんのモジュールキーを持ち、
 * 残り999件は CurrentLevel 最小構成にする（ユニオン増幅を検査するための形）。
 * @param {Array<string>} moduleSuffixes 1件目に持たせる接尾辞配列
 * @returns {Array<Object>} 1000件ペイロード
 */
function manyItemsWithModulesOnFirst(moduleSuffixes) {
  const currentLevelWithModules = {};
  moduleSuffixes.forEach((suffix, i) => { currentLevelWithModules[`Module${suffix}`] = i % 4; });

  const items = [];
  for (let i = 0; i < 1000; i++) {
    items.push({
      Code: `C${i}`,
      CurrentLevel: i === 0 ? currentLevelWithModules : {}
    });
  }
  return items;
}

/**
 * 1000件ペイロードを生成する。接尾辞集合を2件に分散させる。
 * @param {Array<string>} firstSuffixes 1件目に持たせる接尾辞配列
 * @param {Array<string>} secondSuffixes 2件目に持たせる接尾辞配列
 * @returns {Array<Object>} 1000件ペイロード
 */
function manyItemsWithModulesSplit(firstSuffixes, secondSuffixes) {
  const first = {};
  firstSuffixes.forEach((suffix, i) => { first[`Module${suffix}`] = i % 4; });
  const second = {};
  secondSuffixes.forEach((suffix, i) => { second[`Module${suffix}`] = i % 4; });

  const items = [];
  for (let i = 0; i < 1000; i++) {
    let currentLevel = {};
    if (i === 0) currentLevel = first;
    else if (i === 1) currentLevel = second;
    items.push({ Code: `C${i}`, CurrentLevel: currentLevel });
  }
  return items;
}

// --- a. 5モジュール（ModuleB を含む）リクエストの動的走査 ---

test('a1: 出力2件のいずれも moduleX,moduleY,moduleD,moduleA,moduleB の5キーを持つ', () => {
  const result = processOperatorData(fiveModulePayload());
  for (const item of result) {
    assert.ok('moduleX' in item);
    assert.ok('moduleY' in item);
    assert.ok('moduleD' in item);
    assert.ok('moduleA' in item);
    assert.ok('moduleB' in item);
  }
});

test('a2: 値の対応（モジュールごとに異なる値）', () => {
  const [item] = processOperatorData(fiveModulePayload());
  assert.equal(item.moduleX, 0);
  assert.equal(item.moduleY, 1);
  assert.equal(item.moduleD, 2);
  assert.equal(item.moduleA, 3);
  assert.equal(item.moduleB, 2);
});

test('a3: 2文字以上の接尾辞を受理する', () => {
  const payload = [{
    Code: 'LM04',
    CurrentLevel: { ModuleXY: 2, ModuleA2: 1, Module1: 3 }
  }];
  const [item] = processOperatorData(payload);
  assert.equal(item.moduleXY, 2);
  assert.equal(item.moduleA2, 1);
  assert.equal(item.module1, 3);
});

test('a4: 出力キーの順序が非モジュール8フィールド + 接尾辞初出順と完全一致', () => {
  const [item] = processOperatorData(fiveModulePayload());
  assert.deepStrictEqual(Object.keys(item), [
    'code', 'potential', 'elite', 'level', 'skill', 'skill1', 'skill2', 'skill3',
    'moduleX', 'moduleY', 'moduleD', 'moduleA', 'moduleB'
  ]);
});

// --- b. 大小文字の優先順（罠2） ---

test('b1: PascalCase が camelCase より優先される', () => {
  const payload = [{ Code: 'LM04', CurrentLevel: { ModuleX: 3, moduleX: 1 } }];
  const [item] = processOperatorData(payload);
  assert.equal(item.moduleX, 3);
});

test('b2: キー順を逆にしても PascalCase が優先される', () => {
  const payload = [{ Code: 'LM04', CurrentLevel: { moduleX: 1, ModuleX: 3 } }];
  const [item] = processOperatorData(payload);
  assert.equal(item.moduleX, 3);
});

test('b3: camelCase 単独でも拾われる', () => {
  const payload = [{ Code: 'LM04', CurrentLevel: { moduleB: 2 } }];
  const [item] = processOperatorData(payload);
  assert.equal(item.moduleB, 2);
});

// --- c. 不正接尾辞の無視と near-miss 警告 ---

test('c1: 不正接尾辞キーは throw せず無視される', () => {
  const payload = [{
    Code: 'LM04',
    CurrentLevel: {
      ModuleX: 1, ModuleName: 'foo', ModuleCount: 'x', Modules: {},
      MODULEX: 2, Modulex: 2, ModuleTOOLONG: 1, Rarity: '☆6', Trust: 100
    }
  }];
  let result;
  assert.doesNotThrow(() => { result = processOperatorData(payload); });
  const [item] = result;
  assert.deepStrictEqual(
    Object.keys(item).filter(k => k.startsWith('module')),
    ['moduleX']
  );
  assert.equal(item.moduleX, 1);
});

test('c2: near-miss 警告は1回、対象キーのみ含む', () => {
  const payload = [{
    Code: 'LM04',
    CurrentLevel: {
      ModuleX: 1, ModuleName: 'foo', ModuleCount: 'x', Modules: {},
      MODULEX: 2, Modulex: 2, ModuleTOOLONG: 1, Rarity: '☆6', Trust: 100
    }
  }];
  const calls = captureWarnings(() => processOperatorData(payload));
  assert.equal(calls.length, 1);
  const message = calls[0].join(' ');
  assert.match(message, /ModuleName/);
  assert.match(message, /ModuleCount/);
  assert.match(message, /Modules/);
  assert.match(message, /Modulex/);
  assert.match(message, /ModuleTOOLONG/);
  assert.doesNotMatch(message, /\bModuleX\b/);
  assert.doesNotMatch(message, /MODULEX/);
});

test('c3: 正常系（5モジュール）では console.warn が0回', () => {
  const calls = captureWarnings(() => processOperatorData(fiveModulePayload()));
  assert.equal(calls.length, 0);
});

test('c4: 1000件すべてに ModuleName があっても console.warn は1回だけ', () => {
  const items = [];
  for (let i = 0; i < 1000; i++) {
    items.push({ Code: `C${i}`, CurrentLevel: { ModuleName: 'foo' } });
  }
  const calls = captureWarnings(() => processOperatorData(items));
  assert.equal(calls.length, 1);
});

// --- d. 既存挙動の回帰ピン ---

test('d1: README旧形式2件ペイロードの出力が現行の値・キー順と完全一致', () => {
  const result = processOperatorData(legacyReadmePayload());
  assert.deepStrictEqual(result, [
    {
      code: 'LM04', potential: 3, elite: 2, level: 51, skill: 7, skill1: 3, skill2: 0, skill3: 0,
      moduleX: 0, moduleY: 0, moduleD: 0, moduleA: 0
    },
    {
      code: 'GG01', potential: 6, elite: 2, level: 90, skill: 7, skill1: 3, skill2: 3, skill3: 3,
      moduleX: 3, moduleY: 0, moduleD: 0, moduleA: 0
    }
  ]);
  const expectedKeyOrder = [
    'code', 'potential', 'elite', 'level', 'skill', 'skill1', 'skill2', 'skill3',
    'moduleX', 'moduleY', 'moduleD', 'moduleA'
  ];
  assert.deepStrictEqual(Object.keys(result[0]), expectedKeyOrder);
  assert.deepStrictEqual(Object.keys(result[1]), expectedKeyOrder);
});

test('d2: モジュール範囲外の値は既存メッセージ流儀で throw する', () => {
  const payload = [{ Code: 'LM04', CurrentLevel: { ModuleB: 4 } }];
  assert.throws(() => processOperatorData(payload), (error) => {
    assert.equal(error.code, 'invalid-argument');
    assert.equal(error.message, '1件目のModuleBは0〜3の整数にしてください');
    return true;
  });
});

test('d3: 2件目が null → 既存のデータ形式エラー', () => {
  const payload = [
    { Code: 'LM04', CurrentLevel: { ModuleX: 1 } },
    null
  ];
  assert.throws(() => processOperatorData(payload), (error) => {
    assert.equal(error.message, '2件目のデータ形式が不正です');
    return true;
  });
});

test('d3: CurrentLevel が配列 → 既存のCurrentLevel形式エラー', () => {
  const payload = [{ Code: 'LM04', CurrentLevel: [] }];
  assert.throws(() => processOperatorData(payload), (error) => {
    assert.equal(error.message, '1件目のCurrentLevel形式が不正です');
    return true;
  });
});

test('d4: 空文字/nullはデフォルト値扱い（throwしない、罠3の既存経路）', () => {
  const payload = [{ Code: 'LM04', CurrentLevel: { ModuleX: '', ModuleY: null, ModuleB: 2 } }];
  const [item] = processOperatorData(payload);
  assert.equal(item.moduleX, 0);
  assert.equal(item.moduleY, 0);
  assert.equal(item.moduleB, 2);
});

test('d5: 1001件 → 件数エラー（ユニオン計算より前に検証される）', () => {
  const items = [];
  for (let i = 0; i < 1001; i++) {
    items.push({ Code: `C${i}`, CurrentLevel: {} });
  }
  assert.throws(() => processOperatorData(items), (error) => {
    assert.equal(error.message, 'キャラクターデータは1000件以内にしてください');
    return true;
  });
});

// --- e. §3.2 のユニオン仕様（意図された挙動） ---

test('e1: アイテムごとに欠けている接尾辞は0で埋まる（ラギッドにしない）', () => {
  const payload = [
    { Code: 'LM04', CurrentLevel: { ModuleX: 1 } },
    { Code: 'RE10', CurrentLevel: { ModuleB: 2 } }
  ];
  const [item1, item2] = processOperatorData(payload);
  assert.equal(item1.moduleX, 1);
  assert.equal(item1.moduleB, 0);
  assert.equal(item2.moduleX, 0);
  assert.equal(item2.moduleB, 2);
});

test('e2: モジュールキーが1つも無いペイロードは出力にモジュールキーが0個（意図された差分）', () => {
  const payload = [{ Code: 'LM04', CurrentLevel: { Elite: 2, Level: 90 } }];
  const [item] = processOperatorData(payload);
  const moduleKeys = Object.keys(item).filter(k => k.startsWith('module'));
  assert.deepEqual(moduleKeys, []);
});

// --- f. MAX_MODULE_COUNT = 20 ---

const SUFFIXES_20 = 'ABCDEFGHIJKLMNOPQRST'.split(''); // ModuleA〜ModuleT
const SUFFIXES_21 = 'ABCDEFGHIJKLMNOPQRSTU'.split(''); // ModuleA〜ModuleU

test('f1: 20種類の接尾辞は throw せず全1000件が20モジュールキーを持つ', () => {
  const payload = manyItemsWithModulesOnFirst(SUFFIXES_20);
  const result = processOperatorData(payload);
  assert.equal(result.length, 1000);
  for (const item of result) {
    const moduleKeys = Object.keys(item).filter(k => k.startsWith('module'));
    assert.equal(moduleKeys.length, 20);
  }
});

test('f2: 21種類の接尾辞は invalid-argument で throw する', () => {
  const payload = manyItemsWithModulesOnFirst(SUFFIXES_21);
  assert.throws(() => processOperatorData(payload), (error) => {
    assert.equal(error.code, 'invalid-argument');
    assert.equal(error.message, 'モジュール種別は20種類以内にしてください');
    return true;
  });
});

test('f3: f2の入力サイズは MAX_REQUEST_BYTES(512KB) を下回る（増幅経路の存在の証明）', () => {
  const payload = manyItemsWithModulesOnFirst(SUFFIXES_21);
  const byteLength = Buffer.byteLength(JSON.stringify(payload), 'utf8');
  assert.ok(byteLength < 512 * 1024, `payload size ${byteLength} should be under 512KB`);
});

test('f4: 21種類が2アイテムに分散していても throw する', () => {
  const firstSuffixes = SUFFIXES_21.slice(0, 11);
  const secondSuffixes = SUFFIXES_21.slice(11, 21);
  const payload = manyItemsWithModulesSplit(firstSuffixes, secondSuffixes);
  assert.throws(() => processOperatorData(payload), (error) => {
    assert.equal(error.code, 'invalid-argument');
    assert.equal(error.message, 'モジュール種別は20種類以内にしてください');
    return true;
  });
});

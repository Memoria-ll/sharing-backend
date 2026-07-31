# sharing-backend

Arknights オペレーター育成状況の共有データを受け取り、Firestore に保存して ID 経由で返す
Firebase Cloud Functions。API 仕様は README.md が正。

## Architecture

- 実行形態: Firebase Cloud Functions（Node 22 / `functions/src`）。Callable 2本 + HTTP 2本 +
  スケジュール1本を `functions/src/index.js` がエクスポートする。
- レイヤ境界: `api/` = 入出力とエラー変換（`functions.https.HttpsError` への変換もここ）、
  `utils/` = 純粋ロジック（firebase を require しない）。`utils/dataProcessor.js` は
  firebase 非依存なので依存ゼロで単体テストできる。
- Firestore への直接アクセスはルールで全拒否。読み書きは必ず Cloud Functions 経由。

### テスト seam mapping

| 項目 | 値 |
|---|---|
| ロジック単位（テスト必須） | `functions/src/utils/**` |
| view/IO glue（テスト対象外） | `functions/src/index.js`、`functions/src/api/**` の req/res 取り扱い |
| テスト置き場 | `functions/test-dir/` |
| ゲート | `functions/` で `node --test`（引数なし）。`npm test` も同じ |

## Ledger

### Traps

- モジュール接尾辞のユニオンは増幅経路。1件のアイテムが N キー持つだけで保存される全1000件が N キーになる。入力サイズは N にほぼ依存しない（21種類でも約130KB）ので `MAX_REQUEST_BYTES`(512KB) では止まらない。上限は必ずユニオン側に掛ける — per-operator に掛けても増幅は止まらない。
- 接尾辞パターンに小文字を許すと `CurrentLevel.ModuleName` のような PascalCase 英単語フィールドを拾い、`Number('Sniper')` = NaN で `normalizeInteger` が throw して**リクエスト全体が 400** になる。README の「上記以外のフィールドは無視されます」が破れる。受理パターンは大文字と数字のみ。
- Cloud Functions のインスタンスはウォームで再利用されるため、`dataProcessor.js` にモジュールレベルの可変状態（near-miss 収集用 Set 等）を置くとリクエスト間で漏れる。単体テストでは検出できない。
- `node --test test-dir/` は Node 24 でディレクトリを require しようとして exit 1 で失敗する。引数なしの `node --test` を使う（既定 glob が `*.test.js` を拾い、`node_modules` は走査しない）。

### Invariants / identity keys

- 保存キー = `module` + マスターの `modules` 配列要素（変換なしでそのまま連結）。この規則は backend と frontend（別リポジトリ `sharing-view`）の2箇所に二重に存在し、共有できない。片方だけ変えると列が無言で 0 になる。
- モジュール ID は append-only。改名・削除すると保存済みの `module<旧ID>` が孤児化し、その列が全ユーザーで無警告に落ちる。
- 受理するモジュールキーは `/^(?:Module|module)([A-Z0-9]{1,4})$/`。`MODULEX` / `Modulex` / `ModuleName` / `Modules` / `Module` は非受理。
- 大小文字は PascalCase 優先（`getFirstDefined(currentLevel['Module'+s], currentLevel['module'+s])`）。両方来たら PascalCase が勝つ。
- `MAX_MODULE_COUNT = 20`。Firestore 公式サイズモデルで 1MiB を破る境界は 1000件・接尾辞1文字で N=59、4文字で N=50。N=20 は約437KB（42%）。
- どのアイテムにもモジュールキーが1つも無いリクエストでは、モジュールキーを1つも保存しない（旧実装は `moduleX/Y/D/A: 0` を保存していた）。ハードコードした接尾辞ベースラインを持たない限り消せない意図された差分。
- backend はマスターデータを取得しない（依存は cors / firebase-admin / firebase-functions のみ）。モジュールキーの検証は**形式のみ**で、種別の実在性もオペレーターの所持も判定しない。

### Looks reusable but isn't

- `exports.validateInputData`（`functions/src/utils/dataProcessor.js`）は呼び出し元ゼロ。

### Environment quirks

- `functions/node_modules` が未インストールでも `node --test` は回る（`dataProcessor.js` が firebase を require しない純粋モジュールのため）。
- `processOperatorData` の呼び出しは `api/character.js` の Callable save と HTTP save の2経路のみ。取得系（`getCharacterData` / `handleGetRequest`）は `doc.data()` を素通しするだけで通らない。
- `npm run lint` は `echo 'Linting skipped'` のスタブ。実質のリントは無い。
- デプロイ workflow の `firebase deploy` には `--force` が要る。無いと**5関数すべてのデプロイに成功したうえで**「could not set up cleanup policy in location us-central1」で exit 1 になり、ジョブだけが赤くなる。赤を見たらまずログ末尾を読み、関数が `Successful update operation` になっているか確認すること。
- workflow は `firebase-tools` をバージョン固定せず `npm install -g` している。CLI 側の仕様変更がそのままデプロイ失敗として現れる。

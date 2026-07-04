# Arknights Viewer Backend

Firebase バックエンドサービスを提供するリポジトリです。キャラクターデータの保存、共有URLの生成、データ取得APIを提供します。

## 機能

- 外部APIからのキャラクターデータ受信
- データの処理・整形
- Firestoreへのデータ保存
- 共有用の短いIDの生成
- ID経由でのデータ取得
- 既存IDを使ったデータ更新

## 技術スタック

- Firebase Cloud Functions
- Firestore データベース
- Node.js

## API仕様

### データ保存/更新API

**エンドポイント:** POST https://asia-northeast1-arknights-sharing-view.cloudfunctions.net/saveCharacterDataHttp

**リクエスト制限:**
- リクエストボディ: 128KB以内
- オペレーター件数: 1000件以内

**保存されるフィールド:**

| フィールド | 説明 | 型 | 許容範囲 |
|---|---|---|---|
| `Code` / `code` | オペレーターコード | string | 英数字・`_`・`-`、10文字以内 |
| `Potential` / `potential` | 潜在 | integer | 1〜6 |
| `CurrentLevel.Elite` | 昇進 | integer | 0〜2 |
| `CurrentLevel.Level` | レベル | integer | 1〜90 |
| `CurrentLevel.Skill` | スキルランク | integer | 1〜7 |
| `CurrentLevel.Skill1` | スキル特化1 | integer | 0〜3 |
| `CurrentLevel.Skill2` | スキル特化2 | integer | 0〜3 |
| `CurrentLevel.Skill3` | スキル特化3 | integer | 0〜3 |
| `CurrentLevel.ModuleX` | モジュールX | integer | 0〜3 |
| `CurrentLevel.ModuleY` | モジュールY | integer | 0〜3 |
| `CurrentLevel.ModuleD` | モジュールD | integer | 0〜3 |
| `CurrentLevel.ModuleA` | モジュールA | integer | 0〜3 |

上記以外のフィールド（`Rarity`、`Trust`、`Paradox` 等）は無視されます。
各フィールドはキャメルケース・パスカルケースどちらも受け付けます。

**新規作成リクエスト形式（配列）:**
```json
[
  {
    "Code": "LM04",
    "Potential": "3",
    "CurrentLevel": {
      "Elite": 2,
      "Level": 51,
      "Skill": 7,
      "Skill1": 3,
      "Skill2": 0,
      "Skill3": 0,
      "ModuleX": 0,
      "ModuleY": 0,
      "ModuleD": 0,
      "ModuleA": 0
    }
  },
  {
    "Code": "GG01",
    "Potential": 6,
    "CurrentLevel": {
      "Elite": 2,
      "Level": 90,
      "Skill": 7,
      "Skill1": 3,
      "Skill2": 3,
      "Skill3": 3,
      "ModuleX": 3,
      "ModuleY": 0,
      "ModuleD": 0,
      "ModuleA": 0
    }
  }
]
```

単一オブジェクト形式も受け付けます。

**既存IDを使った更新リクエスト形式:**
```json
{
  "id": "aBcD3fGhJk",
  "data": [
    {
      "Code": "LM04",
      "Potential": "3",
      "CurrentLevel": {
        "Elite": 2,
        "Level": 51,
        "Skill": 7,
        "Skill1": 3,
        "Skill2": 0,
        "Skill3": 0,
        "ModuleX": 0,
        "ModuleY": 0,
        "ModuleD": 0,
        "ModuleA": 0
      }
    }
  ]
}
```

指定IDが存在しない場合は新規IDで作成されます。

**レスポンス形式:**
```json
{
  "id": "aBcD3fGhJk"
}
```

### データ取得API

**エンドポイント:** GET https://asia-northeast1-arknights-sharing-view.cloudfunctions.net/getCharacterDataHttp?id={dataId}

**レスポンス形式:**
```json
{
  "characters": [
    {
      "code": "LM04",
      "potential": 3,
      "elite": 2,
      "level": 51,
      "skill": 7,
      "skill1": 3,
      "skill2": 0,
      "skill3": 0,
      "moduleX": 0,
      "moduleY": 0,
      "moduleD": 0,
      "moduleA": 0
    }
  ],
  "createdAt": "Timestamp",
  "updatedAt": "Timestamp",
  "expiresAt": "Timestamp"
}
```

## データの有効期限

- 最終更新から5年間データを保持
- 毎日自動でクリーンアップジョブが実行され、期限切れのデータを削除

## ライセンス

MIT

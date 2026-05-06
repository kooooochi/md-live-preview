# 公式リリース手順

VSCode Marketplace への公開手順をまとめます。

## 事前準備

### 1. 公開メタデータを確認

このプロジェクトは以下の公開メタデータを使用します。変更する場合は該当ファイルを更新してください。

| 項目 | 現在値 | 含まれるファイル |
|------|------|------|
| Publisher ID | `kooooochi` | `package.json` |
| GitHub owner | `kooooochi` | `package.json`, `README.md` |
| Copyright holder | `kooooochi` | `LICENSE` |

### 2. Publisher アカウントを作成

1. https://aka.ms/vscode-create-publisher にアクセス
2. Microsoft アカウントでサインイン
3. **Publisher ID** を作成 (`package.json` の `publisher` と一致させる)

### 3. Personal Access Token (PAT) を取得

1. https://dev.azure.com/ にアクセス (Azure DevOps)
2. アカウント作成 (組織は何でもOK)
3. 右上のアイコン → **User Settings → Personal Access Tokens**
4. **+ New Token** をクリック
5. 設定:
   - Name: `vsce-publish`
   - Organization: **All accessible organizations** ← 重要
   - Expiration: 1年
   - Scopes: **Custom defined** → **Marketplace → Manage** にチェック
6. トークンを安全に保管 (再表示できません)

## ローカルから手動公開

### 初回のみ: vsce にログイン

```bash
npx vsce login kooooochi
# PAT を貼り付け
```

### 公開

```bash
# パッケージ生成 (.vsix を出力)
npm run package

# 中身を確認
npx vsce ls

# Marketplace に公開
npm run publish
```

数分で https://marketplace.visualstudio.com/items?itemName=kooooochi.markdown-sync-editor に表示されます。

### バージョン更新

```bash
# package.json の version を上げて公開
npx vsce publish patch   # 0.1.0 → 0.1.1
npx vsce publish minor   # 0.1.0 → 0.2.0
npx vsce publish major   # 0.1.0 → 1.0.0
```

`CHANGELOG.md` も忘れず更新を。

## GitHub Actions で自動公開

`.github/workflows/publish.yml` が用意されています。Tag をプッシュすれば自動で公開されます。

### セットアップ

1. GitHub リポジトリ作成 → push
2. リポジトリの **Settings → Secrets and variables → Actions → New repository secret**
3. 以下を登録:
   - `VSCE_PAT`: 上で取得した Azure DevOps の PAT
   - `OVSX_PAT` (任意): Open VSX 用 (Cursor/VSCodium ユーザーに届ける場合)

### Open VSX について

VSCode Marketplace は Microsoft の規約上、**派生 IDE (Cursor, VSCodium, Gitpod など) からの利用が認められていません**。これらのユーザーにも届けたい場合は [Open VSX Registry](https://open-vsx.org/) にも公開します。

1. https://open-vsx.org/ で GitHub サインイン
2. Settings → Access Tokens で PAT 発行
3. GitHub Secrets に `OVSX_PAT` として登録

### リリース実行

```bash
# package.json の version を上げる
npm version patch

# Tag を push (workflow がトリガーされる)
git push --follow-tags
```

GitHub Actions が走り、Marketplace と Open VSX の両方に自動公開されます。

## 公開後のチェックリスト

- [ ] Marketplace ページの説明・スクリーンショットを確認
- [ ] `code --install-extension kooooochi.markdown-sync-editor` で実機検証
- [ ] GitHub の Releases にも記載 (`gh release create v0.1.0 --generate-notes`)
- [ ] アイコンが Marketplace で正しく表示されるか確認

## トラブルシューティング

**`ERROR Missing publisher name`**
→ `package.json` の `publisher` がプレースホルダーのまま

**`401 Unauthorized`**
→ PAT の Organization が "All accessible" になっていない、または期限切れ

**`Make sure to edit the README.md`**
→ デフォルトのテンプレ文言が残っている。本READMEは大丈夫なはず

**`The version X is already published`**
→ `npm version patch` でバージョンを上げてから再実行

## 参考

- [Publishing Extensions - VS Code Docs](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
- [Open VSX Publishing](https://github.com/eclipse/openvsx/wiki/Publishing-Extensions)

# Markdown Live Preview (LLM-aware)

LLMがファイルを書き換えても **チラつかない** Markdownプレビュー。Mermaid・KaTeX・テーブル対応。

![demo](media/icon.png)

## なぜこの拡張?

LLM(Claude / ChatGPT / Cursor など)に Markdown を生成・編集させていると、ファイルが頻繁に上書きされます。VSCode 標準のプレビューは更新のたびに全体を再描画するため、

- Mermaid 図がチラつく
- スクロール位置が飛ぶ
- 大きい文書で重い

この拡張は **ブロック単位で差分検知** し、変わった箇所だけを更新します。Mermaid 図はキャッシュされ、未変更なら再描画されません。

## 主な機能

- 🔄 **LLM 書き込みの自動検知** — VSCode `FileSystemWatcher` で外部からのファイル更新を即座に反映
- ⚡ **差分レンダリング** — ブロック単位 MD5 ハッシュで変更箇所だけパッチ適用、スクロール位置を維持
- 📊 **Mermaid 対応** — フローチャート・シーケンス図など。テーマ切替可能
- ➗ **KaTeX 数式** — インライン `$...$` とブロック `$$...$$`
- 📋 **GFM テーブル** — 標準対応
- ✏️ **ブロック単位の編集** — プレビューをダブルクリックで textarea に切替、`Ctrl+Enter` で保存
- 🔒 **編集中ロック** — ユーザー編集中は LLM の更新で上書きされないよう自動ロック

## インストール

### Marketplace から (公開後)

VSCode の拡張機能ビュー (`Cmd/Ctrl+Shift+X`) で `Markdown Live Preview` を検索してインストール、または:

```bash
code --install-extension kooooochi.md-live-preview
```

### 手動インストール (ソースからビルド)

Marketplace に未公開、またはローカルで最新版を試したい場合:

```bash
# 1. リポジトリを取得
git clone https://github.com/kooooochi/md-live-preview.git
cd md-live-preview

# 2. 依存をインストールしてビルド
npm install
npm run compile

# 3. .vsix パッケージを生成
npx vsce package
# → md-live-preview-0.1.0.vsix が生成される

# 4. VSCode にインストール
code --install-extension md-live-preview-0.1.0.vsix
```

インストール後、VSCode を再起動すれば有効になります。

#### GUI からインストールする場合

`.vsix` ファイルを生成した後:

1. 拡張機能ビューを開く (`Cmd/Ctrl+Shift+X`)
2. 右上の `…` メニュー → **VSIXからのインストール**
3. 生成された `md-live-preview-0.1.0.vsix` を選択

#### アンインストール

```bash
code --uninstall-extension kooooochi.md-live-preview
```

または拡張機能ビューから歯車アイコン → アンインストール。

#### 開発モードで試す (インストールしない)

ソースを変更しながら試す場合は VSCode で本リポジトリを開き、`F5` で Extension Development Host を起動してください。`.vscode/launch.json` が用意されているので、押すだけで `test.md` を開いた状態の検証ウィンドウが立ち上がります。

## 使い方

1. `.md` ファイルを開く
2. コマンドパレット (`Cmd/Ctrl+Shift+P`) → `Markdown Live: Open Live Preview`
3. プレビューが横に開きます

エディタ右上の「プレビューを開く」アイコンからもアクセスできます。

## 設定

| 設定キー | 既定値 | 説明 |
|---------|--------|------|
| `mdLivePreview.mermaidTheme` | `default` | Mermaid のテーマ (`default` / `dark` / `forest` / `neutral`) |
| `mdLivePreview.enableEdit` | `true` | プレビュー上のダブルクリック編集を有効にする |

## 技術スタック

- **TypeScript** + VSCode Extension API
- **markdown-it** — パーサー (GFM テーブル対応)
- **mermaid.js** — 図のレンダリング
- **KaTeX** — 数式
- **WebView** + Content Security Policy

### アーキテクチャ

```
┌────────────────────────┐         ┌──────────────────────┐
│ extension.ts           │         │ WebView (preview.js) │
│  ↓                     │         │                      │
│ PreviewPanel           │         │  ┌─────────────────┐ │
│  ├ FileSystemWatcher ──┤ change  │  │ Block cache     │ │
│  │  + onDidChangeText  │ event   │  │ (hash → DOM)    │ │
│  ├ parseToBlocks() ────┼────────►│  └─────────────────┘ │
│  ├ diffBlocks() ───────┤ patch   │  ┌─────────────────┐ │
│  └ postMessage() ──────┼────────►│  │ Mermaid / KaTeX │ │
│                        │         │  │ lazy render     │ │
│  ◄─── editSave ────────┤◄────────┤  └─────────────────┘ │
│       editStart        │ msg     │  ┌─────────────────┐ │
│       editCancel       │         │  │ Block editor    │ │
└────────────────────────┘         │  │ (dblclick→edit) │ │
                                   │  └─────────────────┘ │
                                   └──────────────────────┘
```

## 開発

ソースを変更して試す場合:

```bash
npm install
npm run watch    # ファイル変更を監視してビルド
```

VSCode で本リポジトリを開き、`F5` で Extension Development Host を起動。`src/` を編集して `Cmd/Ctrl+R` で開発ホストをリロードすれば変更が反映されます。

ビルド単体は `npm run compile`、`.vsix` 生成は `npm run package` です。

## ライセンス

MIT — [LICENSE](LICENSE) を参照

## 貢献

Issue / PR 歓迎です。
[GitHub](https://github.com/kooooochi/md-live-preview)

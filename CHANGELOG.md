# Changelog

このプロジェクトの注目すべき変更はすべてこのファイルに記録されます。

形式は [Keep a Changelog](https://keepachangelog.com/ja/1.1.0/) に基づき、
バージョニングは [Semantic Versioning](https://semver.org/lang/ja/) に従います。

## [0.1.0] - 2026-05-06

### Added
- 初回リリース
- VSCode FileSystemWatcher によるファイル更新検知
- ブロック単位ハッシュ比較による差分レンダリング
- Mermaid 図のサポート(@mermaid-js/mermaid)
- KaTeX による数式レンダリング(インライン `$...$` / ブロック `$$...$$`)
- GFM テーブルのサポート(markdown-it 標準)
- ダブルクリックによるブロック単位編集
- 編集中のファイル監視ロック(LLM書き込みとの競合回避)
- 設定: `mdLivePreview.mermaidTheme`, `mdLivePreview.enableEdit`

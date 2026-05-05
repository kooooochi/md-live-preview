# Markdown Live Preview - 動作確認

普通の段落です。インライン数式 $E = mc^2$ も綺麗にレンダリングされます。

## テーブル

| Feature | Status | Note |
|---------|--------|------|
| Mermaid | ✅ | mermaid@10 |
| Tables | ✅ | GFM互換 |
| KaTeX | ✅ | inline + block |
| LLM detect | ✅ | FileSystemWatcher |

## Mermaid

```mermaid
graph LR
  A[LLM writes file] --> B[Watcher fires]
  B --> C[Block diff]
  C --> D[Patch DOM]
  D --> E[Mermaid stays cached]
```

## ブロック数式

$$
\int_0^\infty e^{-x^2} dx = \frac{\sqrt{\pi}}{2}
$$

## コード

```typescript
function hello(name: string): string {
  return `Hello, ${name}!`;
}
```

> ヒント: 段落をダブルクリックするとブロック単位で編集できます。

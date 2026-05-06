import * as vscode from 'vscode';
import * as path from 'path';
import * as crypto from 'crypto';
import MarkdownIt from 'markdown-it';

interface Block {
  hash: string;
  html: string;
  raw: string;
  type: string; // 'mermaid' | 'math' | 'normal'
}

export class PreviewPanel {
  private static panels = new Map<string, PreviewPanel>();
  private readonly panel: vscode.WebviewPanel;
  private readonly docUri: vscode.Uri;
  private readonly disposables: vscode.Disposable[] = [];
  private md: MarkdownIt;
  private lastBlocks: Block[] = [];
  private editLocked = false;
  private editHistory: string[] = [];

  static createOrShow(context: vscode.ExtensionContext, uri: vscode.Uri) {
    const key = uri.toString();
    const existing = this.panels.get(key);
    if (existing) {
      existing.panel.reveal(vscode.ViewColumn.Beside);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'mdLivePreview',
      `Preview: ${path.basename(uri.fsPath)}`,
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
      }
    );
    const instance = new PreviewPanel(panel, context, uri);
    this.panels.set(key, instance);
  }

  static disposeAll() {
    for (const p of this.panels.values()) p.dispose();
    this.panels.clear();
  }

  private constructor(
    panel: vscode.WebviewPanel,
    context: vscode.ExtensionContext,
    docUri: vscode.Uri
  ) {
    this.panel = panel;
    this.docUri = docUri;
    this.md = new MarkdownIt({ html: false, linkify: true, breaks: false });

    this.panel.webview.html = this.getHtml(context);

    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(
        vscode.Uri.file(path.dirname(docUri.fsPath)),
        path.basename(docUri.fsPath)
      )
    );
    watcher.onDidChange(() => this.onFileChanged(), null, this.disposables);
    this.disposables.push(watcher);

    vscode.workspace.onDidChangeTextDocument(
      (e) => {
        if (e.document.uri.toString() === docUri.toString()) {
          this.onFileChanged();
        }
      },
      null,
      this.disposables
    );

    // React to config changes
    vscode.workspace.onDidChangeConfiguration(
      (e) => {
        if (e.affectsConfiguration('mdLivePreview')) {
          this.panel.webview.postMessage({
            type: 'config',
            config: this.getConfig(),
          });
        }
      },
      null,
      this.disposables
    );

    this.panel.webview.onDidReceiveMessage(
      (msg) => this.handleMessage(msg),
      null,
      this.disposables
    );

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.render(true);
  }

  private getConfig() {
    const cfg = vscode.workspace.getConfiguration('mdLivePreview');
    return {
      mermaidTheme: cfg.get<string>('mermaidTheme', 'default'),
      enableEdit: cfg.get<boolean>('enableEdit', true),
    };
  }

  private async onFileChanged() {
    await this.render(false);
  }

  private async render(isInitial: boolean) {
    let text: string;
    try {
      const doc = await vscode.workspace.openTextDocument(this.docUri);
      text = doc.getText();
    } catch {
      return;
    }

    const blocks = this.parseToBlocks(text);

    if (isInitial) {
      this.lastBlocks = blocks;
      this.panel.webview.postMessage({
        type: 'fullRender',
        blocks,
        config: this.getConfig(),
      });
      return;
    }

    const patch = this.diffBlocks(this.lastBlocks, blocks);
    this.lastBlocks = blocks;
    this.panel.webview.postMessage({ type: 'patch', patch });
  }

  private parseToBlocks(text: string): Block[] {
    const lines = text.split(/\r?\n/);
    const rawBlocks: string[] = [];
    let buf: string[] = [];
    let inFence = false;
    let fenceMarker = '';

    const flush = () => {
      if (buf.length && buf.some((l) => l.trim() !== '')) {
        rawBlocks.push(buf.join('\n'));
      }
      buf = [];
    };

    for (const line of lines) {
      const fenceMatch = line.match(/^(```|~~~)/);
      if (fenceMatch) {
        if (!inFence) {
          if (buf.length && buf.some((l) => l.trim() !== '')) flush();
          inFence = true;
          fenceMarker = fenceMatch[1];
          buf.push(line);
        } else if (line.startsWith(fenceMarker)) {
          buf.push(line);
          rawBlocks.push(buf.join('\n'));
          buf = [];
          inFence = false;
        } else {
          buf.push(line);
        }
        continue;
      }
      if (inFence) {
        buf.push(line);
        continue;
      }
      if (line.trim() === '') {
        flush();
      } else {
        buf.push(line);
      }
    }
    flush();

    return rawBlocks.map((raw) => this.makeBlock(raw));
  }

  private makeBlock(raw: string): Block {
    const hash = crypto.createHash('md5').update(raw).digest('hex');
    const mermaidMatch = raw.match(/^```mermaid\s*\n([\s\S]*?)\n```$/);
    if (mermaidMatch) {
      return { hash, raw, type: 'mermaid', html: mermaidMatch[1] };
    }
    if (/^\$\$[\s\S]+\$\$$/.test(raw.trim())) {
      const inner = raw.trim().replace(/^\$\$|\$\$$/g, '');
      return { hash, raw, type: 'math', html: inner };
    }
    return { hash, raw, type: 'normal', html: this.md.render(raw) };
  }

  private diffBlocks(oldB: Block[], newB: Block[]) {
    const ops: Array<
      | { op: 'keep'; index: number }
      | { op: 'replace'; index: number; block: Block }
      | { op: 'insert'; index: number; block: Block }
      | { op: 'delete'; index: number }
    > = [];
    const max = Math.max(oldB.length, newB.length);
    for (let i = 0; i < max; i++) {
      const o = oldB[i];
      const n = newB[i];
      if (o && n && o.hash === n.hash) ops.push({ op: 'keep', index: i });
      else if (o && n) ops.push({ op: 'replace', index: i, block: n });
      else if (!o && n) ops.push({ op: 'insert', index: i, block: n });
      else if (o && !n) ops.push({ op: 'delete', index: i });
    }
    return { blocks: newB, ops };
  }

  private async handleMessage(msg: any) {
    switch (msg.type) {
      case 'editStart':
        this.editLocked = true;
        return;
      case 'editCancel':
        this.editLocked = false;
        return;
      case 'editSave': {
        this.editLocked = false;
        await this.applyBlockEdit(msg.index, msg.newRaw);
        await this.render(false);
        return;
      }
      case 'undoEdit':
        await this.undoLastPreviewEdit();
        return;
      case 'ready':
        this.render(true);
        return;
    }
  }

  private async applyBlockEdit(index: number, newRaw: string) {
    const doc = await vscode.workspace.openTextDocument(this.docUri);
    const oldText = doc.getText();
    const blocks = this.parseToBlocks(oldText);
    if (index < 0 || index >= blocks.length) return;
    blocks[index] = this.makeBlock(newRaw);
    const newText = blocks.map((b) => b.raw).join('\n\n') + '\n';
    if (newText === oldText) return;
    this.editHistory.push(oldText);
    if (this.editHistory.length > 50) this.editHistory.shift();
    const edit = new vscode.WorkspaceEdit();
    const fullRange = new vscode.Range(
      doc.positionAt(0),
      doc.positionAt(oldText.length)
    );
    edit.replace(this.docUri, fullRange, newText);
    await vscode.workspace.applyEdit(edit);
    await doc.save();
  }

  private async undoLastPreviewEdit() {
    const previousText = this.editHistory.pop();
    if (previousText === undefined) {
      this.panel.webview.postMessage({ type: 'undoResult', ok: false });
      return;
    }
    const doc = await vscode.workspace.openTextDocument(this.docUri);
    const currentText = doc.getText();
    const edit = new vscode.WorkspaceEdit();
    const fullRange = new vscode.Range(
      doc.positionAt(0),
      doc.positionAt(currentText.length)
    );
    edit.replace(this.docUri, fullRange, previousText);
    await vscode.workspace.applyEdit(edit);
    await doc.save();
    await this.render(false);
    this.panel.webview.postMessage({ type: 'undoResult', ok: true });
  }

  private getHtml(context: vscode.ExtensionContext): string {
    const webview = this.panel.webview;
    const mediaUri = (f: string) =>
      webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', f));
    const nonce = crypto.randomBytes(16).toString('hex');

    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource} https: data:`,
      `style-src ${webview.cspSource} 'unsafe-inline' https://cdn.jsdelivr.net`,
      `font-src ${webview.cspSource} https://cdn.jsdelivr.net data:`,
      `script-src 'nonce-${nonce}' https://cdn.jsdelivr.net`,
    ].join('; ');

    return /* html */ `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css" />
<link rel="stylesheet" href="${mediaUri('preview.css')}" />
</head>
<body>
<div id="status"></div>
<div id="root"></div>
<script nonce="${nonce}" src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
<script nonce="${nonce}" src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"></script>
<script nonce="${nonce}" src="${mediaUri('preview.js')}"></script>
</body>
</html>`;
  }

  dispose() {
    PreviewPanel.panels.delete(this.docUri.toString());
    this.panel.dispose();
    while (this.disposables.length) this.disposables.pop()?.dispose();
  }
}

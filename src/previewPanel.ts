import * as vscode from 'vscode';
import * as path from 'path';
import * as crypto from 'crypto';
import { execFile } from 'child_process';
import MarkdownIt from 'markdown-it';

interface Block {
  hash: string;
  html: string;
  raw: string;
  type: string; // 'mermaid' | 'math' | 'normal'
  startLine: number;
  endLine: number;
  gitChanged: boolean;
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
  private gitRefreshTimer: NodeJS.Timeout | undefined;

  static createOrShow(context: vscode.ExtensionContext, uri: vscode.Uri) {
    const key = uri.toString();
    const existing = this.panels.get(key);
    if (existing) {
      existing.panel.reveal(vscode.ViewColumn.Beside);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'markdownSyncStudio',
      `Preview: ${path.basename(uri.fsPath)}`,
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(context.extensionUri, 'media'),
          vscode.Uri.file(path.dirname(uri.fsPath)),
          ...(vscode.workspace.workspaceFolders?.map((f) => f.uri) || []),
        ],
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
    this.configureMarkdownRenderer();

    this.panel.webview.html = this.getHtml(context);

    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(
        vscode.Uri.file(path.dirname(docUri.fsPath)),
        path.basename(docUri.fsPath)
      )
    );
    watcher.onDidChange(() => this.onFileChanged(), null, this.disposables);
    this.disposables.push(watcher);
    this.watchGitState();

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
        if (e.affectsConfiguration('markdownSyncStudio')) {
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
    const cfg = vscode.workspace.getConfiguration('markdownSyncStudio');
    return {
      mermaidTheme: cfg.get<string>('mermaidTheme', 'default'),
      enableEdit: cfg.get<boolean>('enableEdit', true),
    };
  }

  private async onFileChanged() {
    await this.render(false);
  }

  private async watchGitState() {
    const gitDir = await this.getGitDir();
    if (!gitDir) return;

    const gitWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(vscode.Uri.file(gitDir), '{HEAD,index,logs/HEAD}')
    );
    const refresh = () => this.scheduleGitRefresh();
    gitWatcher.onDidChange(refresh, null, this.disposables);
    gitWatcher.onDidCreate(refresh, null, this.disposables);
    gitWatcher.onDidDelete(refresh, null, this.disposables);
    this.disposables.push(gitWatcher);
  }

  private scheduleGitRefresh() {
    if (this.gitRefreshTimer) clearTimeout(this.gitRefreshTimer);
    this.gitRefreshTimer = setTimeout(() => {
      this.gitRefreshTimer = undefined;
      this.render(false);
    }, 150);
  }

  private async render(isInitial: boolean) {
    let text: string;
    try {
      const doc = await vscode.workspace.openTextDocument(this.docUri);
      text = doc.getText();
    } catch {
      return;
    }

    const gitChangedLines = await this.getGitChangedLines(text);
    const blocks = this.parseToBlocks(text, gitChangedLines);

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

  private parseToBlocks(text: string, gitChangedLines = new Set<number>()): Block[] {
    const lines = text.split(/\r?\n/);
    const rawBlocks: Array<{ raw: string; startLine: number; endLine: number }> = [];
    let buf: string[] = [];
    let bufStartLine = 0;
    let inFence = false;
    let fenceMarker = '';

    const flush = () => {
      if (buf.length && buf.some((l) => l.trim() !== '')) {
        rawBlocks.push({
          raw: buf.join('\n'),
          startLine: bufStartLine,
          endLine: bufStartLine + buf.length - 1,
        });
      }
      buf = [];
      bufStartLine = 0;
    };

    const pushLine = (line: string, lineNumber: number) => {
      if (!buf.length) bufStartLine = lineNumber;
      buf.push(line);
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNumber = i + 1;
      const fenceMatch = line.match(/^(```|~~~)/);
      if (fenceMatch) {
        if (!inFence) {
          if (buf.length && buf.some((l) => l.trim() !== '')) flush();
          inFence = true;
          fenceMarker = fenceMatch[1];
          pushLine(line, lineNumber);
        } else if (line.startsWith(fenceMarker)) {
          pushLine(line, lineNumber);
          rawBlocks.push({
            raw: buf.join('\n'),
            startLine: bufStartLine,
            endLine: lineNumber,
          });
          buf = [];
          bufStartLine = 0;
          inFence = false;
        } else {
          pushLine(line, lineNumber);
        }
        continue;
      }
      if (inFence) {
        pushLine(line, lineNumber);
        continue;
      }
      if (line.trim() === '') {
        flush();
      } else {
        pushLine(line, lineNumber);
      }
    }
    flush();

    const headingCounters = [0, 0, 0, 0, 0, 0];
    return rawBlocks.map((b) =>
      this.makeBlock(
        b.raw,
        b.startLine,
        b.endLine,
        this.hasChangedLine(gitChangedLines, b.startLine, b.endLine),
        headingCounters
      )
    );
  }

  private makeBlock(
    raw: string,
    startLine = 0,
    endLine = 0,
    gitChanged = false,
    headingCounters?: number[]
  ): Block {
    const mermaidMatch = raw.match(/^```mermaid\s*\n([\s\S]*?)\n```$/);
    if (mermaidMatch) {
      const hash = crypto.createHash('md5').update(raw).digest('hex');
      return { hash, raw, type: 'mermaid', html: mermaidMatch[1], startLine, endLine, gitChanged };
    }
    if (/^\$\$[\s\S]+\$\$$/.test(raw.trim())) {
      const inner = raw.trim().replace(/^\$\$|\$\$$/g, '');
      const hash = crypto.createHash('md5').update(raw).digest('hex');
      return { hash, raw, type: 'math', html: inner, startLine, endLine, gitChanged };
    }
    const numberedRaw = headingCounters ? this.addHeadingNumbers(raw, headingCounters) : raw;
    const html = this.md.render(numberedRaw);
    const hash = crypto.createHash('md5').update(raw).update(html).digest('hex');
    return { hash, raw, type: 'normal', html, startLine, endLine, gitChanged };
  }

  private configureMarkdownRenderer() {
    const defaultImageRender =
      this.md.renderer.rules.image ||
      ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));

    this.md.renderer.rules.image = (tokens, idx, options, env, self) => {
      const token = tokens[idx];
      const src = token.attrGet('src');
      if (src) token.attrSet('src', this.toWebviewImageUri(src));
      return defaultImageRender(tokens, idx, options, env, self);
    };
  }

  private toWebviewImageUri(src: string) {
    if (/^(https?:|data:|vscode-resource:|vscode-webview-resource:)/i.test(src)) {
      return src;
    }
    if (src.startsWith('#')) return src;

    const match = src.match(/^([^?#]*)([?#].*)?$/);
    const pathPart = match?.[1] || '';
    const suffix = match?.[2] || '';
    if (!pathPart) return src;

    let decodedPath = pathPart;
    try {
      decodedPath = decodeURIComponent(pathPart);
    } catch {
      decodedPath = pathPart;
    }
    const imagePath = path.isAbsolute(decodedPath)
      ? decodedPath
      : path.resolve(path.dirname(this.docUri.fsPath), decodedPath);
    return `${this.panel.webview.asWebviewUri(vscode.Uri.file(imagePath))}${suffix}`;
  }

  private addHeadingNumbers(raw: string, counters: number[]) {
    const lines = raw.split(/\r?\n/);
    let inFence = false;
    let fenceMarker = '';

    return lines
      .map((line) => {
        const fenceMatch = line.match(/^(```|~~~)/);
        if (fenceMatch) {
          if (!inFence) {
            inFence = true;
            fenceMarker = fenceMatch[1];
          } else if (line.startsWith(fenceMarker)) {
            inFence = false;
          }
          return line;
        }
        if (inFence) return line;

        const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
        if (!headingMatch) return line;

        const level = headingMatch[1].length;
        counters[level - 1]++;
        for (let i = level; i < counters.length; i++) counters[i] = 0;
        for (let i = 0; i < level - 1; i++) {
          if (counters[i] === 0) counters[i] = 1;
        }

        const number = counters.slice(0, level).join('.');
        return `${headingMatch[1]} ${number}. ${headingMatch[2]}`;
      })
      .join('\n');
  }

  private hasChangedLine(changedLines: Set<number>, startLine: number, endLine: number) {
    for (let line = startLine; line <= endLine; line++) {
      if (changedLines.has(line)) return true;
    }
    return false;
  }

  private async getGitChangedLines(text: string) {
    const changedLines = new Set<number>();
    try {
      const status = await this.git(['status', '--porcelain', '--', this.docUri.fsPath]);
      if (status.trimStart().startsWith('??')) {
        for (let line = 1; line <= text.split(/\r?\n/).length; line++) {
          changedLines.add(line);
        }
        return changedLines;
      }

      const diff = await this.git(['diff', 'HEAD', '--unified=0', '--', this.docUri.fsPath]);
      for (const line of diff.split(/\r?\n/)) {
        const match = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
        if (!match) continue;
        const start = Number(match[1]);
        const count = match[2] === undefined ? 1 : Number(match[2]);
        if (count === 0) {
          changedLines.add(Math.max(1, start));
          continue;
        }
        for (let offset = 0; offset < count; offset++) {
          changedLines.add(start + offset);
        }
      }
    } catch {
      // Git information is optional; non-repository files render normally.
    }
    return changedLines;
  }

  private git(args: string[]) {
    return new Promise<string>((resolve, reject) => {
      execFile('git', args, { cwd: path.dirname(this.docUri.fsPath) }, (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(stdout);
      });
    });
  }

  private async getGitDir() {
    try {
      const gitDir = await this.git(['rev-parse', '--git-dir']);
      const trimmed = gitDir.trim();
      if (!trimmed) return undefined;
      return path.isAbsolute(trimmed)
        ? trimmed
        : path.resolve(path.dirname(this.docUri.fsPath), trimmed);
    } catch {
      return undefined;
    }
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
    if (this.gitRefreshTimer) clearTimeout(this.gitRefreshTimer);
    this.panel.dispose();
    while (this.disposables.length) this.disposables.pop()?.dispose();
  }
}

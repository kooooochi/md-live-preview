import * as vscode from 'vscode';
import { PreviewPanel } from './previewPanel';

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('markdownSyncEditor.open', () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== 'markdown') {
        vscode.window.showWarningMessage('Open a Markdown file first.');
        return;
      }
      PreviewPanel.createOrShow(context, editor.document.uri);
    })
  );
}

export function deactivate() {
  PreviewPanel.disposeAll();
}

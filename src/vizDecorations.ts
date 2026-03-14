import * as vscode from 'vscode';
import { parseVizBlocks } from './vizParser';

const vizDecorationType = vscode.window.createTextEditorDecorationType({
  backgroundColor: 'rgba(99, 102, 241, 0.08)',
  borderWidth: '0 0 0 3px',
  borderStyle: 'solid',
  borderColor: '#6366f1',
  isWholeLine: true,
  overviewRulerColor: '#6366f1',
  overviewRulerLane: vscode.OverviewRulerLane.Left,
});

const vizStartDecorationType = vscode.window.createTextEditorDecorationType({
  after: {
    contentText: ' ◈ Visualisable',
    color: '#6366f180',
    fontStyle: 'italic',
    margin: '0 0 0 16px',
  }
});

/**
 * Update decorations for viz blocks in the active editor.
 */
export function updateVizDecorations(editor: vscode.TextEditor): void {
  if (!editor || !isTexFile(editor.document)) {
    return;
  }

  const text = editor.document.getText();
  const blocks = parseVizBlocks(text);

  const bodyRanges: vscode.DecorationOptions[] = [];
  const startRanges: vscode.DecorationOptions[] = [];

  for (const block of blocks) {
    // Find the full range of the viz block
    const regex = /\\begin\{viz\}(?:\[([^\]]*)\])?\s*([\s\S]*?)\s*\\end\{viz\}/g;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      if (match[2]?.trim() === block.equation) {
        const startPos = editor.document.positionAt(match.index);
        const endPos = editor.document.positionAt(match.index + match[0].length);

        bodyRanges.push({
          range: new vscode.Range(startPos, endPos),
          hoverMessage: new vscode.MarkdownString(
            `**◈ LaTeX Visualiser**\n\n` +
            `Type: \`${block.vizType}\`\n\n` +
            `Equation: \`${block.equation}\`\n\n` +
            `[Open Visualiser](command:latexVisualiser.openViewer)`
          ),
        });

        startRanges.push({
          range: new vscode.Range(startPos, startPos),
        });

        break;
      }
    }
  }

  editor.setDecorations(vizDecorationType, bodyRanges);
  editor.setDecorations(vizStartDecorationType, startRanges);
}

function isTexFile(doc: vscode.TextDocument): boolean {
  return doc.languageId === 'latex' || doc.languageId === 'tex' || doc.fileName.endsWith('.tex');
}

/**
 * Register decoration providers for viz blocks.
 */
export function registerVizDecorations(context: vscode.ExtensionContext): void {
  // Update on active editor change
  const editorDisposable = vscode.window.onDidChangeActiveTextEditor(editor => {
    if (editor) {
      updateVizDecorations(editor);
    }
  });

  // Update on text change
  const changeDisposable = vscode.workspace.onDidChangeTextDocument(event => {
    const editor = vscode.window.activeTextEditor;
    if (editor && event.document === editor.document) {
      updateVizDecorations(editor);
    }
  });

  // Initial decoration
  if (vscode.window.activeTextEditor) {
    updateVizDecorations(vscode.window.activeTextEditor);
  }

  context.subscriptions.push(editorDisposable, changeDisposable);
}

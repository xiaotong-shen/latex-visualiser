import * as vscode from 'vscode';

/**
 * Provides CodeLens actions above \begin{viz} blocks.
 */
export class VizCodeLensProvider implements vscode.CodeLensProvider {
  private _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (!this.isTexFile(document)) {
      return [];
    }

    const lenses: vscode.CodeLens[] = [];
    const text = document.getText();
    const regex = /\\begin\{viz\}/g;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      const pos = document.positionAt(match.index);
      const range = new vscode.Range(pos, pos);

      lenses.push(
        new vscode.CodeLens(range, {
          title: '◈ Visualize',
          command: 'latexVisualiser.openViewer',
          tooltip: 'Open the LaTeX Visualiser to see this equation',
        })
      );
    }

    return lenses;
  }

  refresh(): void {
    this._onDidChangeCodeLenses.fire();
  }

  private isTexFile(doc: vscode.TextDocument): boolean {
    return doc.languageId === 'latex' || doc.languageId === 'tex' || doc.fileName.endsWith('.tex');
  }
}

export function registerVizCodeLens(context: vscode.ExtensionContext): VizCodeLensProvider {
  const provider = new VizCodeLensProvider();
  const disposable = vscode.languages.registerCodeLensProvider(
    [{ language: 'latex' }, { language: 'tex' }, { pattern: '**/*.tex' }],
    provider
  );
  context.subscriptions.push(disposable);
  return provider;
}

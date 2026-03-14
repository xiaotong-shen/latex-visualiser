import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { parseVizBlocks, findPdfForTex, estimateVizPositions, VizBlock } from './vizParser';
import { generateAllPlots } from './plotGenerator';
import { getWebviewContent } from './webviewContent';
import { registerVizDecorations } from './vizDecorations';
import { registerVizCodeLens } from './vizCodeLens';

let currentPanel: vscode.WebviewPanel | undefined;
let currentTexDocument: vscode.TextDocument | undefined;
let fileWatcher: vscode.FileSystemWatcher | undefined;

export function activate(context: vscode.ExtensionContext) {
  console.log('LaTeX Visualiser is now active');

  // Register the open viewer command
  const openViewerCmd = vscode.commands.registerCommand(
    'latexVisualiser.openViewer',
    () => openViewer(context)
  );

  // Register refresh command
  const refreshCmd = vscode.commands.registerCommand(
    'latexVisualiser.refreshViz',
    () => refreshVisualizations()
  );

  // Register editor decorations (highlights viz blocks in the editor)
  registerVizDecorations(context);

  // Register CodeLens provider (adds "◈ Visualize" buttons above viz blocks)
  registerVizCodeLens(context);

  // Watch for active editor changes
  const editorChangeDisposable = vscode.window.onDidChangeActiveTextEditor(editor => {
    if (editor && isTexFile(editor.document)) {
      currentTexDocument = editor.document;
    }
  });

  // Watch for document saves (refresh viz on save)
  const saveDisposable = vscode.workspace.onDidSaveTextDocument(doc => {
    if (isTexFile(doc) && currentPanel) {
      currentTexDocument = doc;
      // Small delay to allow PDF compilation
      setTimeout(() => refreshVisualizations(), 1500);
    }
  });

  // Set current document if already open
  if (vscode.window.activeTextEditor && isTexFile(vscode.window.activeTextEditor.document)) {
    currentTexDocument = vscode.window.activeTextEditor.document;
  }

  context.subscriptions.push(openViewerCmd, refreshCmd, editorChangeDisposable, saveDisposable);
}

function isTexFile(doc: vscode.TextDocument): boolean {
  return doc.languageId === 'latex' || doc.languageId === 'tex' || doc.fileName.endsWith('.tex');
}

async function openViewer(context: vscode.ExtensionContext) {
  // Find the .tex file
  if (!currentTexDocument) {
    const editor = vscode.window.activeTextEditor;
    if (editor && isTexFile(editor.document)) {
      currentTexDocument = editor.document;
    } else {
      // Try to find a .tex file in the workspace
      const texFiles = await vscode.workspace.findFiles('**/*.tex', '**/node_modules/**', 1);
      if (texFiles.length > 0) {
        currentTexDocument = await vscode.workspace.openTextDocument(texFiles[0]);
      } else {
        vscode.window.showErrorMessage('No .tex file found. Open a .tex file first.');
        return;
      }
    }
  }

  const texPath = currentTexDocument.uri.fsPath;
  const pdfPath = findPdfForTex(texPath);

  if (!pdfPath) {
    vscode.window.showWarningMessage(
      'No compiled PDF found. Compile your .tex file first, or set latexVisualiser.pdfPath in settings.'
    );
  }

  // Create or reveal the webview panel
  if (currentPanel) {
    currentPanel.reveal(vscode.ViewColumn.Beside);
  } else {
    currentPanel = vscode.window.createWebviewPanel(
      'latexVisualiser',
      'LaTeX Visualiser',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.file(path.dirname(texPath)),
          vscode.Uri.joinPath(context.extensionUri, 'webview'),
          vscode.Uri.joinPath(context.extensionUri, 'node_modules'),
        ]
      }
    );

    currentPanel.onDidDispose(() => {
      currentPanel = undefined;
      if (fileWatcher) {
        fileWatcher.dispose();
        fileWatcher = undefined;
      }
    });

    // Handle messages from the webview
    currentPanel.webview.onDidReceiveMessage(
      message => handleWebviewMessage(message, context),
      undefined,
      context.subscriptions
    );
  }

  // Set up file watcher for PDF changes
  if (pdfPath && !fileWatcher) {
    fileWatcher = vscode.workspace.createFileSystemWatcher(pdfPath);
    fileWatcher.onDidChange(() => {
      if (currentPanel) {
        setTimeout(() => refreshVisualizations(), 500);
      }
    });
  }

  // Load the webview
  await loadWebview(context, pdfPath);
}

async function loadWebview(context: vscode.ExtensionContext, pdfPath: string | undefined) {
  if (!currentPanel || !currentTexDocument) {return;}

  const texText = currentTexDocument.getText();
  const blocks = parseVizBlocks(texText);

  // Get the config
  const config = vscode.workspace.getConfiguration('latexVisualiser');
  const resolution = config.get<number>('plotResolution') || 50;
  const popupWidth = config.get<number>('popupWidth') || 450;
  const popupHeight = config.get<number>('popupHeight') || 400;

  // Generate plot data
  const plots = generateAllPlots(blocks, resolution);

  // Read PDF as base64 if available
  let pdfBase64: string | undefined;
  if (pdfPath && fs.existsSync(pdfPath)) {
    const pdfBuffer = fs.readFileSync(pdfPath);
    pdfBase64 = pdfBuffer.toString('base64');
  }

  // Estimate positions
  const totalLines = texText.split('\n').length;
  const markers = estimateVizPositions(blocks, totalLines, Math.max(1, Math.ceil(totalLines / 50)));

  // Generate the HTML content
  const pdfjsScriptUri = currentPanel.webview.asWebviewUri(
    vscode.Uri.joinPath(context.extensionUri, 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.min.mjs')
  ).toString();
  const pdfjsWorkerUri = currentPanel.webview.asWebviewUri(
    vscode.Uri.joinPath(context.extensionUri, 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.worker.min.mjs')
  ).toString();
  const plotlyScriptUri = currentPanel.webview.asWebviewUri(
    vscode.Uri.joinPath(context.extensionUri, 'node_modules', 'plotly.js-dist-min', 'plotly.min.js')
  ).toString();

  const html = getWebviewContent({
    pdfBase64,
    pdfjsScriptUri,
    pdfjsWorkerUri,
    plotlyScriptUri,
    plots,
    markers,
    config: { popupWidth, popupHeight, resolution },
    cspSource: currentPanel.webview.cspSource,
  });

  currentPanel.webview.html = html;
}

function refreshVisualizations() {
  if (!currentPanel || !currentTexDocument) {return;}

  const texText = currentTexDocument.getText();
  const blocks = parseVizBlocks(texText);
  const config = vscode.workspace.getConfiguration('latexVisualiser');
  const resolution = config.get<number>('plotResolution') || 50;
  const plots = generateAllPlots(blocks, resolution);

  const totalLines = texText.split('\n').length;
  const markers = estimateVizPositions(blocks, totalLines, Math.max(1, Math.ceil(totalLines / 50)));

  // Send updated data to the webview
  currentPanel.webview.postMessage({
    type: 'updateViz',
    plots,
    markers,
  });

  // Also reload PDF if available
  const pdfPath = findPdfForTex(currentTexDocument.uri.fsPath);
  if (pdfPath && fs.existsSync(pdfPath)) {
    const pdfBuffer = fs.readFileSync(pdfPath);
    currentPanel.webview.postMessage({
      type: 'updatePdf',
      pdfBase64: pdfBuffer.toString('base64'),
    });
  }
}

function handleWebviewMessage(message: any, context: vscode.ExtensionContext) {
  switch (message.type) {
    case 'ready':
      refreshVisualizations();
      break;
    case 'error':
      vscode.window.showErrorMessage(`LaTeX Visualiser: ${message.text}`);
      break;
    case 'info':
      vscode.window.showInformationMessage(`LaTeX Visualiser: ${message.text}`);
      break;
    case 'openTexLine':
      if (currentTexDocument && typeof message.line === 'number') {
        const line = Math.max(0, message.line - 1);
        const range = new vscode.Range(line, 0, line, 0);
        vscode.window.showTextDocument(currentTexDocument, {
          selection: range,
          viewColumn: vscode.ViewColumn.One,
        });
      }
      break;
  }
}

export function deactivate() {
  if (fileWatcher) {
    fileWatcher.dispose();
  }
}

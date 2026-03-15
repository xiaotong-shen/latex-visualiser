
import * as dotenv from 'dotenv';
import * as vscode from 'vscode';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '..', '.env') });
import * as fs from 'fs';
import * as os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';
import { parseVizBlocks, findPdfForTex, estimateVizPositions, VizBlock } from './vizParser';
import { generateAllPlots } from './plotGenerator';
import { getWebviewContent } from './webviewContent';
import { registerVizDecorations } from './vizDecorations';
import { registerVizCodeLens } from './vizCodeLens';

let currentPanel: vscode.WebviewPanel | undefined;
let currentChatPanel: vscode.WebviewPanel | undefined;
let currentTexDocument: vscode.TextDocument | undefined;
let fileWatcher: vscode.FileSystemWatcher | undefined;
let anthropicClient: Anthropic | undefined;

function loadEnvironmentVariables(context: vscode.ExtensionContext): void {
  const candidatePaths: string[] = [];
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

  if (workspaceFolder) {
    candidatePaths.push(path.join(workspaceFolder.uri.fsPath, '.env'));
  }

  candidatePaths.push(path.join(context.extensionPath, '.env'));

  for (const envPath of candidatePaths) {
    if (!fs.existsSync(envPath)) {
      continue;
    }

    const result = dotenv.config({ path: envPath, override: false });
    if (result.error) {
      console.warn(`Failed to load .env from ${envPath}: ${result.error.message}`);
      continue;
    }

    console.log(`Loaded environment variables from ${envPath}`);
    return;
  }
}

function findNearestVizBlock(blocks: VizBlock[], cursorOffset: number): VizBlock | undefined {
  if (blocks.length === 0) {
    return undefined;
  }

  let best: VizBlock | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const block of blocks) {
    const distance = cursorOffset < block.startOffset
      ? block.startOffset - cursorOffset
      : cursorOffset > block.endOffset
        ? cursorOffset - block.endOffset
        : 0;

    if (distance < bestDistance) {
      best = block;
      bestDistance = distance;
    }
  }

  return best;
}

// ── Claude helpers ────────────────────────────────────────────────────────────

function getAnthropicClient(): Anthropic {
  if (anthropicClient) { return anthropicClient; }
  const config = vscode.workspace.getConfiguration('latexVisualiser');
  let apiKey = config.get<string>('anthropicApiKey');
  if (!apiKey) { apiKey = process.env.ANTHROPIC_API_KEY; }
  if (!apiKey) {
    throw new Error('No Anthropic API key found. Set latexVisualiser.anthropicApiKey or ANTHROPIC_API_KEY env variable.');
  }
  anthropicClient = new Anthropic({ apiKey });
  return anthropicClient;
}

function extractTikzCode(response: string): string {
  const match = response.match(/\\begin\{tikzpicture\}[\s\S]*?\\end\{tikzpicture\}/);
  return match ? match[0] : response.trim();
}

interface ClaudeVizResult {
  preamble: string;
  tikzCode: string;
}

async function generateTikZFromClaude(selectedText: string): Promise<ClaudeVizResult> {
  const client = getAnthropicClient();
  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 2048,
    messages: [{
      role: 'user',
      content: `You are an expert mathematician and TikZ visualization specialist.

Analyze this LaTeX proof and generate a TikZ diagram:
\`\`\`latex
${selectedText}
\`\`\`

Respond in exactly this format with no extra text:

PREAMBLE:
\\usepackage{tikz}
\\usepackage{pgfplots}
\\pgfplotsset{compat=1.18}
\\usetikzlibrary{...}
(only include libraries actually needed)

TIKZ:
\\begin{tikzpicture}
...
\\end{tikzpicture}

Requirements:
- Use the EXACT variable names from the proof
- Annotate key mathematical objects defined in the proof
- 2D diagrams ONLY — no 3D surf plots, no pgfplots 3D axes
- Use basic tikz drawing commands: \\draw, \\node, \\fill, \\arrow
- NO custom colormaps, NO shader options, NO z buffer options
- Publication-quality, clean and minimal
- No explanation, no markdown fences, just the code`,
    }],
  });
  const content = message.content[0];
  if (content.type !== 'text') { throw new Error('Unexpected response type from Claude'); }
  return parseClaudeResponse(content.text);
}

function parseClaudeResponse(response: string): ClaudeVizResult {
  const preambleMatch = response.match(/PREAMBLE:\n([\s\S]*?)\n\nTIKZ:/);
  const tikzMatch     = response.match(/TIKZ:\n([\s\S]*)/);
  const preamble = preambleMatch
    ? preambleMatch[1].trim()
    : '\\usepackage{tikz}\n\\usepackage{pgfplots}\n\\pgfplotsset{compat=1.18}';
  const tikzCode = tikzMatch
    ? extractTikzCode(tikzMatch[1].trim())
    : extractTikzCode(response);
  return { preamble, tikzCode };
}

function wrapInFigure(tikzCode: string): string {
  return [
    '\\begin{figure}[h]',
    '  \\centering',
    ...tikzCode.split('\n').map(line => '  ' + line),
    '  \\caption{TODO: Add caption}',
    '  \\label{fig:generated}',
    '\\end{figure}',
  ].join('\n');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── TikZ → PNG ────────────────────────────────────────────────────────────────

async function compileTikzToPng(tikzCode: string): Promise<string | undefined> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'latex-viz-'));

  const texContent = [
    '\\documentclass[tikz,border=10pt]{standalone}',
    '\\usepackage{tikz}',
    '\\usepackage{pgfplots}',
    '\\pgfplotsset{compat=1.18}',
    '\\usetikzlibrary{arrows.meta,calc,positioning,decorations.pathmorphing}',
    '\\begin{document}',
    tikzCode,
    '\\end{document}',
  ].join('\n');

  const texFile = path.join(tmpDir, 'preview.tex');
  const pdfFile = path.join(tmpDir, 'preview.pdf');
  const pngFile = path.join(tmpDir, 'preview.png');
  const logFile = path.join(tmpDir, 'preview.log');

  fs.writeFileSync(texFile, texContent);
  outputChannel.appendLine('Full tex content:\n' + texContent);
  outputChannel.appendLine('compileTikzToPng: compiling ' + texFile);

  try {
    // Step 1: compile to PDF
    try {
      await execFileAsync(
        '/usr/local/texlive/2026basic/bin/universal-darwin/pdflatex',
        ['-interaction=nonstopmode', '-output-directory', tmpDir, texFile],
        { timeout: 15000 }
      );
    } catch (pdflatexErr: any) {
      // pdflatex exits with code 1 even on success with warnings
      // only fail if PDF wasn't actually generated
      if (!fs.existsSync(pdfFile)) {
        const log = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : 'no log';
        outputChannel.appendLine('FAIL: pdflatex failed and no PDF generated');
        outputChannel.appendLine('log tail:\n' + log.slice(-2000));
        return undefined;
      }
      outputChannel.appendLine('pdflatex had warnings but PDF was generated, continuing...');
    }

    if (!fs.existsSync(pdfFile)) {
      outputChannel.appendLine('FAIL: PDF not found after compilation');
      return undefined;
    }

    outputChannel.appendLine('PDF generated, converting to PNG...');
    outputChannel.appendLine('PDF exists check: ' + fs.existsSync(pdfFile));
    outputChannel.appendLine('PDF path: ' + pdfFile);
    outputChannel.appendLine('PNG path: ' + pngFile);
    // Step 2: convert PDF → PNG using magick
    await execFileAsync(
      'magick',
      ['-density', '150', pdfFile, '-quality', '90', pngFile],
      { timeout: 10000 }
    );

    if (!fs.existsSync(pngFile)) {
      outputChannel.appendLine('FAIL: PNG not generated');
      return undefined;
    }

    outputChannel.appendLine('PNG generated successfully');
    return fs.readFileSync(pngFile).toString('base64');

  } catch (err: any) {
    const log = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : 'no log file';
    
    const persistLog = path.join(os.homedir(), 'latex-viz-error.log');
    fs.writeFileSync(persistLog, 'TEX:\n' + texContent + '\n\nFULL LOG:\n' + log);


    outputChannel.appendLine('ERROR: ' + err.message);
    outputChannel.appendLine('stdout: ' + (err.stdout || 'none'));
    outputChannel.appendLine('stderr: ' + (err.stderr || 'none'));
    outputChannel.appendLine('ERROR: ' + err.message);
    outputChannel.appendLine('Full log written to: ' + persistLog);
    return undefined;
  } finally {
    // DON'T delete tmpDir yet so we can inspect
    // try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

// ── Activation ────────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext) {
  console.log('LaTeX Visualiser is now active');

  const openViewerCmd = vscode.commands.registerCommand(
    'latexVisualiser.openViewer',
    () => openViewer(context)
  );

  const refreshCmd = vscode.commands.registerCommand(
    'latexVisualiser.refreshViz',
    () => refreshVisualizations()
  );

  const generateProofImageCmd = vscode.commands.registerCommand(
    'latexVisualiser.generateProofImage',
    () => generateProofImage(context)
  );

  const suggestVizCmd = vscode.commands.registerCommand(
    'latexVisualiser.suggestVizAI',
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !isTexFile(editor.document)) {
        vscode.window.showErrorMessage('Open a .tex file to use AI visualization suggestions.');
        return;
      }

      const contextData = extractSuggestionContext(editor.document, editor.selection);

      try {
        const result = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'LaTeX Visualiser: Generating visualization suggestion',
            cancellable: false,
          },
          async () => suggestionService.suggestVizBlock(contextData)
        );

        const insertPosition = editor.selection.active;
        const blockToInsert = `\n${result.vizBlock}\n`;
        const ok = await editor.edit(editBuilder => {
          editBuilder.insert(insertPosition, blockToInsert);
        });

        if (!ok) {
          vscode.window.showErrorMessage('Failed to insert generated viz block.');
          return;
        }

        if (result.usedFallback) {
          vscode.window.showWarningMessage('OSS provider unavailable. Inserted mock AI suggestion instead.');
        } else {
          vscode.window.showInformationMessage(`Inserted AI visualization suggestion via ${result.provider}.`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        vscode.window.showErrorMessage(`Failed to generate suggestion: ${message}`);
      }
    }
  );

  const suggestOverlayCmd = vscode.commands.registerCommand(
    'latexVisualiser.suggestOverlayAI',
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !isTexFile(editor.document)) {
        vscode.window.showErrorMessage('Open a .tex file to generate overlay layers.');
        return;
      }

      const blocks = parseVizBlocks(editor.document.getText());
      const targetBlock = findNearestVizBlock(blocks, editor.document.offsetAt(editor.selection.active));
      if (!targetBlock) {
        vscode.window.showErrorMessage('No viz block found near cursor to attach overlay layers.');
        return;
      }

      const contextData = extractSuggestionContext(editor.document, editor.selection);
      try {
        const result = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'LaTeX Visualiser: Generating overlay layers',
            cancellable: false,
          },
          async () => suggestionService.suggestOverlayLayers(contextData)
        );

        const insertionText = `\n${result.directives.join('\n')}`;
        const insertPosition = editor.document.positionAt(targetBlock.endTagOffset);
        const ok = await editor.edit(editBuilder => {
          editBuilder.insert(insertPosition, insertionText);
        });

        if (!ok) {
          vscode.window.showErrorMessage('Failed to insert generated overlay directives.');
          return;
        }

        if (result.usedFallback) {
          vscode.window.showWarningMessage('OSS provider unavailable. Inserted mock overlay layers instead.');
        } else {
          vscode.window.showInformationMessage(`Inserted AI overlay layer directives via ${result.provider}.`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        vscode.window.showErrorMessage(`Failed to generate overlay layers: ${message}`);
      }
    }
  );

  registerVizDecorations(context);
  registerVizCodeLens(context);

  const editorChangeDisposable = vscode.window.onDidChangeActiveTextEditor(editor => {
    if (editor && isTexFile(editor.document)) {
      currentTexDocument = editor.document;
    }
  });

  const saveDisposable = vscode.workspace.onDidSaveTextDocument(doc => {
    if (isTexFile(doc) && currentPanel) {
      currentTexDocument = doc;
      setTimeout(() => refreshVisualizations(), 1500);
    }
  });

  if (vscode.window.activeTextEditor && isTexFile(vscode.window.activeTextEditor.document)) {
    currentTexDocument = vscode.window.activeTextEditor.document;
  }

  context.subscriptions.push(
    openViewerCmd,
    refreshCmd,
    generateProofImageCmd,
    suggestVizCmd,
    suggestOverlayCmd,
    editorChangeDisposable,
    saveDisposable
  );
}

// ── Generate Proof Image ──────────────────────────────────────────────────────

async function generateProofImage(context: vscode.ExtensionContext) {
  outputChannel.appendLine('generateProofImage triggered');

  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    outputChannel.appendLine('No active editor');
    return;
  }

  if (editor.selection.isEmpty) {
    vscode.window.showWarningMessage('Select a proof block first, then right-click → Generate Proof Image.');
    return;
  }

  const selectedText = editor.document.getText(editor.selection);
  outputChannel.appendLine('Selected text length: ' + selectedText.length);

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: '◈ LaTeX Visualiser: Generating proof image...',
      cancellable: false,
    },
    async () => {
      try {
        outputChannel.appendLine('Calling Claude...');
        const { preamble, tikzCode } = await generateTikZFromClaude(selectedText);
        outputChannel.appendLine('Claude returned TikZ, length: ' + tikzCode.length);

        const figure = wrapInFigure(tikzCode);
        showChatPanel(preamble, figure, tikzCode, context);

        outputChannel.appendLine('Compiling TikZ to PNG...');
        const pngBase64 = await compileTikzToPng(tikzCode);

        if (currentChatPanel) {
          if (pngBase64) {
            outputChannel.appendLine('PNG ready, sending to webview');
            currentChatPanel.webview.postMessage({ type: 'pdfPreview', pdfBase64: pngBase64 });
          } else {
            outputChannel.appendLine('PNG compilation failed');
            currentChatPanel.webview.postMessage({
              type: 'pdfError',
              text: 'Could not compile preview — check TikZ syntax',
            });
          }
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        outputChannel.appendLine('ERROR: ' + errMsg);
        vscode.window.showErrorMessage(`LaTeX Visualiser: ${errMsg}`);
      }
    }
  );
}

// ── Chat panel ────────────────────────────────────────────────────────────────

function showChatPanel(
  preamble: string,
  figureCode: string,
  tikzCode: string,
  context: vscode.ExtensionContext
) {
  const panel = vscode.window.createWebviewPanel(
    'latexProofChat',
    '◈ Proof Diagram Chat',
    vscode.ViewColumn.Beside,
    { enableScripts: true }
  );

  currentChatPanel = panel;
  panel.onDidDispose(() => { currentChatPanel = undefined; });

  let latestPreamble = preamble;
  let latestTikz     = tikzCode;

  panel.webview.html = getChatPanelHtml(tikzCode);

  panel.webview.onDidReceiveMessage(async message => {

    if (message.type === 'openCodePanel') {
      const tikzToShow = message.tikz || latestTikz;
      showCodePanel(latestPreamble, wrapInFigure(tikzToShow), context);
    }

    if (message.type === 'adjustDiagram') {
      try {
        outputChannel.appendLine('Adjusting diagram: ' + message.text);
        const client = getAnthropicClient();
        const response = await client.messages.create({
          model: 'claude-opus-4-6',
          max_tokens: 2048,
          messages: [{
            role: 'user',
            content: `You are a TikZ expert. Here is the current TikZ diagram:

\`\`\`latex
${latestTikz}
\`\`\`

The user wants to make this adjustment: ${message.text}

Return ONLY the updated TikZ code starting with \\begin{tikzpicture} and ending with \\end{tikzpicture}. No explanation, no markdown fences.

If the adjustment requires new preamble packages or libraries, prepend them as a comment like:
% PREAMBLE: \\usetikzlibrary{...}`,
          }],
        });

        const content = response.content[0];
        if (content.type !== 'text') { throw new Error('Unexpected response'); }

        const preambleUpdateMatch = content.text.match(/% PREAMBLE: (.+)/);
        if (preambleUpdateMatch) {
          latestPreamble = latestPreamble + '\n' + preambleUpdateMatch[1];
        }

        latestTikz = extractTikzCode(content.text);
        panel.webview.postMessage({ type: 'newDiagram', tikz: latestTikz });

        panel.webview.postMessage({ type: 'compiling' });
        outputChannel.appendLine('Compiling adjusted TikZ...');
        const pngBase64 = await compileTikzToPng(latestTikz);

        if (pngBase64) {
          panel.webview.postMessage({ type: 'pdfPreview', pdfBase64: pngBase64 });
        } else {
          panel.webview.postMessage({ type: 'pdfError', text: 'Could not compile preview — check TikZ syntax' });
        }

      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        outputChannel.appendLine('adjustDiagram ERROR: ' + errMsg);
        panel.webview.postMessage({ type: 'error', text: errMsg });
      }
    }

  }, undefined, context.subscriptions);
}

// ── Code panel ────────────────────────────────────────────────────────────────

function showCodePanel(preamble: string, figureCode: string, context: vscode.ExtensionContext) {
  const panel = vscode.window.createWebviewPanel(
    'latexCodePanel',
    '◈ Image Code',
    vscode.ViewColumn.Beside,
    { enableScripts: true }
  );

  panel.webview.html = getCodePanelHtml(preamble, figureCode);

  panel.webview.onDidReceiveMessage(async message => {
    if (message.type === 'insertAtCursor') {
      const editor = vscode.window.visibleTextEditors.find(e => isTexFile(e.document));
      if (editor) {
        await editor.edit(eb => eb.insert(editor.selection.end, '\n\n' + figureCode));
        panel.webview.postMessage({ text: 'Inserted into document ✓' });
      }
    }
  }, undefined, context.subscriptions);
}

function getCodePanelHtml(preamble: string, figureCode: string): string {
  const escapedPreamble = escapeHtml(preamble);
  const escapedFigure   = escapeHtml(figureCode);

  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="UTF-8">',
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\';">',
    '<title>Image Code</title>',
    '<style>',
    '* { margin: 0; padding: 0; box-sizing: border-box; }',
    'body { background: #f9f9f9; color: #1a1a1a; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 28px 24px; display: flex; flex-direction: column; gap: 20px; min-height: 100vh; }',
    '.header h1 { font-size: 15px; font-weight: 600; color: #1a1a1a; margin-bottom: 4px; }',
    '.header p { font-size: 12px; color: #888; line-height: 1.5; }',
    '.section { background: #fff; border: 1px solid #e4e4e4; border-radius: 10px; overflow: hidden; }',
    '.section-header { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; background: #f4f4f4; border-bottom: 1px solid #e4e4e4; }',
    '.section-header .label { font-size: 11px; font-weight: 600; color: #555; text-transform: uppercase; letter-spacing: 0.5px; }',
    '.copy-btn { font-size: 11px; color: #6366f1; background: none; border: 1px solid #6366f1; border-radius: 5px; padding: 2px 10px; cursor: pointer; transition: all 0.15s; font-family: inherit; }',
    '.copy-btn:hover { background: #6366f1; color: white; }',
    '.copy-btn.copied { background: #22c55e; border-color: #22c55e; color: white; }',
    'pre { padding: 14px 16px; font-family: "Fira Code", "SF Mono", "Courier New", monospace; font-size: 12px; line-height: 1.65; color: #1a1a1a; white-space: pre-wrap; word-break: break-word; overflow: auto; max-height: 280px; }',
    '.insert-btn { width: 100%; padding: 10px; background: #6366f1; color: white; border: none; border-radius: 8px; font-size: 13px; font-weight: 500; cursor: pointer; transition: background 0.15s; font-family: inherit; }',
    '.insert-btn:hover { background: #4f46e5; }',
    '.toast { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); background: #22c55e; color: white; padding: 8px 18px; border-radius: 8px; font-size: 12px; opacity: 0; transition: opacity 0.3s; pointer-events: none; }',
    '.toast.show { opacity: 1; }',
    '</style>',
    '</head>',
    '<body>',
    '<div class="header">',
    '  <h1>&#9672; Image Code</h1>',
    '  <p>Latest version of your generated TikZ diagram.</p>',
    '</div>',
    '<div class="section">',
    '  <div class="section-header">',
    '    <span class="label">Preamble — add to top of your .tex file</span>',
    '    <button class="copy-btn" onclick="copySection(\'preamble\', this)">Copy</button>',
    '  </div>',
    '  <pre id="preamble">' + escapedPreamble + '</pre>',
    '</div>',
    '<div class="section">',
    '  <div class="section-header">',
    '    <span class="label">TikZ Figure — paste where you want the image</span>',
    '    <button class="copy-btn" onclick="copySection(\'figure\', this)">Copy</button>',
    '  </div>',
    '  <pre id="figure">' + escapedFigure + '</pre>',
    '</div>',
    '<button class="insert-btn" onclick="insertAtCursor()">Insert Figure After Selection in .tex File</button>',
    '<div class="toast" id="toast"></div>',
    '<script>',
    '  const vscode = acquireVsCodeApi();',
    '  function copySection(id, btn) {',
    '    const text = document.getElementById(id).textContent;',
    '    navigator.clipboard.writeText(text).then(function() {',
    '      btn.textContent = "Copied!";',
    '      btn.classList.add("copied");',
    '      setTimeout(function() { btn.textContent = "Copy"; btn.classList.remove("copied"); }, 2000);',
    '    });',
    '  }',
    '  function insertAtCursor() { vscode.postMessage({ type: "insertAtCursor" }); }',
    '  window.addEventListener("message", function(e) {',
    '    const toast = document.getElementById("toast");',
    '    toast.textContent = e.data.text;',
    '    toast.classList.add("show");',
    '    setTimeout(function() { toast.classList.remove("show"); }, 2500);',
    '  });',
    '<\/script>',
    '</body>',
    '</html>',
  ].join('\n');
}

// ── Viewer ────────────────────────────────────────────────────────────────────

function isTexFile(doc: vscode.TextDocument): boolean {
  return doc.languageId === 'latex' || doc.languageId === 'tex' || doc.fileName.endsWith('.tex');
}

async function openViewer(context: vscode.ExtensionContext) {
  if (!currentTexDocument) {
    const editor = vscode.window.activeTextEditor;
    if (editor && isTexFile(editor.document)) {
      currentTexDocument = editor.document;
    } else {
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
    vscode.window.showWarningMessage('No compiled PDF found. Compile your .tex file first.');
  }

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
      if (fileWatcher) { fileWatcher.dispose(); fileWatcher = undefined; }
    });

    currentPanel.webview.onDidReceiveMessage(
      message => handleWebviewMessage(message, context),
      undefined,
      context.subscriptions
    );
  }

  if (pdfPath && !fileWatcher) {
    fileWatcher = vscode.workspace.createFileSystemWatcher(pdfPath);
    fileWatcher.onDidChange(() => {
      if (currentPanel) { setTimeout(() => refreshVisualizations(), 500); }
    });
  }

  await loadWebview(context, pdfPath);
}

async function loadWebview(context: vscode.ExtensionContext, pdfPath: string | undefined) {
  if (!currentPanel || !currentTexDocument) { return; }

  const texText     = currentTexDocument.getText();
  const blocks      = parseVizBlocks(texText);
  const config      = vscode.workspace.getConfiguration('latexVisualiser');
  const resolution  = config.get<number>('plotResolution') || 50;
  const popupWidth  = config.get<number>('popupWidth')     || 450;
  const popupHeight = config.get<number>('popupHeight')    || 400;
  const plots       = generateAllPlots(blocks, resolution);

  let pdfBase64: string | undefined;
  if (pdfPath && fs.existsSync(pdfPath)) {
    pdfBase64 = fs.readFileSync(pdfPath).toString('base64');
  }

  const totalLines = texText.split('\n').length;
  const markers    = estimateVizPositions(blocks, totalLines, Math.max(1, Math.ceil(totalLines / 50)));

  const pdfjsScriptUri  = currentPanel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.min.mjs')).toString();
  const pdfjsWorkerUri  = currentPanel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.worker.min.mjs')).toString();
  const plotlyScriptUri = currentPanel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'node_modules', 'plotly.js-dist-min', 'plotly.min.js')).toString();

  currentPanel.webview.html = getWebviewContent({
    pdfBase64,
    pdfjsScriptUri,
    pdfjsWorkerUri,
    plotlyScriptUri,
    plots,
    markers,
    config: { popupWidth, popupHeight, resolution },
    cspSource: currentPanel.webview.cspSource,
  });
}

// ── Refresh ───────────────────────────────────────────────────────────────────

function refreshVisualizations() {
  if (!currentPanel || !currentTexDocument) { return; }

  const texText    = currentTexDocument.getText();
  const blocks     = parseVizBlocks(texText);
  const config     = vscode.workspace.getConfiguration('latexVisualiser');
  const resolution = config.get<number>('plotResolution') || 50;
  const plots      = generateAllPlots(blocks, resolution);
  const totalLines = texText.split('\n').length;
  const markers    = estimateVizPositions(blocks, totalLines, Math.max(1, Math.ceil(totalLines / 50)));

  currentPanel.webview.postMessage({ type: 'updateViz', plots, markers });

  const pdfPath = findPdfForTex(currentTexDocument.uri.fsPath);
  if (pdfPath && fs.existsSync(pdfPath)) {
    currentPanel.webview.postMessage({
      type: 'updatePdf',
      pdfBase64: fs.readFileSync(pdfPath).toString('base64'),
    });
  }
}

// ── Message handler ───────────────────────────────────────────────────────────

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
        const line  = Math.max(0, message.line - 1);
        const range = new vscode.Range(line, 0, line, 0);
        vscode.window.showTextDocument(currentTexDocument, {
          selection: range,
          viewColumn: vscode.ViewColumn.One,
        });
      }
      break;
  }
}

// ── Deactivate ────────────────────────────────────────────────────────────────

export function deactivate() {
  if (fileWatcher) { fileWatcher.dispose(); }
}
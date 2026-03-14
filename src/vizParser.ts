import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Represents a parsed viz block from a .tex file.
 */
export interface VizBlock {
  /** The raw LaTeX equation string */
  equation: string;
  /** Optional label for the viz block */
  label?: string;
  /** Optional visualization type hint (surface, contour, parametric, curve) */
  vizType?: string;
  /** Optional parameters like range, color, etc. */
  params: Record<string, string>;
  /** Line number in the .tex file where this block starts */
  lineNumber: number;
  /** The position index (0-based) among all viz blocks */
  index: number;
}

/**
 * Represents the mapping from a viz block to its approximate PDF position.
 */
export interface VizMarker {
  block: VizBlock;
  /** Page number (1-based) */
  page: number;
  /** Estimated y-position ratio on the page (0 = top, 1 = bottom) */
  yRatio: number;
}

/**
 * Parse all \begin{viz}...\end{viz} blocks from a LaTeX document.
 */
export function parseVizBlocks(text: string): VizBlock[] {
  const blocks: VizBlock[] = [];
  // Match \begin{viz}[optional params]...\end{viz}
  const regex = /\\begin\{viz\}(?:\[([^\]]*)\])?\s*([\s\S]*?)\s*\\end\{viz\}/g;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = regex.exec(text)) !== null) {
    const optionalParams = match[1] || '';
    const body = match[2].trim();

    // Calculate line number
    const lineNumber = text.substring(0, match.index).split('\n').length;

    // Parse optional parameters like [type=surface, label=paraboloid, xrange=-2:2]
    const params: Record<string, string> = {};
    if (optionalParams) {
      for (const param of optionalParams.split(',')) {
        const [key, ...valueParts] = param.split('=');
        if (key && valueParts.length > 0) {
          params[key.trim()] = valueParts.join('=').trim();
        }
      }
    }

    blocks.push({
      equation: body,
      label: params['label'],
      vizType: params['type'] || inferVizType(body),
      params,
      lineNumber,
      index: index++,
    });
  }

  return blocks;
}

/**
 * Infer the visualization type from the equation content.
 */
function inferVizType(equation: string): string {
  // Check for 3D indicators (z = f(x,y) patterns)
  if (/[zZ]\s*=/.test(equation) || /\\left\(.*,.*,.*\\right\)/.test(equation)) {
    return 'surface';
  }
  // Check for parametric curves (multiple equations with parameter t)
  if (/\\begin\{cases\}/.test(equation) || (equation.includes('x =') && equation.includes('y ='))) {
    return 'parametric';
  }
  // Check for explicit 2D: y = f(x)
  if (/[yY]\s*=/.test(equation) || /f\s*\(\s*x\s*\)/.test(equation)) {
    return 'curve';
  }
  // Default to surface for anything with two variables
  if (/[xX]/.test(equation) && /[yY]/.test(equation)) {
    return 'surface';
  }
  // Single variable → curve
  return 'curve';
}

/**
 * Estimate where each viz block appears on the compiled PDF pages.
 * Uses a simple heuristic based on line position in the document.
 */
export function estimateVizPositions(
  blocks: VizBlock[],
  totalLines: number,
  totalPages: number
): VizMarker[] {
  return blocks.map(block => {
    const docRatio = block.lineNumber / totalLines;
    const page = Math.min(Math.ceil(docRatio * totalPages), totalPages);
    const linesPerPage = totalLines / totalPages;
    const pageStartLine = (page - 1) * linesPerPage;
    const yRatio = (block.lineNumber - pageStartLine) / linesPerPage;

    return {
      block,
      page,
      yRatio: Math.max(0, Math.min(1, yRatio)),
    };
  });
}

/**
 * Find the PDF file corresponding to a .tex file.
 */
export function findPdfForTex(texFilePath: string): string | undefined {
  const config = vscode.workspace.getConfiguration('latexVisualiser');
  const configuredPath = config.get<string>('pdfPath');

  if (configuredPath) {
    if (path.isAbsolute(configuredPath)) {
      return fs.existsSync(configuredPath) ? configuredPath : undefined;
    }
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (workspaceFolder) {
      const resolved = path.resolve(workspaceFolder, configuredPath);
      return fs.existsSync(resolved) ? resolved : undefined;
    }
  }

  // Auto-detect: same name, .pdf extension
  const pdfPath = texFilePath.replace(/\.tex$/, '.pdf');
  if (fs.existsSync(pdfPath)) {
    return pdfPath;
  }

  // Check common output directories
  const dir = path.dirname(texFilePath);
  const baseName = path.basename(texFilePath, '.tex');
  const candidates = [
    path.join(dir, 'build', `${baseName}.pdf`),
    path.join(dir, 'out', `${baseName}.pdf`),
    path.join(dir, 'output', `${baseName}.pdf`),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

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
  /** Parsed AI/author-provided overlay layers attached to this viz block. */
  layers: VizLayer[];
  /** Start offset of the full viz block in the source text. */
  startOffset: number;
  /** Offset where \end{viz} begins (used for in-place insertion before end tag). */
  endTagOffset: number;
  /** End offset (exclusive) of the full viz block in the source text. */
  endOffset: number;
}

export interface VizLayerPoint {
  x: number;
  y?: number;
  z?: number;
  label?: string;
}

export interface VizLayerStyle {
  color?: string;
  symbol?: string;
  size?: number;
}

export interface VizLayer {
  kind: 'critical-point' | 'annotation';
  label?: string;
  points: VizLayerPoint[];
  style?: VizLayerStyle;
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
    const { equation, layers } = splitEquationAndLayers(body);
    const startOffset = match.index;
    const endOffset = match.index + match[0].length;
    const endTagRelative = match[0].lastIndexOf('\\end{viz}');
    const endTagOffset = endTagRelative >= 0 ? startOffset + endTagRelative : endOffset;

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
      equation,
      label: params['label'],
      vizType: params['type'] || inferVizType(equation),
      params,
      lineNumber,
      index: index++,
      layers,
      startOffset,
      endTagOffset,
      endOffset,
    });
  }

  return blocks;
}

/**
 * Parse and remove inline layer directives from the viz body.
 * Directive syntax: %@layer {"kind":"critical-point",...}
 */
function splitEquationAndLayers(body: string): { equation: string; layers: VizLayer[] } {
  const layers: VizLayer[] = [];
  const equationLines: string[] = [];

  for (const line of body.split(/\r?\n/)) {
    const layer = parseLayerDirectiveLine(line);
    if (layer) {
      layers.push(layer);
    } else {
      equationLines.push(line);
    }
  }

  return {
    equation: equationLines.join('\n').trim(),
    layers,
  };
}

function parseLayerDirectiveLine(line: string): VizLayer | undefined {
  const match = line.match(/^\s*%@layer\s+(.+)\s*$/);
  if (!match) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(match[1]);
    return normalizeLayer(parsed);
  } catch {
    return undefined;
  }
}

function normalizeLayer(input: unknown): VizLayer | undefined {
  if (!input || typeof input !== 'object') {
    return undefined;
  }
  const candidate = input as Record<string, unknown>;
  const kind = candidate.kind;
  if (kind !== 'critical-point' && kind !== 'annotation') {
    return undefined;
  }

  const rawPoints = Array.isArray(candidate.points) ? candidate.points : [];
  const points: VizLayerPoint[] = rawPoints
    .map(p => normalizeLayerPoint(p))
    .filter((p): p is VizLayerPoint => !!p);

  if (points.length === 0) {
    return undefined;
  }

  const style = normalizeStyle(candidate.style);
  return {
    kind,
    label: typeof candidate.label === 'string' ? candidate.label : undefined,
    points,
    style,
  };
}

function normalizeLayerPoint(input: unknown): VizLayerPoint | undefined {
  if (!input || typeof input !== 'object') {
    return undefined;
  }
  const candidate = input as Record<string, unknown>;
  const x = toFiniteNumber(candidate.x);
  if (x === undefined) {
    return undefined;
  }
  const y = toFiniteNumber(candidate.y);
  const z = toFiniteNumber(candidate.z);

  return {
    x,
    y,
    z,
    label: typeof candidate.label === 'string' ? candidate.label : undefined,
  };
}

function normalizeStyle(input: unknown): VizLayerStyle | undefined {
  if (!input || typeof input !== 'object') {
    return undefined;
  }
  const candidate = input as Record<string, unknown>;
  const size = toFiniteNumber(candidate.size);

  return {
    color: typeof candidate.color === 'string' ? candidate.color : undefined,
    symbol: typeof candidate.symbol === 'string' ? candidate.symbol : undefined,
    size,
  };
}

function toFiniteNumber(input: unknown): number | undefined {
  if (typeof input === 'number' && Number.isFinite(input)) {
    return input;
  }
  if (typeof input === 'string') {
    const value = Number(input);
    return Number.isFinite(value) ? value : undefined;
  }
  return undefined;
}

export function serializeLayerDirective(layer: VizLayer): string {
  return `%@layer ${JSON.stringify(layer)}`;
}

export function parseLayerDirectives(text: string): VizLayer[] {
  const layers: VizLayer[] = [];
  for (const line of text.split(/\r?\n/)) {
    const parsed = parseLayerDirectiveLine(line);
    if (parsed) {
      layers.push(parsed);
    }
  }
  return layers;
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

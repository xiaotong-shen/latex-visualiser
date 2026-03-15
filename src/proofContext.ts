import * as vscode from 'vscode';

export interface ProofRange {
  startOffset: number;
  endOffset: number;
  text: string;
}

export interface SuggestionContext {
  proofText?: string;
  selectedText?: string;
  currentLine: string;
  nearbyEquation?: string;
}

/**
 * Build a lightweight context object for AI suggestion generation.
 */
export function extractSuggestionContext(
  document: vscode.TextDocument,
  selection: vscode.Selection
): SuggestionContext {
  const text = document.getText();
  const cursorOffset = document.offsetAt(selection.active);
  const currentLine = document.lineAt(selection.active.line).text.trim();
  const selectedText = selection.isEmpty ? undefined : document.getText(selection).trim();
  const nearestProof = findNearestProofEnvironment(text, cursorOffset);
  const nearestVizEquation = findNearestVizEquation(text, cursorOffset);
  const sourceText = selectedText || nearestProof?.text || nearestVizEquation || currentLine;

  return {
    proofText: nearestProof?.text,
    selectedText,
    currentLine,
    nearbyEquation: nearestVizEquation || findFirstEquationLikeSnippet(sourceText),
  };
}

/**
 * Find the nearest proof environment that contains the cursor offset.
 */
export function findNearestProofEnvironment(text: string, cursorOffset: number): ProofRange | undefined {
  const regex = /\\begin\{proof\}([\s\S]*?)\\end\{proof\}/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const startOffset = match.index;
    const endOffset = match.index + match[0].length;
    if (cursorOffset >= startOffset && cursorOffset <= endOffset) {
      return {
        startOffset,
        endOffset,
        text: match[1].trim(),
      };
    }
  }

  // Fallback: choose the closest proof start before cursor.
  regex.lastIndex = 0;
  let closest: ProofRange | undefined;
  while ((match = regex.exec(text)) !== null) {
    const startOffset = match.index;
    const endOffset = match.index + match[0].length;
    if (startOffset <= cursorOffset) {
      closest = {
        startOffset,
        endOffset,
        text: match[1].trim(),
      };
    }
  }

  return closest;
}

function findFirstEquationLikeSnippet(text: string): string | undefined {
  const candidates = [
    /([zy]\s*=\s*[^\n.]+)/i,
    /(x\s*=\s*[^\n;]+;\s*y\s*=\s*[^\n.]+)/i,
  ];

  for (const pattern of candidates) {
    const found = text.match(pattern);
    if (found?.[1]) {
      return found[1].trim();
    }
  }

  return undefined;
}

function findNearestVizEquation(text: string, cursorOffset: number): string | undefined {
  const regex = /\\begin\{viz\}(?:\[[^\]]*\])?\s*([\s\S]*?)\s*\\end\{viz\}/g;
  let match: RegExpExecArray | null;
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestEquation: string | undefined;

  while ((match = regex.exec(text)) !== null) {
    const start = match.index;
    const end = match.index + match[0].length;
    const distance = cursorOffset < start
      ? start - cursorOffset
      : cursorOffset > end
        ? cursorOffset - end
        : 0;

    if (distance < bestDistance) {
      const body = (match[1] || '').trim();
      if (body) {
        bestDistance = distance;
        bestEquation = body
          .split(/\r?\n/)
          .map(line => line.trim())
          .filter(line => line.length > 0 && !line.startsWith('%@layer'))[0];
      }
    }
  }

  return bestEquation;
}

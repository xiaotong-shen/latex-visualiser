import * as https from 'https';
import { URL } from 'url';
import * as vscode from 'vscode';
import { parseLayerDirectives, parseVizBlocks, serializeLayerDirective, VizLayer } from './vizParser';
import { SuggestionContext } from './proofContext';

type ProviderMode = 'mock' | 'openaiCompatible';

export interface SuggestionResult {
  vizBlock: string;
  provider: ProviderMode;
  usedFallback: boolean;
}

export interface AiSuggestionService {
  suggestVizBlock(context: SuggestionContext): Promise<SuggestionResult>;
  suggestOverlayLayers(context: SuggestionContext): Promise<OverlaySuggestionResult>;
}

export interface OverlaySuggestionResult {
  directives: string[];
  provider: ProviderMode;
  usedFallback: boolean;
}

interface OpenAiChatResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

const aiOutputChannel = vscode.window.createOutputChannel('LaTeX Visualiser AI');

export function createAiSuggestionService(): AiSuggestionService {
  return {
    async suggestVizBlock(context: SuggestionContext): Promise<SuggestionResult> {
      const config = vscode.workspace.getConfiguration('latexVisualiser');
      const provider: ProviderMode = 'openaiCompatible';
      const debug = isDebugEnabled(config);

      logAi(debug, 'suggestVizBlock:start', {
        provider,
        hasProofText: !!context.proofText,
        hasSelectedText: !!context.selectedText,
        currentLine: truncate(context.currentLine, 180),
        nearbyEquation: context.nearbyEquation,
      });

      const vizBlock = await requestOpenAiCompatibleSuggestion(context, config, debug);
      logAi(debug, 'suggestVizBlock:success', {
        provider,
        usedFallback: false,
        vizBlock,
      });
      return { vizBlock, provider, usedFallback: false };
    },
    async suggestOverlayLayers(context: SuggestionContext): Promise<OverlaySuggestionResult> {
      const config = vscode.workspace.getConfiguration('latexVisualiser');
      const provider: ProviderMode = 'openaiCompatible';
      const debug = isDebugEnabled(config);

      logAi(debug, 'suggestOverlayLayers:start', {
        provider,
        hasProofText: !!context.proofText,
        hasSelectedText: !!context.selectedText,
        currentLine: truncate(context.currentLine, 180),
        nearbyEquation: context.nearbyEquation,
      });

      const directives = await requestOpenAiCompatibleOverlaySuggestion(context, config, debug);
      logAi(debug, 'suggestOverlayLayers:success', {
        provider,
        usedFallback: false,
        directives,
      });
      return { directives, provider, usedFallback: false };
    },
  };
}

function buildPrompt(context: SuggestionContext): string {
  const source = context.proofText || context.selectedText || context.currentLine;
  const contextSummary = [
    `currentLine: ${context.currentLine || '(empty)'}`,
    `selectedText: ${context.selectedText || '(none)'}`,
    `nearbyEquation: ${context.nearbyEquation || '(none)'}`,
    `proofText:\n${context.proofText || '(none)'}`,
  ].join('\n');

  return [
    'You are an expert mathematical visualization assistant for a LaTeX extension.',
    'Your goal is to generate ONE high-value visualization block that best explains the proof.',
    '',
    'Output contract (must follow exactly):',
    '',
    '\\begin{viz}[type=<type>, label=<title>, xrange=a:b, yrange=c:d]',
    '<equation>',
    '\\end{viz}',
    '',
    'Allowed type values:',
    '- curve',
    '- surface',
    '- parametric',
    '',
    'Selection strategy:',
    '- Prefer equations explicitly present in the proof context.',
    '- If proving a critical point/saddle/max/min for z=f(x,y), prefer type=surface.',
    '- If equation is y=f(x), prefer type=curve.',
    '- If equation uses x(t), y(t), prefer type=parametric.',
    '',
    'Quality constraints:',
    '- Return ONLY one viz block and no prose.',
    '- Equation variables must be compatible with plotting: x, y, t.',
    '- Keep ranges practical for interpretation (typically -3:3 or -6:6 unless context suggests otherwise).',
    '- Label should be concise and meaningful for the theorem/proof claim.',
    '- Do not invent unrelated equations.',
    '',
    'Context snapshot:',
    contextSummary,
    '',
    'Primary source context:',
    source,
  ].join('\n');
}

async function requestOpenAiCompatibleSuggestion(
  context: SuggestionContext,
  config: vscode.WorkspaceConfiguration,
  debug: boolean
): Promise<string> {
  const baseUrl = config.get<string>('aiBaseUrl') ||
    'https://api.openai.com/v1';
  const model = config.get<string>('aiModel') || 'gpt-4.1-mini';
  const apiKey = config.get<string>('aiApiKey') || process.env.OPENAI_API_KEY || 'test';
  const timeoutMs = Math.max(1000, config.get<number>('aiTimeoutMs') || 8000);
  const userPrompt = buildPrompt(context);

  const body = {
    model,
    messages: [
      {
        role: 'system',
        content: 'Return exactly one valid LaTeX viz block. No markdown. No explanation. No extra text.'
      },
      { role: 'user', content: userPrompt },
    ],
    max_tokens: 220,
    temperature: 0.2,
  };

  logAi(debug, 'openaiCompatible:request(viz)', {
    baseUrl,
    model,
    timeoutMs,
    prompt: userPrompt,
  });

  const response = await postJson<OpenAiChatResponse>(
    `${baseUrl.replace(/\/$/, '')}/chat/completions`,
    body,
    {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    timeoutMs
  );

  const raw = response.choices?.[0]?.message?.content || '';
  logAi(debug, 'openaiCompatible:response(viz)', { raw });
  return sanitizeAndValidateVizBlock(raw);
}

async function requestOpenAiCompatibleOverlaySuggestion(
  context: SuggestionContext,
  config: vscode.WorkspaceConfiguration,
  debug: boolean
): Promise<string[]> {
  const baseUrl = config.get<string>('aiBaseUrl') ||
    'https://api.openai.com/v1';
  const model = config.get<string>('aiModel') || 'gpt-4.1-mini';
  const apiKey = config.get<string>('aiApiKey') || process.env.OPENAI_API_KEY || 'test';
  const timeoutMs = Math.max(1000, config.get<number>('aiTimeoutMs') || 8000);
  const userPrompt = buildOverlayPrompt(context);

  const body = {
    model,
    messages: [
      {
        role: 'system',
        content: 'Return only valid %@layer JSON lines. No markdown and no prose.'
      },
      { role: 'user', content: userPrompt },
    ],
    max_tokens: 300,
    temperature: 0.2,
  };

  logAi(debug, 'openaiCompatible:request(overlay)', {
    baseUrl,
    model,
    timeoutMs,
    prompt: userPrompt,
  });

  const response = await postJson<OpenAiChatResponse>(
    `${baseUrl.replace(/\/$/, '')}/chat/completions`,
    body,
    {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    timeoutMs
  );

  const raw = response.choices?.[0]?.message?.content || '';
  logAi(debug, 'openaiCompatible:response(overlay)', { raw });
  return sanitizeAndValidateLayerDirectives(raw);
}

function buildOverlayPrompt(context: SuggestionContext): string {
  const source = context.proofText || context.selectedText || context.currentLine;
  const equation = context.nearbyEquation || 'z = x^2 - y^2';

  return [
    'Generate 1-3 mathematically meaningful overlay directives for the current visualization.',
    'Return ONLY lines in this exact format:',
    '%@layer {"kind":"critical-point|annotation","label":"...","points":[{"x":0,"y":0,"z":0,"label":"..."}],"style":{"color":"#hex","symbol":"diamond","size":9}}',
    '',
    'Rules and quality constraints:',
    '- Each line must be valid JSON after %@layer.',
    '- Use coordinates compatible with the equation and proof context.',
    '- For 2D curves, omit z.',
    '- Prefer semantically useful points (critical points, intercepts, notable reference points).',
    '- Keep labels short and mathematically precise.',
    '- No markdown fences, no extra prose.',
    '',
    `Equation context: ${equation}`,
    `Proof context:\n${source}`,
  ].join('\n');
}

function createMockSuggestion(context: SuggestionContext): string {
  const source = (context.nearbyEquation || context.proofText || context.currentLine || '').toLowerCase();

  if (source.includes('saddle') || source.includes('x^2 - y^2') || source.includes('x^2-y^2')) {
    return [
      '\\begin{viz}[type=surface, label=Saddle Surface, xrange=-2:2, yrange=-2:2]',
      'z = x^2 - y^2',
      '\\end{viz}',
    ].join('\n');
  }

  if (source.includes('parametric') || (source.includes('x =') && source.includes('y =') && source.includes('t'))) {
    return [
      '\\begin{viz}[type=parametric, label=Parametric Curve, xrange=-2:2, yrange=-2:2]',
      'x = cos(t); y = sin(t)',
      '\\end{viz}',
    ].join('\n');
  }

  const equation = context.nearbyEquation || 'y = sin(x)';
  if (equation.toLowerCase().includes('z =')) {
    return [
      '\\begin{viz}[type=surface, label=AI Suggested Surface, xrange=-3:3, yrange=-3:3]',
      equation,
      '\\end{viz}',
    ].join('\n');
  }

  return [
    '\\begin{viz}[type=curve, label=AI Suggested Curve, xrange=-6:6, yrange=-2:2]',
    equation,
    '\\end{viz}',
  ].join('\n');
}

function createMockOverlaySuggestion(context: SuggestionContext): VizLayer[] {
  const source = `${context.nearbyEquation || ''}\n${context.proofText || ''}`.toLowerCase();

  if (source.includes('x^2 - y^2') || source.includes('x^2-y^2') || source.includes('saddle')) {
    return [
      {
        kind: 'critical-point',
        label: 'Saddle point',
        points: [{ x: 0, y: 0, z: 0, label: '(0,0,0)' }],
        style: { color: '#f59e0b', symbol: 'diamond', size: 10 },
      },
    ];
  }

  return [
    {
      kind: 'annotation',
      label: 'Reference point',
      points: [{ x: 0, y: 0, label: '(0,0)' }],
      style: { color: '#94e2d5', symbol: 'circle', size: 8 },
    },
  ];
}

function sanitizeAndValidateVizBlock(raw: string): string {
  const stripped = raw
    .replace(/^```(?:latex)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  const blockMatch = stripped.match(/\\begin\{viz\}[\s\S]*?\\end\{viz\}/);
  const candidate = (blockMatch ? blockMatch[0] : stripped).trim();
  const parsed = parseVizBlocks(candidate);
  if (parsed.length !== 1) {
    throw new Error('Generated output is not a valid single viz block.');
  }

  // Normalize unsupported alias from prompt examples.
  const normalized = candidate.replace(/type\s*=\s*graph\b/i, 'type=curve');
  const reParsed = parseVizBlocks(normalized);
  if (reParsed.length !== 1) {
    throw new Error('Generated output failed viz block normalization.');
  }

  return normalized;
}

function sanitizeAndValidateLayerDirectives(raw: string): string[] {
  const stripped = raw
    .replace(/^```(?:latex|json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  const lines = stripped
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.startsWith('%@layer '));

  if (lines.length === 0) {
    throw new Error('No layer directives found in model output.');
  }

  const parsed = parseLayerDirectives(lines.join('\n'));
  if (parsed.length === 0) {
    throw new Error('Layer directives were invalid.');
  }

  return parsed.map(layer => serializeLayerDirective(layer));
}

function postJson<T>(
  rawUrl: string,
  body: unknown,
  headers: Record<string, string>,
  timeoutMs: number
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const url = new URL(rawUrl);
    const payload = JSON.stringify(body);

    const req = https.request(
      {
        method: 'POST',
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        headers: {
          ...headers,
          'Content-Length': Buffer.byteLength(payload).toString(),
        },
      },
      res => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', chunk => {
          data += chunk;
        });
        res.on('end', () => {
          const status = res.statusCode || 500;
          if (status < 200 || status >= 300) {
            reject(new Error(`Request failed with status ${status}`));
            return;
          }

          try {
            resolve(JSON.parse(data) as T);
          } catch {
            reject(new Error('Failed to parse JSON response.'));
          }
        });
      }
    );

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('Request timed out'));
    });

    req.on('error', err => {
      reject(err);
    });

    req.write(payload);
    req.end();
  });
}

function isDebugEnabled(config: vscode.WorkspaceConfiguration): boolean {
  return !!config.get<boolean>('aiDebugLogs');
}

function logAi(enabled: boolean, event: string, payload?: unknown): void {
  if (!enabled) {
    return;
  }

  const timestamp = new Date().toISOString();
  aiOutputChannel.appendLine(`[${timestamp}] ${event}`);
  if (payload !== undefined) {
    aiOutputChannel.appendLine(stringifyDebug(payload));
  }
  aiOutputChannel.appendLine('');
}

function stringifyDebug(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

import { VizBlock, VizLayer, VizLayerPoint } from './vizParser';

/**
 * Represents Plotly-compatible plot data to send to the webview.
 */
export interface PlotData {
  type: 'surface' | 'scatter3d' | 'scatter' | 'contour';
  data: any[];
  layout: any;
  equation: string;
  label?: string;
}

/**
 * Convert a LaTeX equation into a JavaScript-evaluable math expression.
 */
function latexToJs(latex: string): string {
  let expr = latex.trim();

  // Remove the left-hand side (e.g., "z = " or "f(x,y) = ")
  expr = expr.replace(/^[a-zA-Z]\s*\(.*?\)\s*=\s*/, '');
  expr = expr.replace(/^[a-zA-Z]\s*=\s*/, '');

  // LaTeX → JS conversions
  expr = expr
    // Fractions: \frac{a}{b} → ((a)/(b))
    .replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, '(($1)/($2))')
    // Square root: \sqrt{x} → Math.sqrt(x)
    .replace(/\\sqrt\{([^{}]+)\}/g, 'Math.sqrt($1)')
    // Trig functions
    .replace(/\\sin/g, 'Math.sin')
    .replace(/\\cos/g, 'Math.cos')
    .replace(/\\tan/g, 'Math.tan')
    .replace(/\\arcsin/g, 'Math.asin')
    .replace(/\\arccos/g, 'Math.acos')
    .replace(/\\arctan/g, 'Math.atan')
    // Exponential and log
    .replace(/\\exp/g, 'Math.exp')
    .replace(/\\ln/g, 'Math.log')
    .replace(/\\log/g, 'Math.log10')
    // Constants
    .replace(/\\pi/g, 'Math.PI')
    .replace(/\\e(?![a-zA-Z])/g, 'Math.E')
    // Powers: x^{2} → Math.pow(x, 2) and x^2 → Math.pow(x, 2)
    .replace(/([a-zA-Z0-9\)\.]+)\^\{([^{}]+)\}/g, 'Math.pow($1, $2)')
    .replace(/([a-zA-Z0-9\)\.]+)\^(\d+)/g, 'Math.pow($1, $2)')
    // Absolute value: |x| → Math.abs(x) and \left|x\right| → Math.abs(x)
    .replace(/\\left\|([^|]+)\\right\|/g, 'Math.abs($1)')
    .replace(/\|([^|]+)\|/g, 'Math.abs($1)')
    // Remove remaining LaTeX commands
    .replace(/\\left/g, '')
    .replace(/\\right/g, '')
    .replace(/\\[a-zA-Z]+/g, '')
    // Implicit multiplication: 2x → 2*x, x y → x*y
    .replace(/(\d)([a-zA-Z])/g, '$1*$2')
    .replace(/([a-zA-Z])(\d)/g, '$1*$2')
    .replace(/\)\(/g, ')*(')
    .replace(/(\))([a-zA-Z])/g, '$1*$2')
    // Keep function calls valid (e.g. Math.sin(x)); avoid forcing implicit multiplication on fn calls.
    .replace(/\b([xyz])\(/g, '$1*(');

  // Fix double-star from implicit multiplication with Math functions
  expr = expr.replace(/Math\.\*/g, 'Math.');

  return expr;
}

/**
 * Parse range from params like "xrange=-2:2" → [-2, 2]
 */
function parseRange(rangeStr: string | undefined, defaultRange: [number, number]): [number, number] {
  if (!rangeStr) {return defaultRange;}
  const parts = rangeStr.split(':').map(Number);
  if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
    return [parts[0], parts[1]];
  }
  return defaultRange;
}

/**
 * Generate Plotly plot data from a viz block.
 */
export function generatePlotData(block: VizBlock, resolution: number = 50): PlotData {
  const jsExpr = latexToJs(block.equation);
  const vizType = block.vizType || 'surface';

  if (vizType === 'surface' || vizType === 'contour') {
    return generateSurfacePlot(block, jsExpr, resolution);
  } else if (vizType === 'parametric') {
    return generateParametricPlot(block, jsExpr, resolution);
  } else {
    return generateCurvePlot(block, jsExpr, resolution);
  }
}

function generateSurfacePlot(block: VizBlock, jsExpr: string, resolution: number): PlotData {
  const xRange = parseRange(block.params['xrange'], [-3, 3]);
  const yRange = parseRange(block.params['yrange'], [-3, 3]);

  // We'll send the expression to the webview for evaluation
  // This is safer and allows real-time interactivity
  const data = [{
    type: block.vizType === 'contour' ? 'contour' : 'surface',
    _expression: jsExpr,
    _xRange: xRange,
    _yRange: yRange,
    _resolution: resolution,
    colorscale: block.params['colorscale'] || 'Viridis',
    opacity: 0.9,
    contours: {
      z: { show: true, usecolormap: true, highlightcolor: "#42f5e3", project: { z: true } }
    }
  }];
  data.push(...buildLayerTraces(block.layers, 'surface'));

  return {
    type: block.vizType === 'contour' ? 'contour' : 'surface',
    equation: block.equation,
    label: block.label,
    data,
    layout: {
      title: block.label || block.equation,
      autosize: true,
      margin: { l: 30, r: 30, t: 40, b: 30 },
      scene: {
        xaxis: { title: 'x', range: xRange },
        yaxis: { title: 'y', range: yRange },
        zaxis: { title: 'z' },
        camera: {
          eye: { x: 1.5, y: 1.5, z: 1.2 }
        }
      },
      paper_bgcolor: 'rgba(0,0,0,0)',
      plot_bgcolor: 'rgba(0,0,0,0)',
    }
  };
}

function generateCurvePlot(block: VizBlock, jsExpr: string, resolution: number): PlotData {
  const xRange = parseRange(block.params['xrange'], [-5, 5]);
  const data = [{
    type: 'scatter',
    mode: 'lines',
    _expression: jsExpr,
    _xRange: xRange,
    _resolution: resolution * 4,
    line: { color: '#6366f1', width: 3 }
  }];
  data.push(...buildLayerTraces(block.layers, 'curve'));

  return {
    type: 'scatter',
    equation: block.equation,
    label: block.label,
    data,
    layout: {
      title: block.label || block.equation,
      autosize: true,
      margin: { l: 40, r: 20, t: 40, b: 40 },
      xaxis: { title: 'x', range: xRange },
      yaxis: { title: 'y' },
      paper_bgcolor: 'rgba(0,0,0,0)',
      plot_bgcolor: 'rgba(0,0,0,0)',
    }
  };
}

function generateParametricPlot(block: VizBlock, jsExpr: string, resolution: number): PlotData {
  const tRange = parseRange(block.params['trange'], [0, 6.28318]);
  const data = [{
    type: 'scatter',
    mode: 'lines',
    _expression: jsExpr,
    _tRange: tRange,
    _resolution: resolution * 4,
    _parametric: true,
    line: { color: '#f59e0b', width: 3 }
  }];
  data.push(...buildLayerTraces(block.layers, 'curve'));

  return {
    type: 'scatter',
    equation: block.equation,
    label: block.label,
    data,
    layout: {
      title: block.label || block.equation,
      autosize: true,
      margin: { l: 40, r: 20, t: 40, b: 40 },
      xaxis: { title: 'x' },
      yaxis: { title: 'y' },
      paper_bgcolor: 'rgba(0,0,0,0)',
      plot_bgcolor: 'rgba(0,0,0,0)',
    }
  };
}

/**
 * Generate all plot data for a set of viz blocks.
 */
export function generateAllPlots(blocks: VizBlock[], resolution: number = 50): PlotData[] {
  return blocks.map(block => generatePlotData(block, resolution));
}

function buildLayerTraces(layers: VizLayer[], mode: 'surface' | 'curve'): any[] {
  const traces: any[] = [];

  for (const layer of layers) {
    const points = layer.points.filter(p => isPointValid(p, mode));
    if (points.length === 0) {
      continue;
    }

    const color = layer.style?.color || (layer.kind === 'critical-point' ? '#f59e0b' : '#94e2d5');
    const symbol = layer.style?.symbol || (layer.kind === 'critical-point' ? 'diamond' : 'circle');
    const size = layer.style?.size || (layer.kind === 'critical-point' ? 9 : 8);

    if (mode === 'surface') {
      traces.push({
        type: 'scatter3d',
        mode: points.some(p => p.label) ? 'markers+text' : 'markers',
        x: points.map(p => p.x),
        y: points.map(p => p.y),
        z: points.map(p => p.z),
        text: points.map(p => p.label || ''),
        textposition: 'top center',
        textfont: { color },
        marker: {
          color,
          size,
          symbol,
          line: { color: '#11111b', width: 1 },
        },
        hovertemplate: layer.label ? `${layer.label}<extra></extra>` : undefined,
        name: layer.label || layer.kind,
        showlegend: false,
      });
    } else {
      traces.push({
        type: 'scatter',
        mode: points.some(p => p.label) ? 'markers+text' : 'markers',
        x: points.map(p => p.x),
        y: points.map(p => p.y),
        text: points.map(p => p.label || ''),
        textposition: 'top center',
        textfont: { color },
        marker: {
          color,
          size,
          symbol,
          line: { color: '#11111b', width: 1 },
        },
        hovertemplate: layer.label ? `${layer.label}<extra></extra>` : undefined,
        name: layer.label || layer.kind,
        showlegend: false,
      });
    }
  }

  return traces;
}

function isPointValid(point: VizLayerPoint, mode: 'surface' | 'curve'): boolean {
  if (!Number.isFinite(point.x)) {
    return false;
  }
  if (mode === 'surface') {
    return Number.isFinite(point.y) && Number.isFinite(point.z);
  }
  return Number.isFinite(point.y);
}

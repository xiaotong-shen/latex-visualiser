# ◈ LaTeX Visualiser

A VS Code extension that brings your LaTeX equations to life. Hover over equations in your compiled PDF to see interactive 2D and 3D visualizations powered by Plotly.

![Demo](https://img.shields.io/badge/status-hackathon%20project-6366f1)

## Features

### 🔍 Hover to Visualize
Open your compiled PDF alongside your `.tex` file. Hover over any `\begin{viz}...\end{viz}` block to see an interactive Plotly graph — 3D surfaces, 2D curves, and more.

### 📝 Editor Integration
- **Syntax highlighting** — viz blocks are highlighted with a purple left border
- **CodeLens** — clickable "◈ Visualize" buttons appear above each viz block
- **AI suggestion** — clickable "✨ Suggest Visualization (AI)" appears above proof blocks
- **AI overlays** — clickable "✦ Suggest Overlay Layer (AI)" appears above viz blocks
- **Go to source** — click through from the visualization popup back to the source line

### 📊 Visualization Types
| Type | Description | Example |
|------|-------------|---------|
| `surface` | 3D surface plot | `z = x^2 + y^2` |
| `contour` | 2D contour map | `z = sin(x) * cos(y)` |
| `curve` | 2D line plot | `y = sin(x)` |
| `parametric` | Parametric curve | `x = cos(t); y = sin(t)` |

### ⚡ Auto-refresh
Visualizations update automatically when you save your `.tex` file and the PDF is recompiled.

## Quick Start

### 1. Install
```bash
# Clone the repo
git clone <this-repo>
cd latex-visualiser

# Install dependencies
npm install

# Compile
npm run compile
```

### 2. Run
Press `F5` in VS Code to launch the Extension Development Host.

### 3. Use
Add viz blocks to your `.tex` file:

```latex
\documentclass{article}
\usepackage{amsmath}

% Define the viz environment
\newenvironment{viz}{\begin{equation}}{\end{equation}}

\begin{document}

\begin{viz}[type=surface, label=Paraboloid]
z = x^2 + y^2
\end{viz}

\begin{viz}[type=curve, label=Sine Wave, xrange=-6:6]
y = \sin(x)
\end{viz}

\end{document}
```

Then run the command **LaTeX Visualiser: Open PDF Viewer** (`Cmd+Shift+P` → search for it).

## AI Suggestion (MVP)

Use the CodeLens action above a proof block:

- `✨ Suggest Visualization (AI)`

The extension extracts nearby proof context and inserts one `\\begin{viz}...\\end{viz}` block at your cursor.

### AI Overlay Layers (Option A)

Use the CodeLens action above a viz block:

- `✦ Suggest Overlay Layer (AI)`

The extension inserts one or more inline overlay directives inside the nearest viz block. Format:

```latex
%@layer {"kind":"critical-point","label":"Saddle point","points":[{"x":0,"y":0,"z":0,"label":"(0,0,0)"}],"style":{"color":"#f59e0b","symbol":"diamond","size":10}}
```

These directives are parsed as overlay traces and rendered on top of the base plot.

### Provider Modes

- `mock` (default): deterministic local suggestion, no API call
- `openaiCompatible`: calls an OpenAI-style chat completions endpoint

If `openaiCompatible` fails or times out, the extension automatically falls back to `mock`.

### Hackathon OSS Endpoint Setup

Set these extension settings:

- `latexVisualiser.aiProvider`: `openaiCompatible`
- `latexVisualiser.aiBaseUrl`: `https://vjioo4r1vyvcozuj.us-east-2.aws.endpoints.huggingface.cloud/v1`
- `latexVisualiser.aiModel`: `openai/gpt-oss-120b`
- `latexVisualiser.aiApiKey`: optional (or set `OPENAI_API_KEY` in your environment, otherwise `test` is used)

Optional:

- `latexVisualiser.aiTimeoutMs`: request timeout (default `8000`)

You can also set the API key in a local `.env` file at the project root:

```dotenv
OPENAI_API_KEY=your_api_key_here
```

You can start from `.env.example` and keep your real key in `.env`.

The extension loads `.env` on activation and uses `OPENAI_API_KEY` automatically when `latexVisualiser.aiApiKey` is empty.

## Viz Block Syntax

```latex
\begin{viz}[key=value, key=value]
equation
\end{viz}
```

### Parameters

| Parameter | Description | Default |
|-----------|-------------|---------|
| `type` | `surface`, `contour`, `curve`, `parametric` | Auto-detected |
| `label` | Display name for the visualization | The equation |
| `xrange` | X-axis range, e.g. `-3:3` | `-3:3` |
| `yrange` | Y-axis range, e.g. `-3:3` | `-3:3` |
| `trange` | Parameter range (parametric), e.g. `0:6.28` | `0:6.28` |
| `colorscale` | Plotly colorscale name | `Viridis` |

### Supported LaTeX Math

The parser understands common LaTeX math notation:
- Arithmetic: `+`, `-`, `*`, `/`
- Powers: `x^2`, `x^{3}`
- Fractions: `\frac{a}{b}`
- Trig: `\sin`, `\cos`, `\tan`
- Exponential: `\exp`, `\ln`, `\log`
- Constants: `\pi`
- Square root: `\sqrt{x}`
- Absolute value: `|x|`, `\left|x\right|`

## Extension Settings

| Setting | Description | Default |
|---------|-------------|---------|
| `latexVisualiser.pdfPath` | Path to compiled PDF (auto-detected) | `""` |
| `latexVisualiser.plotResolution` | Grid resolution for surface plots | `50` |
| `latexVisualiser.popupWidth` | Popup width in pixels | `450` |
| `latexVisualiser.popupHeight` | Popup height in pixels | `400` |
| `latexVisualiser.aiProvider` | AI provider mode (`mock` or `openaiCompatible`) | `mock` |
| `latexVisualiser.aiBaseUrl` | OpenAI-compatible API base URL | `https://.../v1` |
| `latexVisualiser.aiModel` | Model id for OpenAI-compatible mode | `openai/gpt-oss-120b` |
| `latexVisualiser.aiApiKey` | Optional API key override | `""` |
| `latexVisualiser.aiTimeoutMs` | AI request timeout in milliseconds | `8000` |

## Architecture

```
.tex file
  ↓ parse \begin{viz}...\end{viz}
Equation registry
  ↓ generate plot data
Plotly configs
  ↓
VS Code Webview
  ├── PDF.js (renders compiled PDF)
  ├── Viz markers (equation locations)
  └── Plotly popups (hover to show)
```

## Project Structure

```
src/
  extension.ts        — VS Code entry point
  vizParser.ts        — Parses viz blocks from .tex files
  plotGenerator.ts    — Converts LaTeX → Plotly plot data
  webviewContent.ts   — Generates the webview HTML
  vizDecorations.ts   — Editor decorations for viz blocks
  vizCodeLens.ts      — CodeLens provider ("◈ Visualize" buttons)

examples/
  sample.tex          — Sample .tex file with viz blocks
```

## Development

```bash
npm run watch    # Compile on change
# Press F5 to launch Extension Development Host
```

## License

MIT

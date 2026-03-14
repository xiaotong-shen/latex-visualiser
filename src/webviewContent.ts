//
// HACKATHON DEMO MODE:
// - Keep PDF.js as the primary rendering surface.
// - Overlay centered hover zones where viz equations are estimated to appear.
// - Hover shows a sample popup (no Plotly rendering yet).
//
import { PlotData } from './plotGenerator';
import { VizMarker } from './vizParser';

interface WebviewOptions {
  pdfBase64?: string;
  pdfjsScriptUri: string;
  pdfjsWorkerUri: string;
  plotlyScriptUri: string;
  plots: PlotData[];
  markers: VizMarker[];
  config: {
    popupWidth: number;
    popupHeight: number;
    resolution: number;
  };
  cspSource: string;
}

export function getWebviewContent(options: WebviewOptions): string {
  const { pdfBase64, pdfjsScriptUri, pdfjsWorkerUri, plotlyScriptUri, plots, markers, config, cspSource } = options;

  const plotsJson = JSON.stringify(plots);
  const markersJson = JSON.stringify(markers);
  const configJson = JSON.stringify(config);

  return /*html*/`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} data: blob:; script-src 'unsafe-inline' 'unsafe-eval' ${cspSource}; style-src 'unsafe-inline' ${cspSource}; font-src ${cspSource} data:;">
  <title>LaTeX Visualiser</title>

  <!-- PDF.js (local module) -->
  <script type="module">
    import * as pdfjsLibModule from "${pdfjsScriptUri}";
    window.pdfjsLib = pdfjsLibModule;
    window.PDFJS_WORKER_URI = "${pdfjsWorkerUri}";
  </script>

  <!-- Plotly (local) -->
  <script src="${plotlyScriptUri}"></script>

  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      background: #1e1e2e;
      color: #cdd6f4;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      overflow: hidden;
      height: 100vh;
      display: flex;
      flex-direction: column;
    }

    /* Header bar */
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 16px;
      background: #181825;
      border-bottom: 1px solid #313244;
      flex-shrink: 0;
    }

    .header h1 {
      font-size: 13px;
      font-weight: 600;
      color: #cba6f7;
      letter-spacing: 0.5px;
    }

    .header .badge {
      background: #45475a;
      color: #a6adc8;
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 11px;
    }

    .header .badge.active {
      background: #6366f1;
      color: white;
    }

    .header-right {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .zoom-controls {
      display: flex;
      align-items: center;
      gap: 4px;
      background: #11111b;
      border: 1px solid #313244;
      border-radius: 8px;
      padding: 2px;
    }

    .zoom-btn {
      width: 24px;
      height: 22px;
      border: none;
      border-radius: 6px;
      background: #313244;
      color: #cdd6f4;
      cursor: pointer;
      font-size: 12px;
      line-height: 1;
    }

    .zoom-btn:hover { background: #45475a; }

    .zoom-label {
      min-width: 44px;
      text-align: center;
      font-size: 11px;
      color: #a6adc8;
      user-select: none;
    }

    .page-controls {
      display: flex;
      align-items: center;
      gap: 4px;
      background: #11111b;
      border: 1px solid #313244;
      border-radius: 8px;
      padding: 2px;
    }

    .page-btn {
      width: 24px;
      height: 22px;
      border: none;
      border-radius: 6px;
      background: #313244;
      color: #cdd6f4;
      cursor: pointer;
      font-size: 12px;
      line-height: 1;
    }

    .page-btn:hover { background: #45475a; }
    .page-btn:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }

    .page-label {
      min-width: 56px;
      text-align: center;
      font-size: 11px;
      color: #a6adc8;
      user-select: none;
    }

    /* PDF container */
    .pdf-container {
      flex: 1;
      overflow-y: auto;
      overflow-x: hidden;
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 20px;
      gap: 20px;
    }

    .page-wrapper {
      position: relative;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
      border-radius: 4px;
      overflow: visible;
    }

    .page-wrapper canvas {
      display: block;
      border-radius: 4px;
    }

    /* Hover zones on PDF (approx equation boxes) */
    .viz-marker {
      position: absolute;
      left: 20%;
      width: 60%;
      height: 26px;
      transform: translateY(-50%);
      cursor: pointer;
      transition: all 0.2s ease;
      z-index: 5;
      border-radius: 6px;
      background: rgba(99, 102, 241, 0.03);
      border: 1px dashed rgba(99, 102, 241, 0.25);
    }

    .viz-marker-line {
      height: 100%;
      border-radius: 6px;
      background: linear-gradient(90deg, rgba(99, 102, 241, 0.02) 0%, rgba(99, 102, 241, 0.09) 50%, rgba(99, 102, 241, 0.02) 100%);
      opacity: 0.7;
      transition: opacity 0.3s ease;
    }

    .viz-marker-dot {
      position: absolute;
      right: 8px;
      top: 50%;
      transform: translateY(-50%);
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: #6366f1;
      box-shadow: 0 0 8px rgba(99, 102, 241, 0.6);
      transition: all 0.2s ease;
    }

    .viz-marker:hover .viz-marker-line {
      opacity: 1;
    }

    .viz-marker:hover .viz-marker-dot {
      transform: translateY(-50%) scale(1.4);
      box-shadow: 0 0 16px rgba(99, 102, 241, 0.8);
    }

    .viz-marker.active .viz-marker-line {
      opacity: 1;
      background: linear-gradient(90deg, rgba(245, 158, 11, 0.12) 0%, rgba(245, 158, 11, 0.2) 50%, rgba(245, 158, 11, 0.12) 100%);
    }

    .viz-marker.active .viz-marker-dot {
      background: #f59e0b;
      box-shadow: 0 0 16px rgba(245, 158, 11, 0.8);
      transform: translateY(-50%) scale(1.4);
    }

    /* Visualization popup */
    .viz-popup {
      position: fixed;
      z-index: 100;
      background: #1e1e2e;
      border: 1px solid #45475a;
      border-radius: 16px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5), 0 0 40px rgba(99, 102, 241, 0.1);
      overflow: hidden;
      opacity: 0;
      transform: translateY(10px) scale(0.95);
      transition: opacity 0.25s ease, transform 0.25s ease;
      pointer-events: none;
    }

    .viz-popup.dragging,
    .viz-popup.resizing {
      transition: none;
      user-select: none;
    }

    .viz-popup.visible {
      opacity: 1;
      transform: translateY(0) scale(1);
      pointer-events: all;
    }

    .viz-popup-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 16px;
      background: #181825;
      border-bottom: 1px solid #313244;
      cursor: grab;
    }

    .viz-popup-header:active {
      cursor: grabbing;
    }

    .viz-popup-header .equation-label {
      font-size: 12px;
      color: #cba6f7;
      font-family: 'SF Mono', 'Fira Code', monospace;
      max-width: 80%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .popup-header-actions {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .pin-btn {
      width: 20px;
      height: 20px;
      border-radius: 50%;
      border: none;
      background: #45475a;
      color: #a6adc8;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      transition: background 0.15s ease;
    }

    .pin-btn:hover {
      background: #89b4fa;
      color: #11111b;
    }

    .pin-btn.pinned {
      background: #f9e2af;
      color: #11111b;
    }

    .viz-popup-header .close-btn {
      width: 20px;
      height: 20px;
      border-radius: 50%;
      border: none;
      background: #45475a;
      color: #a6adc8;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      transition: background 0.15s ease;
    }

    .viz-popup-header .close-btn:hover {
      background: #f38ba8;
      color: white;
    }

    .viz-popup-body {
      padding: 8px;
    }

    .viz-popup-body .plot-container {
      border-radius: 8px;
      overflow: hidden;
    }

    .resize-handle {
      position: absolute;
      width: 12px;
      height: 12px;
      right: 4px;
      bottom: 4px;
      cursor: nwse-resize;
      border-right: 2px solid #6c7086;
      border-bottom: 2px solid #6c7086;
      opacity: 0.8;
      z-index: 120;
      touch-action: none;
    }

    .resize-handle:hover {
      opacity: 1;
      border-color: #89b4fa;
    }

    .viz-popup-footer {
      padding: 6px 16px 10px;
      display: flex;
      align-items: center;
      gap: 8px;
      border-top: 1px solid #313244;
    }

    .viz-popup-footer .viz-type-badge {
      font-size: 10px;
      padding: 2px 8px;
      border-radius: 8px;
      background: #313244;
      color: #a6adc8;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .viz-popup-footer .goto-btn {
      margin-left: auto;
      font-size: 11px;
      color: #6366f1;
      cursor: pointer;
      background: none;
      border: none;
      text-decoration: underline;
      transition: color 0.15s ease;
    }

    .viz-popup-footer .goto-btn:hover {
      color: #818cf8;
    }

    /* Loading state */
    .loading-overlay {
      position: absolute;
      inset: 0;
      background: rgba(30, 30, 46, 0.9);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      z-index: 200;
    }

    .loading-overlay.hidden { display: none; }

    .spinner {
      width: 40px;
      height: 40px;
      border: 3px solid #45475a;
      border-top-color: #6366f1;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    @keyframes spin { to { transform: rotate(360deg); } }

    .loading-overlay p {
      margin-top: 12px;
      font-size: 13px;
      color: #a6adc8;
    }

    /* No PDF state */
    .no-pdf {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 16px;
      color: #6c7086;
    }

    .no-pdf .icon {
      font-size: 48px;
      opacity: 0.3;
    }

    .no-pdf p {
      font-size: 14px;
      text-align: center;
      max-width: 300px;
      line-height: 1.6;
    }

    /* Scrollbar styling */
    ::-webkit-scrollbar { width: 8px; }
    ::-webkit-scrollbar-track { background: #181825; }
    ::-webkit-scrollbar-thumb { background: #45475a; border-radius: 4px; }
    ::-webkit-scrollbar-thumb:hover { background: #585b70; }
  </style>
</head>
<body>

  <div class="header">
    <h1>◈ LaTeX Visualiser</h1>
    <div class="header-right">
      <div class="page-controls">
        <button class="page-btn" id="pagePrev" title="Previous page">◀</button>
        <span class="page-label" id="pageLabel">1/1</span>
        <button class="page-btn" id="pageNext" title="Next page">▶</button>
      </div>
      <div class="zoom-controls">
        <button class="zoom-btn" id="zoomOut" title="Zoom out">−</button>
        <span class="zoom-label" id="zoomLabel">85%</span>
        <button class="zoom-btn" id="zoomIn" title="Zoom in">+</button>
      </div>
      <span class="badge" id="vizCount">0 viz blocks</span>
    </div>
  </div>

  <div class="pdf-container" id="pdfContainer">
    <div class="loading-overlay" id="loadingOverlay">
      <div class="spinner"></div>
      <p>Loading PDF...</p>
    </div>
  </div>

  <!-- Visualization popup -->
  <div class="viz-popup" id="vizPopup">
    <div class="viz-popup-header">
      <span class="equation-label" id="popupEquation"></span>
      <div class="popup-header-actions">
        <button class="pin-btn" id="popupPin" title="Pin popup">📌</button>
        <button class="close-btn" id="popupClose">✕</button>
      </div>
    </div>
    <div class="viz-popup-body">
      <div class="plot-container" id="plotContainer"></div>
    </div>
    <div class="viz-popup-footer">
      <span class="viz-type-badge" id="vizTypeBadge"></span>
      <button class="goto-btn" id="gotoSource">Go to source ↗</button>
    </div>
    <div class="resize-handle" id="popupResizeHandle" title="Resize popup"></div>
  </div>

  <script>
    // ========== Configuration ==========
    const vscode = acquireVsCodeApi();
    const CONFIG = ${configJson};
    let PLOTS = ${plotsJson};
    let MARKERS = ${markersJson};
    const PDF_BASE64 = ${pdfBase64 ? `"${pdfBase64}"` : 'null'};

    // ========== State ==========
    let pdfDoc = null;
    let renderedPages = [];
    let activeMarkerIndex = -1;
    let popupVisible = false;
    let pageCanvases = [];
    let currentPage = 1;
    let zoomLevel = 0.85;
    let templateRenderTimer = null;
    let draggingPopup = false;
    let resizingPopup = false;
    let dragOffsetX = 0;
    let dragOffsetY = 0;
    let resizeStartX = 0;
    let resizeStartY = 0;
    let resizeStartW = 0;
    let resizeStartH = 0;
    let activeResizePointerId = null;
    let resizeRafPending = false;
    let customPopupRect = null;
    const ZOOM_MIN = 0.5;
    const ZOOM_MAX = 1.0;
    const ZOOM_STEP = 0.1;
    const POPUP_MIN_W = 380;
    const POPUP_MIN_H = 300;

    // ========== PDF Rendering ==========
    async function initPdf(base64Data) {
      if (!base64Data) {
        showNoPdf();
        return;
      }

      const loading = document.getElementById('loadingOverlay');
      loading.classList.remove('hidden');

      try {
        const binaryString = atob(base64Data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }

        if (!window.pdfjsLib) {
          throw new Error('PDF.js local module not loaded');
        }
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = window.PDFJS_WORKER_URI;

        pdfDoc = await window.pdfjsLib.getDocument({ data: bytes }).promise;
        currentPage = Math.max(1, Math.min(currentPage, pdfDoc.numPages || 1));
        updatePageLabel();
        await renderAllPages();
        placeVizMarkers();
        updateBadge();
      } catch (err) {
        console.error('PDF load error:', err);
        vscode.postMessage({ type: 'error', text: 'Failed to load PDF: ' + err.message });
        showNoPdf();
      } finally {
        loading.classList.add('hidden');
      }
    }

    async function renderAllPages() {
      const container = document.getElementById('pdfContainer');
      // Remove old pages
      container.querySelectorAll('.page-wrapper').forEach(el => el.remove());
      pageCanvases = [];

      const containerWidth = container.clientWidth - 40; // padding

      const pageNum = Math.max(1, Math.min(currentPage, pdfDoc.numPages || 1));
      const page = await pdfDoc.getPage(pageNum);
      const baseViewport = page.getViewport({ scale: 1.0 });
      const fitScale = Math.min(containerWidth / baseViewport.width, 2.0);
      const scale = fitScale * zoomLevel;
      const viewport = page.getViewport({ scale });

      const wrapper = document.createElement('div');
      wrapper.className = 'page-wrapper';
      wrapper.dataset.page = pageNum;
      wrapper.style.width = viewport.width + 'px';
      wrapper.style.height = viewport.height + 'px';

      const canvas = document.createElement('canvas');
      canvas.width = viewport.width * window.devicePixelRatio;
      canvas.height = viewport.height * window.devicePixelRatio;
      canvas.style.width = viewport.width + 'px';
      canvas.style.height = viewport.height + 'px';

      const ctx = canvas.getContext('2d');
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

      wrapper.appendChild(canvas);
      container.appendChild(wrapper);
      pageCanvases.push({ canvas, wrapper, viewport, pageNum });

      await page.render({ canvasContext: ctx, viewport }).promise;
    }

    function showNoPdf() {
      const container = document.getElementById('pdfContainer');
      container.innerHTML = \`
        <div class="no-pdf">
          <div class="icon">📄</div>
          <p>No compiled PDF found.<br><br>
          Add <code style="color: #cba6f7;">\\\\begin{viz}...\\\\end{viz}</code> blocks to your .tex file, compile it, then open the visualiser.</p>
        </div>
      \`;
    }

    // ========== Viz Markers ==========
    function placeVizMarkers() {
      if (!pdfDoc || MARKERS.length === 0) return;

      const totalPages = Math.max(1, pdfDoc?.numPages || pageCanvases.length);
      const visiblePage = pageCanvases[0]?.pageNum;
      const inferred = MARKERS.map((marker, idx) => {
        const declaredPage = Number.isFinite(marker.page) ? Math.max(1, Math.min(totalPages, marker.page)) : null;
        const ratioByIndex = MARKERS.length > 1 ? idx / (MARKERS.length - 1) : 0;
        const pageByIndex = Math.max(1, Math.min(totalPages, Math.floor(ratioByIndex * totalPages) + 1));
        return {
          marker,
          idx,
          page: declaredPage ?? pageByIndex,
        };
      });

      const declaredPageSet = new Set(inferred.map(x => x.page));
      if (declaredPageSet.size === 1 && totalPages > 1) {
        inferred.forEach((entry) => {
          const ratioByIndex = MARKERS.length > 1 ? entry.idx / (MARKERS.length - 1) : 0;
          entry.page = Math.max(1, Math.min(totalPages, Math.floor(ratioByIndex * totalPages) + 1));
        });
      }

      const byPage = new Map();
      inferred.forEach(entry => {
        if (!byPage.has(entry.page)) byPage.set(entry.page, []);
        byPage.get(entry.page).push(entry);
      });

      byPage.forEach(entries => {
        entries.sort((a, b) => (a.marker.block.lineNumber || 0) - (b.marker.block.lineNumber || 0));
      });

      inferred.forEach((entry) => {
        if (visiblePage && entry.page !== visiblePage) { return; }
        const pageInfo = pageCanvases.find(p => p.pageNum === entry.page);
        if (!pageInfo) { return; }

        const pageEntries = byPage.get(entry.page) || [];
        const posOnPage = Math.max(0, pageEntries.findIndex(x => x.idx === entry.idx));
        const rankRatio = (posOnPage + 1) / (pageEntries.length + 1);
        const markerRatio = Math.max(0.04, Math.min(0.96, entry.marker.yRatio));
        const yRatio = pageEntries.length > 1
          ? Math.max(0.08, Math.min(0.92, markerRatio * 0.35 + rankRatio * 0.65))
          : markerRatio;

        const markerEl = document.createElement('div');
        markerEl.className = 'viz-marker';
        markerEl.dataset.index = entry.idx;
        markerEl.style.top = (yRatio * pageInfo.viewport.height) + 'px';

        markerEl.innerHTML = \`
          <div class="viz-marker-line"></div>
          <div class="viz-marker-dot"></div>
        \`;

        // Hover events
        markerEl.addEventListener('mouseenter', (e) => showPopup(entry.idx, e, false));
        markerEl.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          pinnedMarkerIndex = entry.idx;
          showPopup(entry.idx, e, true);
        });
        markerEl.addEventListener('mouseleave', () => {
          // Delay hiding to allow moving to popup
          setTimeout(() => {
            if (!isMouseOverPopup) hidePopup();
          }, 200);
        });

        pageInfo.wrapper.appendChild(markerEl);
      });
    }

    // ========== Popup Logic ==========
    let isMouseOverPopup = false;
    let pinnedMarkerIndex = -1;
    const popup = document.getElementById('vizPopup');
    const popupHeader = popup.querySelector('.viz-popup-header');
    const popupPinBtn = document.getElementById('popupPin');
    const popupResizeHandle = document.getElementById('popupResizeHandle');

    popup.addEventListener('mouseenter', () => { isMouseOverPopup = true; });
    popup.addEventListener('mouseleave', () => {
      isMouseOverPopup = false;
      hidePopup();
    });

    popupHeader.addEventListener('pointerdown', (e) => {
      // Ignore dragging when clicking action buttons.
      if (e.target.closest('.popup-header-actions')) { return; }
      if (pinnedMarkerIndex < 0) { return; }
      e.preventDefault();
      draggingPopup = true;
      popup.classList.add('dragging');
      popupHeader.setPointerCapture(e.pointerId);
      const rect = popup.getBoundingClientRect();
      dragOffsetX = e.clientX - rect.left;
      dragOffsetY = e.clientY - rect.top;
      customPopupRect = {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      };
    });

    popupHeader.addEventListener('pointermove', (e) => {
      if (!draggingPopup) { return; }
      const width = customPopupRect?.width || popup.getBoundingClientRect().width;
      const height = customPopupRect?.height || popup.getBoundingClientRect().height;
      const maxLeft = Math.max(0, window.innerWidth - width - 8);
      const maxTop = Math.max(0, window.innerHeight - height - 8);
      const nextLeft = Math.max(8, Math.min(maxLeft, e.clientX - dragOffsetX));
      const nextTop = Math.max(8, Math.min(maxTop, e.clientY - dragOffsetY));
      popup.style.left = nextLeft + 'px';
      popup.style.top = nextTop + 'px';
      customPopupRect = {
        left: nextLeft,
        top: nextTop,
        width,
        height,
      };
    });

    popupHeader.addEventListener('pointerup', (e) => {
      if (!draggingPopup) { return; }
      draggingPopup = false;
      popup.classList.remove('dragging');
      popupHeader.releasePointerCapture(e.pointerId);
    });

    popupResizeHandle.addEventListener('pointerdown', (e) => {
      if (pinnedMarkerIndex < 0) { return; }
      if (e.button !== 0) { return; }
      e.preventDefault();
      e.stopPropagation();
      resizingPopup = true;
      activeResizePointerId = e.pointerId;
      popup.classList.add('resizing');
      popupResizeHandle.setPointerCapture(e.pointerId);
      const rect = popup.getBoundingClientRect();
      resizeStartX = e.clientX;
      resizeStartY = e.clientY;
      resizeStartW = rect.width;
      resizeStartH = rect.height;
      customPopupRect = {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      };
    });

    popupResizeHandle.addEventListener('pointermove', (e) => {
      if (!resizingPopup) { return; }
      if (activeResizePointerId !== e.pointerId) { return; }
      // If primary button is no longer pressed, end resize to avoid "stuck" mode.
      if ((e.buttons & 1) !== 1) {
        endResize(e.pointerId);
        return;
      }
      const deltaX = e.clientX - resizeStartX;
      const deltaY = e.clientY - resizeStartY;
      const nextWidth = Math.max(POPUP_MIN_W, Math.min(window.innerWidth - 16, resizeStartW + deltaX));
      const nextHeight = Math.max(POPUP_MIN_H, Math.min(window.innerHeight - 16, resizeStartH + deltaY));
      popup.style.width = nextWidth + 'px';
      applyPlotContainerSize(nextWidth, nextHeight);
      schedulePlotResize();
      customPopupRect = {
        left: customPopupRect?.left ?? popup.getBoundingClientRect().left,
        top: customPopupRect?.top ?? popup.getBoundingClientRect().top,
        width: nextWidth,
        height: nextHeight,
      };
    });

    popupResizeHandle.addEventListener('pointerup', (e) => {
      if (!resizingPopup) { return; }
      endResize(e.pointerId);
    });

    popupResizeHandle.addEventListener('pointercancel', (e) => {
      if (!resizingPopup) { return; }
      endResize(e.pointerId);
    });

    popupResizeHandle.addEventListener('lostpointercapture', () => {
      if (!resizingPopup) { return; }
      endResize(activeResizePointerId);
    });

    document.getElementById('popupClose').addEventListener('click', (e) => {
      e.stopPropagation();
      pinnedMarkerIndex = -1;
      customPopupRect = null;
      updatePinUi();
      hidePopup(true);
    });

    popupPinBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (activeMarkerIndex < 0) { return; }
      if (pinnedMarkerIndex === activeMarkerIndex) {
        pinnedMarkerIndex = -1;
        customPopupRect = null;
      } else {
        pinnedMarkerIndex = activeMarkerIndex;
      }
      updatePinUi();
    });

    document.getElementById('gotoSource').addEventListener('click', (e) => {
      e.stopPropagation();
      if (activeMarkerIndex >= 0 && MARKERS[activeMarkerIndex]) {
        vscode.postMessage({
          type: 'openTexLine',
          line: MARKERS[activeMarkerIndex].block.lineNumber
        });
      }
    });

    function showPopup(markerIndex, event, force = false) {
      if (!force && pinnedMarkerIndex >= 0 && pinnedMarkerIndex !== markerIndex) {
        return;
      }
      if (!force && activeMarkerIndex === markerIndex && popupVisible) return;
      activeMarkerIndex = markerIndex;

      const marker = MARKERS[markerIndex];
      const plotIndex = marker?.block?.index ?? markerIndex;
      const plot = PLOTS[plotIndex] || {
        type: 'scatter',
        label: 'Missing plot data',
        equation: '',
        data: [],
        layout: {},
      };

      // Update popup content
      const label = marker?.block?.label || plot.label || ('viz @ line ' + (marker?.block?.lineNumber ?? '?'));
      document.getElementById('popupEquation').textContent = 'Preview: ' + label;
      document.getElementById('vizTypeBadge').textContent = marker?.block?.vizType || plot.type;

      // Deactivate other markers
      document.querySelectorAll('.viz-marker').forEach(el => el.classList.remove('active'));
      const activeEl = document.querySelector(\`.viz-marker[data-index="\${markerIndex}"]\`);
      if (activeEl) activeEl.classList.add('active');

      // Position popup near the marker
      const markerEl = event.currentTarget || event.target.closest('.viz-marker');
      const rect = markerEl.getBoundingClientRect();
      const popupW = customPopupRect?.width || CONFIG.popupWidth;
      const popupH = customPopupRect?.height || (CONFIG.popupHeight + 80); // header + footer

      let left = customPopupRect?.left ?? (rect.right + 20);
      let top = customPopupRect?.top ?? (rect.top - popupH / 2);

      // Keep popup within viewport
      if (left + popupW > window.innerWidth) {
        left = rect.left - popupW - 20;
      }
      if (top < 10) top = 10;
      if (top + popupH > window.innerHeight - 10) {
        top = window.innerHeight - popupH - 10;
      }

      popup.style.left = left + 'px';
      popup.style.top = top + 'px';
      popup.style.width = popupW + 'px';

      // Keep plot area in sync with popup size.
      applyPlotContainerSize(popupW, popupH);

      // Show popup
      popup.classList.add('visible');
      popupVisible = true;
      updatePinUi();

      if (templateRenderTimer) {
        clearTimeout(templateRenderTimer);
        templateRenderTimer = null;
      }

      // Hover is lightweight; click/pin does the heavier real Plotly render.
      if (!force && pinnedMarkerIndex !== markerIndex) {
        renderLightweightPlaceholder(marker, plot);
        return;
      }

      templateRenderTimer = setTimeout(() => {
        try {
          renderPlot(plot);
        } catch (err) {
          console.error('renderPlot crash, falling back to template:', err);
          renderPopupMessage(marker, plot);
        }
      }, 120);
    }

    function hidePopup(force = false) {
      if (!force && pinnedMarkerIndex >= 0) {
        return;
      }
      if (templateRenderTimer) {
        clearTimeout(templateRenderTimer);
        templateRenderTimer = null;
      }
      popup.classList.remove('visible');
      popupVisible = false;
      activeMarkerIndex = -1;
      document.querySelectorAll('.viz-marker').forEach(el => el.classList.remove('active'));
    }

    function renderLightweightPlaceholder(marker, plot) {
      const container = document.getElementById('plotContainer');
      const popupWidth = Number(CONFIG.popupWidth) || 450;
      const popupHeight = Number(CONFIG.popupHeight) || 360;
      applyPlotContainerSize(popupWidth, popupHeight);

      const type = marker?.block?.vizType || plot?.type || 'unknown';
      container.innerHTML =
        '<div style="height:100%;display:flex;align-items:center;justify-content:center;background:#161622;border:1px solid #313244;border-radius:8px;color:#a6adc8;font-size:12px;text-align:center;padding:12px;">' +
        'Hover preview (' + type + ')<br/>Click equation or 📌 to load graph.' +
        '</div>';
    }

    function updatePinUi() {
      if (!popupPinBtn) { return; }
      const isPinned = pinnedMarkerIndex >= 0;
      popupPinBtn.classList.toggle('pinned', isPinned);
      popupPinBtn.title = isPinned ? 'Unpin popup' : 'Pin popup';
    }

    function endResize(pointerId) {
      resizingPopup = false;
      popup.classList.remove('resizing');
      if (pointerId !== null && pointerId !== undefined) {
        try {
          popupResizeHandle.releasePointerCapture(pointerId);
        } catch {
          // Ignore if capture was already released.
        }
      }
      activeResizePointerId = null;
      resizeActivePlot();
    }

    function schedulePlotResize() {
      if (resizeRafPending) { return; }
      resizeRafPending = true;
      requestAnimationFrame(() => {
        resizeRafPending = false;
        resizeActivePlot();
      });
    }

    function renderPopupMessage(marker, plot) {
      const container = document.getElementById('plotContainer');
      const popupWidth = Number(CONFIG.popupWidth) || 450;
      const popupHeight = Number(CONFIG.popupHeight) || 360;
      applyPlotContainerSize(popupWidth, popupHeight);
      container.style.minHeight = Math.max(120, popupHeight - 88) + 'px';
      container.style.background = '#161622';
      container.style.border = '1px solid #313244';
      container.style.borderRadius = '8px';

      container.innerHTML =
        '<div style="height:100%;display:flex;align-items:center;justify-content:center;color:#a6adc8;font-size:12px;text-align:center;padding:12px;">' +
        'Loading graph template…' +
        '</div>';

      const label = marker?.block?.label || plot?.label || 'Unnamed viz block';
      const line = marker?.block?.lineNumber ?? '?';
      const type = marker?.block?.vizType || plot?.type || 'unknown';

      const layout = {
        title: {
          text: 'Template: ' + label,
          font: { size: 12, color: '#bac2de' },
        },
        annotations: [{
          text: 'Type: ' + type + ' | Line: ' + line,
          xref: 'paper',
          yref: 'paper',
          x: 0.5,
          y: 0.5,
          showarrow: false,
          font: { size: 12, color: '#7f849c' },
        }],
        xaxis: {
          title: 'x',
          range: [-10, 10],
          showline: true,
          showgrid: true,
          gridcolor: '#313244',
          zerolinecolor: '#45475a',
        },
        yaxis: {
          title: 'y',
          range: [-10, 10],
          showline: true,
          showgrid: true,
          gridcolor: '#313244',
          zerolinecolor: '#45475a',
        },
        margin: { l: 40, r: 20, t: 40, b: 40 },
        font: { color: '#cdd6f4', size: 10 },
        paper_bgcolor: '#1e1e2e',
        plot_bgcolor: '#1e1e2e',
      };

      // Hidden template trace ensures axes are rendered consistently across Plotly versions.
      const templateTrace = [{
        type: 'scatter',
        mode: 'lines',
        x: [-10, 10],
        y: [0, 0],
        line: { color: 'rgba(0,0,0,0)', width: 1 },
        hoverinfo: 'skip',
        showlegend: false,
      }];

      try {
        if (typeof Plotly === 'undefined' || typeof Plotly.newPlot !== 'function') {
          container.innerHTML =
            '<div style="height:100%;display:flex;align-items:center;justify-content:center;background:#161622;border:1px solid #313244;border-radius:8px;color:#f9e2af;font-size:12px;text-align:center;padding:12px;">' +
            'Plotly did not load in webview.<br/>Check network/CSP and reload panel.' +
            '</div>';
          return;
        }

        requestAnimationFrame(() => {
          Plotly.newPlot(container, templateTrace, layout, {
            responsive: true,
            displayModeBar: true,
            displaylogo: false,
            modeBarButtonsToRemove: ['toImage', 'sendDataToCloud'],
          }).catch(err => {
            console.error('Template Plotly promise rejected:', err);
            container.innerHTML =
              '<div style="height:100%;display:flex;align-items:center;justify-content:center;background:#161622;border:1px solid #313244;border-radius:8px;color:#f38ba8;font-size:12px;text-align:center;padding:12px;">' +
              'Template graph failed (async).<br/>Open webview devtools for details.' +
              '</div>';
          });
        });
      } catch (err) {
        console.error('Template Plotly render failed:', err);
        container.innerHTML =
          '<div style="height:100%;display:flex;align-items:center;justify-content:center;background:#161622;border:1px solid #313244;border-radius:8px;color:#f38ba8;font-size:12px;text-align:center;padding:12px;">' +
          'Template graph failed to render.<br/>Open webview devtools for details.' +
          '</div>';
      }
    }

    // ========== Plot Rendering ==========
    function evaluateExpression(expr, vars) {
      try {
        const fn = new Function(...Object.keys(vars), \`return \${expr};\`);
        const result = fn(...Object.values(vars));
        return isFinite(result) ? result : null;
      } catch {
        return null;
      }
    }

    function renderPlot(plotData) {
      const container = document.getElementById('plotContainer');
      const popupRect = popup.getBoundingClientRect();
      const plotW = popupRect.width > 0 ? popupRect.width : Number(CONFIG.popupWidth) || 450;
      const plotH = popupRect.height > 0 ? popupRect.height : (Number(CONFIG.popupHeight) || 360) + 80;
      applyPlotContainerSize(plotW, plotH);
      container.innerHTML = '';

      const traces = plotData.data.map(trace => {
        const processed = { ...trace };

        if (trace._expression) {
          if (trace.type === 'surface' || trace.type === 'contour') {
            const res = trace._resolution || 50;
            const xRange = trace._xRange || [-3, 3];
            const yRange = trace._yRange || [-3, 3];
            const xStep = (xRange[1] - xRange[0]) / res;
            const yStep = (yRange[1] - yRange[0]) / res;

            const xVals = [];
            const yVals = [];
            const zVals = [];

            for (let i = 0; i <= res; i++) {
              const y = yRange[0] + i * yStep;
              yVals.push(y);
              const row = [];
              for (let j = 0; j <= res; j++) {
                const x = xRange[0] + j * xStep;
                if (i === 0) xVals.push(x);
                const z = evaluateExpression(trace._expression, { x, y });
                row.push(z);
              }
              zVals.push(row);
            }

            processed.x = xVals;
            processed.y = yVals;
            processed.z = zVals;
          } else if (trace._parametric) {
            // Parametric curve
            const res = trace._resolution || 200;
            const tRange = trace._tRange || [0, 2 * Math.PI];
            const tStep = (tRange[1] - tRange[0]) / res;
            const xVals = [];
            const yVals = [];

            for (let i = 0; i <= res; i++) {
              const t = tRange[0] + i * tStep;
              const x = evaluateExpression(trace._expression.split(';')[0] || 'Math.cos(t)', { t });
              const y = evaluateExpression(trace._expression.split(';')[1] || 'Math.sin(t)', { t });
              if (x !== null && y !== null) {
                xVals.push(x);
                yVals.push(y);
              }
            }

            processed.x = xVals;
            processed.y = yVals;
          } else {
            // 2D curve y = f(x)
            const res = trace._resolution || 200;
            const xRange = trace._xRange || [-5, 5];
            const xStep = (xRange[1] - xRange[0]) / res;
            const xVals = [];
            const yVals = [];

            for (let i = 0; i <= res; i++) {
              const x = xRange[0] + i * xStep;
              const y = evaluateExpression(trace._expression, { x });
              xVals.push(x);
              yVals.push(y);
            }

            processed.x = xVals;
            processed.y = yVals;
          }
        }

        // Clean up internal properties
        delete processed._expression;
        delete processed._xRange;
        delete processed._yRange;
        delete processed._tRange;
        delete processed._resolution;
        delete processed._parametric;

        return processed;
      });

      const layout = {
        ...plotData.layout,
        font: { color: '#cdd6f4', size: 10 },
        paper_bgcolor: '#1e1e2e',
        plot_bgcolor: '#1e1e2e',
        modebar: { bgcolor: 'transparent', color: '#6c7086', activecolor: '#6366f1' },
      };

      if (layout.scene) {
        layout.scene.bgcolor = '#1e1e2e';
        layout.scene.xaxis = { ...layout.scene.xaxis, gridcolor: '#313244', zerolinecolor: '#45475a' };
        layout.scene.yaxis = { ...layout.scene.yaxis, gridcolor: '#313244', zerolinecolor: '#45475a' };
        layout.scene.zaxis = { ...layout.scene.zaxis, gridcolor: '#313244', zerolinecolor: '#45475a' };
      }

      if (layout.xaxis) {
        layout.xaxis = { ...layout.xaxis, gridcolor: '#313244', zerolinecolor: '#45475a' };
      }
      if (layout.yaxis) {
        layout.yaxis = { ...layout.yaxis, gridcolor: '#313244', zerolinecolor: '#45475a' };
      }

      try {
        const hasDrawableData = traces.some(t => {
          if (Array.isArray(t.z)) {
            return t.z.some(row => Array.isArray(row) && row.some(v => typeof v === 'number' && isFinite(v)));
          }
          if (Array.isArray(t.y)) {
            return t.y.some(v => typeof v === 'number' && isFinite(v));
          }
          return false;
        });

        if (!hasDrawableData) {
          container.innerHTML =
            '<div style="height:100%;display:flex;align-items:center;justify-content:center;background:#161622;border:1px solid #313244;border-radius:8px;color:#a6adc8;font-size:12px;line-height:1.6;text-align:center;padding:14px;">' +
            'No drawable data for this equation.<br/>Check expression parsing or ranges.' +
            '</div>';
          return;
        }

        Plotly.newPlot(container, traces, layout, {
          responsive: true,
          displayModeBar: true,
          displaylogo: false,
          modeBarButtonsToRemove: ['toImage', 'sendDataToCloud'],
        });
      } catch (err) {
        console.error('Plotly render failed:', err, { plotData, traces, layout });
        container.innerHTML =
          '<div style="height:100%;display:flex;align-items:center;justify-content:center;background:#161622;border:1px solid #313244;border-radius:8px;color:#f38ba8;font-size:12px;line-height:1.6;text-align:center;padding:14px;">' +
          'Plot render failed.<br/>Open Developer Tools console for details.' +
          '</div>';
      }
    }

    function applyPlotContainerSize(popupWidth, popupHeight) {
      const container = document.getElementById('plotContainer');
      const plotWidth = Math.max(220, Number(popupWidth) - 16);
      const plotHeight = Math.max(160, Number(popupHeight) - 88);
      container.style.width = plotWidth + 'px';
      container.style.height = plotHeight + 'px';
    }

    function resizeActivePlot() {
      const container = document.getElementById('plotContainer');
      if (typeof Plotly === 'undefined' || !Plotly.Plots || !Plotly.Plots.resize) {
        return;
      }
      // Only attempt resize when a Plotly graph is mounted in this container.
      if (!container || !container.classList.contains('js-plotly-plot')) {
        return;
      }
      try {
        Plotly.Plots.resize(container);
      } catch (err) {
        console.warn('Plot resize failed:', err);
      }
    }

    // ========== Badge ==========
    function updateBadge() {
      const badge = document.getElementById('vizCount');
      const count = PLOTS.length;
      badge.textContent = count + ' viz block' + (count !== 1 ? 's' : '');
      badge.className = 'badge' + (count > 0 ? ' active' : '');
    }

    function updateZoomLabel() {
      const label = document.getElementById('zoomLabel');
      if (label) {
        label.textContent = Math.round(zoomLevel * 100) + '%';
      }
    }

    function updatePageLabel() {
      const label = document.getElementById('pageLabel');
      const prev = document.getElementById('pagePrev');
      const next = document.getElementById('pageNext');
      const total = Math.max(1, pdfDoc?.numPages || 1);
      currentPage = Math.max(1, Math.min(currentPage, total));
      if (label) {
        label.textContent = currentPage + '/' + total;
      }
      if (prev) {
        prev.disabled = currentPage <= 1;
      }
      if (next) {
        next.disabled = currentPage >= total;
      }
    }

    async function changePage(delta) {
      if (!pdfDoc) { return; }
      const nextPage = Math.max(1, Math.min(currentPage + delta, pdfDoc.numPages || 1));
      if (nextPage === currentPage) { return; }
      currentPage = nextPage;
      updatePageLabel();
      await renderAllPages();
      placeVizMarkers();
      hidePopup();
    }

    async function applyZoom(delta) {
      if (!pdfDoc) { return; }
      const next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoomLevel + delta));
      if (Math.abs(next - zoomLevel) < 0.0001) { return; }
      zoomLevel = next;
      updateZoomLabel();
      await renderAllPages();
      placeVizMarkers();
    }

    // ========== Message Handler ==========
    window.addEventListener('message', event => {
      const msg = event.data;

      switch (msg.type) {
        case 'updateViz':
          PLOTS = msg.plots;
          MARKERS = msg.markers;
          // Remove old markers
          document.querySelectorAll('.viz-marker').forEach(el => el.remove());
          placeVizMarkers();
          updateBadge();
          break;

        case 'updatePdf':
          currentPage = 1;
          initPdf(msg.pdfBase64);
          break;
      }
    });

    // ========== Init ==========
    document.addEventListener('DOMContentLoaded', () => {
      updateZoomLabel();
      updatePageLabel();
      document.getElementById('pagePrev').addEventListener('click', () => changePage(-1));
      document.getElementById('pageNext').addEventListener('click', () => changePage(1));
      document.getElementById('zoomOut').addEventListener('click', () => applyZoom(-ZOOM_STEP));
      document.getElementById('zoomIn').addEventListener('click', () => applyZoom(ZOOM_STEP));
      initPdf(PDF_BASE64);
      vscode.postMessage({ type: 'ready' });
    });

    // Also fire init if DOMContentLoaded already happened
    if (document.readyState !== 'loading') {
      updateZoomLabel();
      updatePageLabel();
      document.getElementById('pagePrev').addEventListener('click', () => changePage(-1));
      document.getElementById('pageNext').addEventListener('click', () => changePage(1));
      document.getElementById('zoomOut').addEventListener('click', () => applyZoom(-ZOOM_STEP));
      document.getElementById('zoomIn').addEventListener('click', () => applyZoom(ZOOM_STEP));
      initPdf(PDF_BASE64);
      vscode.postMessage({ type: 'ready' });
    }
  </script>
</body>
</html>`;
}

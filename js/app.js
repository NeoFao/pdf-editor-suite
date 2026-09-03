/**
 * PDF Editor - Controlador Principal Todo-en-Uno (Adobe Acrobat Style)
 * Orquestador central del espacio de trabajo unificado, visor continuo, ribbon y exportación.
 */

// Configuración del worker de PDF.js v3+ (local y same-origin)
if (window.pdfjsLib) {
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'js/pdf.worker.min.js';
}

class UnifiedAcrobatApp {
  constructor() {
    this.renderScale = 1.4; // Alta nitidez visual
    this.renderedPages = new Map(); // pageNum -> { canvas, overlayCanvas, ctx, overlayCtx }
    window.unifiedApp = this;
  }

  init() {
    this.setupFileHandling();
    this.setupTopBar();
    this.setupRibbon();
    this.setupPropertiesPanel();
    this.setupPanelsToggle();
    this.setupKeyboardShortcuts();
    this.setupSignatureModal();
    this.setupOcrModal();
    this.setupMarkdownModal();

    // Reaccionar a cambios de zoom global
    window.docState.on('zoomChanged', (zoom) => {
      this.applyZoom(zoom);
    });

    console.log('PDF Editor Todo-en-Uno (Acrobat Style) listo en memoria.');
  }

  /* ==================== 1. CARGA Y GESTIÓN DE ARCHIVOS ==================== */

  setupFileHandling() {
    const mainFileInput = document.getElementById('main-file-input');
    const welcomeDropzone = document.getElementById('welcome-dropzone');
    const openPdfBtn = document.getElementById('btn-welcome-open-pdf');
    const openWordBtn = document.getElementById('btn-welcome-open-word');
    const openImgsBtn = document.getElementById('btn-welcome-open-imgs');

    // Botones de bienvenida
    openPdfBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      mainFileInput.accept = 'application/pdf';
      mainFileInput.click();
    });

    openWordBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      mainFileInput.accept = '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      mainFileInput.click();
    });

    openImgsBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      mainFileInput.accept = 'image/*';
      mainFileInput.click();
    });

    welcomeDropzone?.addEventListener('click', () => {
      mainFileInput.accept = 'application/pdf,.docx,image/*';
      mainFileInput.click();
    });

    mainFileInput?.addEventListener('change', async (e) => {
      if (e.target.files && e.target.files[0]) {
        await this.handleFile(e.target.files[0]);
        mainFileInput.value = '';
      }
    });

    // Drag & Drop global sobre la ventana
    ['dragenter', 'dragover'].forEach(ev => {
      window.addEventListener(ev, (e) => {
        e.preventDefault();
        welcomeDropzone?.classList.add('dragover');
      });
    });

    ['dragleave', 'drop'].forEach(ev => {
      window.addEventListener(ev, (e) => {
        e.preventDefault();
        welcomeDropzone?.classList.remove('dragover');
      });
    });

    window.addEventListener('drop', async (e) => {
      e.preventDefault();
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        await this.handleFile(e.dataTransfer.files[0]);
      }
    });

    // Menú Archivo en la barra superior
    document.getElementById('menu-open-file')?.addEventListener('click', () => {
      mainFileInput.accept = 'application/pdf,.docx,image/*';
      mainFileInput.click();
      this.closeFileDropdown();
    });

    document.getElementById('menu-new-blank')?.addEventListener('click', () => {
      this.createBlankPDF();
      this.closeFileDropdown();
    });

    document.getElementById('menu-close-file')?.addEventListener('click', () => {
      this.closeCurrentDocument();
      this.closeFileDropdown();
    });

    document.getElementById('menu-print')?.addEventListener('click', () => {
      window.print();
      this.closeFileDropdown();
    });
  }

  async handleFile(file) {
    if (!file) return;

    // Validación del lado del cliente: Tamaño máximo para prevenir saturación de memoria RAM
    const MAX_FILE_SIZE = 150 * 1024 * 1024; // 150 MB límite seguro
    if (file.size > MAX_FILE_SIZE) {
      window.showToast('El archivo seleccionado supera el límite de seguridad (150 MB).', 'warning');
      return;
    }

    const fileName = file.name.toLowerCase();

    if (fileName.endsWith('.docx')) {
      await this.importWordDocx(file);
    } else if (file.type.startsWith('image/')) {
      await this.importImageAsPDF(file);
    } else if (fileName.endsWith('.pdf') || file.type === 'application/pdf') {
      const buffer = await file.arrayBuffer();
      await this.loadPDFBuffer(buffer, file.name, file.size);
    } else {
      window.showToast('Formato no compatible. Selecciona un PDF, Word (.docx) o imagen.', 'warning');
    }
  }

  async loadPDFBuffer(buffer, name, size) {
    window.showLoading(true, 'Cargando y procesando documento en memoria RAM...');
    try {
      const state = window.docState;
      state.buffer = buffer;
      state.name = name || 'Documento.pdf';
      state.size = size || buffer.byteLength;

      // Cargar en pdf-lib con copia de buffer independiente
      const libBuffer = buffer.slice(0);
      state.pdfLibDoc = await PDFLib.PDFDocument.load(libBuffer, { ignoreEncryption: true });

      // Cargar en pdfjsLib con soporte completo de cMaps y fuentes estándar
      const jsBuffer = new Uint8Array(buffer.slice(0));
      const loadingTask = pdfjsLib.getDocument({
        data: jsBuffer,
        cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/cmaps/',
        cMapPacked: true,
        standardFontDataUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/standard_fonts/',
        enableXfa: true
      });
      state.pdfJsDoc = await loadingTask.promise;
      state.totalPages = state.pdfJsDoc.numPages;
      state.currentPage = 1;
      state.hasDocument = true;

      // Ocultar bienvenida y mostrar escenario del documento
      document.getElementById('welcome-screen')?.classList.add('hidden');
      document.getElementById('pdf-render-stage')?.classList.remove('hidden');
      document.getElementById('doc-title-container')?.classList.remove('hidden');

      // Actualizar encabezado e información
      document.getElementById('doc-title-text').textContent = state.name;
      document.getElementById('doc-title-text').title = state.name;
      document.getElementById('label-total-pages').textContent = state.totalPages;
      document.getElementById('input-page-num').value = 1;
      document.getElementById('input-page-num').max = state.totalPages;
      document.getElementById('info-total-pages').textContent = state.totalPages;
      document.getElementById('info-file-size').textContent = this.formatBytes(state.size);

      // Renderizar páginas continuas y miniaturas laterales
      await this.renderDocumentPages();
      await this.generateThumbnails();

      // Actualizar contador en botón móvil de miniaturas
      const mobileBadge = document.getElementById('mobile-thumb-badge');
      if (mobileBadge) mobileBadge.textContent = state.totalPages;

      // En móviles, ajustar automáticamente el zoom al ancho del dispositivo
      if (window.innerWidth < 768) {
        setTimeout(() => this.fitToWidth(), 150);
      }

      window.showToast(`Documento cargado: ${state.name} (${state.totalPages} págs.)`, 'success');
    } catch (err) {
      console.error('Error al cargar PDF:', err);
      window.showToast('Error al abrir el PDF. Comprueba que el archivo sea válido.', 'error');
    } finally {
      window.showLoading(false);
    }
  }

  async createBlankPDF() {
    window.showLoading(true, 'Creando nuevo PDF en blanco...');
    try {
      const newPdf = await PDFLib.PDFDocument.create();
      newPdf.addPage([595.28, 841.89]); // A4
      const bytes = await newPdf.save();
      await this.loadPDFBuffer(bytes.buffer, 'Documento_Nuevo.pdf', bytes.byteLength);
    } catch (err) {
      window.showToast('Error al crear PDF en blanco.', 'error');
    } finally {
      window.showLoading(false);
    }
  }

  closeCurrentDocument() {
    window.docState.hasDocument = false;
    window.docState.buffer = null;
    window.docState.pdfLibDoc = null;
    window.docState.pdfJsDoc = null;
    window.docState.pages = [];
    window.docState.annotations = {};

    document.getElementById('welcome-screen')?.classList.remove('hidden');
    document.getElementById('pdf-render-stage')?.classList.add('hidden');
    document.getElementById('doc-title-container')?.classList.add('hidden');
    document.getElementById('pdf-render-stage').innerHTML = '';
    document.getElementById('thumbnail-list').innerHTML = '';
    document.getElementById('thumb-count-badge').textContent = '0';

    window.showToast('Documento cerrado.', 'info');
  }

  /* ==================== 2. VISOR CENTRAL Y RENDERIZADO ==================== */

  async renderDocumentPages() {
    const stage = document.getElementById('pdf-render-stage');
    if (!stage) return;
    stage.innerHTML = '';
    this.renderedPages.clear();

    const state = window.docState;

    for (let pageNum = 1; pageNum <= state.totalPages; pageNum++) {
      state.initPageAnnotations(pageNum);

      const page = await state.pdfJsDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale: this.renderScale });

      // Contenedor visual de página
      const pageWrapper = document.createElement('div');
      pageWrapper.className = 'acrobat-page-wrapper';
      pageWrapper.id = `acrobat-page-${pageNum}`;
      pageWrapper.setAttribute('data-page', pageNum);

      const cssWidth = Math.floor(viewport.width / this.renderScale);
      const cssHeight = Math.floor(viewport.height / this.renderScale);
      const canvasWidth = Math.floor(viewport.width);
      const canvasHeight = Math.floor(viewport.height);

      pageWrapper.style.width = `${cssWidth}px`;
      pageWrapper.style.height = `${cssHeight}px`;

      // Canvas de fondo del PDF
      const pdfCanvas = document.createElement('canvas');
      pdfCanvas.className = 'acrobat-page-canvas';
      pdfCanvas.width = canvasWidth;
      pdfCanvas.height = canvasHeight;
      pdfCanvas.style.width = `${cssWidth}px`;
      pdfCanvas.style.height = `${cssHeight}px`;
      const pdfCtx = pdfCanvas.getContext('2d', { alpha: false });
      pdfCtx.fillStyle = '#ffffff';
      pdfCtx.fillRect(0, 0, canvasWidth, canvasHeight);

      // Renderizar página del PDF
      await page.render({ canvasContext: pdfCtx, viewport: viewport }).promise;

      // Capa de texto interactiva extraída directamente del PDF para edición in-place estilo Acrobat
      const textLayer = document.createElement('div');
      textLayer.className = 'acrobat-text-layer';
      textLayer.id = `acrobat-text-layer-${pageNum}`;
      textLayer.style.width = `${cssWidth}px`;
      textLayer.style.height = `${cssHeight}px`;

      try {
        const textContent = await page.getTextContent();
        this.buildInteractiveTextLayer(textLayer, textContent, viewport, pageNum);
      } catch (textErr) {
        console.warn(`No se pudo extraer capa de texto en pág ${pageNum}:`, textErr);
      }

      // Canvas superior interactivo (anotaciones, trazos y firmas)
      const overlayCanvas = document.createElement('canvas');
      overlayCanvas.className = 'acrobat-overlay-canvas';
      overlayCanvas.width = canvasWidth;
      overlayCanvas.height = canvasHeight;
      overlayCanvas.style.width = `${cssWidth}px`;
      overlayCanvas.style.height = `${cssHeight}px`;
      overlayCanvas.style.background = 'transparent';
      const overlayCtx = overlayCanvas.getContext('2d');

      pageWrapper.appendChild(pdfCanvas);
      pageWrapper.appendChild(overlayCanvas);
      pageWrapper.appendChild(textLayer);
      stage.appendChild(pageWrapper);

      this.renderedPages.set(pageNum, {
        wrapper: pageWrapper,
        pdfCanvas,
        overlayCanvas,
        pdfCtx,
        overlayCtx,
        cssWidth,
        cssHeight,
        viewport
      });

      // Conectar listeners de dibujo interactivo
      this.attachDrawingToOverlay(overlayCanvas, pageNum);

      // Redibujar anotaciones existentes si las hay
      this.redrawPageAnnotations(pageNum);
      this.renderStampsOnPage(pageNum);
    }

    this.applyZoom(state.zoom);
  }

  attachDrawingToOverlay(canvas, pageNum) {
    const ctx = canvas.getContext('2d');
    let isDrawing = false;
    let path = [];

    const getCoords = (e) => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY
      };
    };

    canvas.onpointerdown = (e) => {
      const tool = window.docState.activeTool;
      if (tool === 'pencil' || tool === 'highlighter' || tool === 'rect' || tool === 'eraser') {
        isDrawing = true;
        const coords = getCoords(e);
        path = [coords];
        canvas.setPointerCapture(e.pointerId);

        if (tool === 'eraser') {
          // Trazo inicial del borrador
          ctx.beginPath();
          ctx.arc(coords.x, coords.y, 14 * this.renderScale, 0, Math.PI * 2);
          ctx.fillStyle = '#ffffff';
          ctx.fill();
        }
      } else if (tool === 'text') {
        // 1. Comprobar si el clic cayó sobre o dentro de un bloque de texto existente
        const elementsUnderCursor = document.elementsFromPoint(e.clientX, e.clientY);
        const textBlockEl = elementsUnderCursor.find(el => el.classList?.contains('acrobat-text-block') || el.closest?.('.acrobat-text-block'));
        if (textBlockEl) {
          const actualBlock = textBlockEl.classList?.contains('acrobat-text-block') ? textBlockEl : textBlockEl.closest('.acrobat-text-block');
          const content = actualBlock.querySelector('.text-block-content');
          if (content) {
            this.activateLiveTextEditing(actualBlock, content);
            return;
          }
        }

        // 2. Comprobar proximidad a bloques de texto de esta página (tolerancia inteligente de 14px)
        const pageObj = this.renderedPages.get(pageNum);
        if (pageObj && pageObj.wrapper) {
          const pageBlocks = pageObj.wrapper.querySelectorAll('.acrobat-text-block');
          for (const b of pageBlocks) {
            const bRect = b.getBoundingClientRect();
            if (e.clientX >= bRect.left - 12 && e.clientX <= bRect.right + 12 &&
                e.clientY >= bRect.top - 8 && e.clientY <= bRect.bottom + 8) {
              const content = b.querySelector('.text-block-content');
              if (content) {
                this.activateLiveTextEditing(b, content);
                return;
              }
            }
          }
        }

        // 3. Solo si no hay texto existente en esa zona, crear cuadro de texto libre
        const rect = canvas.getBoundingClientRect();
        const cssCoords = {
          x: e.clientX - rect.left,
          y: e.clientY - rect.top
        };
        this.insertInlineTextBox(pageNum, cssCoords);
      }
    };

    canvas.onpointermove = (e) => {
      if (!isDrawing) return;
      const tool = window.docState.activeTool;
      const coords = getCoords(e);
      path.push(coords);

      if (tool === 'pencil' || tool === 'highlighter') {
        ctx.beginPath();
        const prev = path[path.length - 2];
        ctx.moveTo(prev.x, prev.y);
        ctx.lineTo(coords.x, coords.y);

        if (tool === 'highlighter') {
          ctx.strokeStyle = window.docState.properties.highlighterColor || '#facc15';
          ctx.globalAlpha = 0.35;
          ctx.lineWidth = window.docState.properties.highlighterWidth * this.renderScale;
          ctx.lineCap = 'square';
        } else {
          ctx.strokeStyle = window.docState.properties.color;
          ctx.globalAlpha = window.docState.properties.opacity;
          ctx.lineWidth = window.docState.properties.lineWidth * this.renderScale;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
        }
        ctx.stroke();
      } else if (tool === 'eraser') {
        // Borrador físico (Tipp-Ex) que borra trazos o contenido impreso del documento
        ctx.beginPath();
        const prev = path[path.length - 2];
        ctx.moveTo(prev.x, prev.y);
        ctx.lineTo(coords.x, coords.y);
        ctx.strokeStyle = '#ffffff';
        ctx.globalAlpha = 1.0;
        ctx.lineWidth = 26 * this.renderScale;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();
      }
    };

    canvas.onpointerup = (e) => {
      if (!isDrawing) return;
      isDrawing = false;
      try { canvas.releasePointerCapture(e.pointerId); } catch(err){}

      const tool = window.docState.activeTool;
      const pageAnn = window.docState.initPageAnnotations(pageNum);

      if (tool === 'pencil' || tool === 'highlighter') {
        if (path.length > 1) {
          const stroke = {
            tool: tool,
            points: [...path],
            color: tool === 'highlighter' ? (window.docState.properties.highlighterColor || '#facc15') : window.docState.properties.color,
            lineWidth: tool === 'highlighter' ? window.docState.properties.highlighterWidth * this.renderScale : window.docState.properties.lineWidth * this.renderScale,
            alpha: tool === 'highlighter' ? 0.35 : window.docState.properties.opacity
          };
          pageAnn.strokes.push(stroke);
          window.docState.pushUndo({ type: 'stroke', pageNum, stroke });
        }
      } else if (tool === 'eraser') {
        if (path.length > 0) {
          const stroke = {
            tool: 'pencil',
            points: [...path],
            color: '#ffffff',
            lineWidth: 26 * this.renderScale,
            alpha: 1.0
          };
          pageAnn.strokes.push(stroke);
          window.docState.pushUndo({ type: 'stroke', pageNum, stroke });
          window.showToast('Contenido borrado.', 'info');
        }
      } else if (tool === 'rect') {
        if (path.length > 1) {
          const start = path[0];
          const end = path[path.length - 1];
          const stroke = {
            tool: 'rect',
            x: Math.min(start.x, end.x),
            y: Math.min(start.y, end.y),
            width: Math.abs(end.x - start.x),
            height: Math.abs(end.y - start.y),
            color: window.docState.properties.color,
            lineWidth: window.docState.properties.lineWidth * this.renderScale
          };
          pageAnn.strokes.push(stroke);
          window.docState.pushUndo({ type: 'stroke', pageNum, stroke });
        }
      }

      path = [];
      this.redrawPageAnnotations(pageNum);
    };
  }

  /* ==================== 2.1 MOTOR DE TEXTO VIVO (ACROBAT & PDF AGILE STYLE) ==================== */

  groupTextItemsIntoLines(items, viewport, scale) {
    if (!items || items.length === 0) return [];

    const converted = items.filter(it => it.str && it.str.trim() !== '').map((item, originalIndex) => {
      const tx = item.transform[4];
      const ty = item.transform[5];
      const fontHeight = Math.hypot(item.transform[2], item.transform[3]) || 12;
      const [vx, vy] = viewport.convertToViewportPoint(tx, ty);

      const left = Math.max(0, Math.round(vx / scale));
      const top = Math.max(0, Math.round((vy - (fontHeight * viewport.scale)) / scale));
      const width = Math.max(12, Math.round((item.width * viewport.scale) / scale));
      const height = Math.max(14, Math.round((fontHeight * viewport.scale) / scale) + 2);
      const fontSize = Math.max(11, Math.round(fontHeight));

      return {
        originalIndex,
        str: item.str,
        left,
        top,
        width,
        height,
        fontSize,
        fontName: item.fontName || 'Arial, sans-serif'
      };
    });

    converted.sort((a, b) => {
      if (Math.abs(a.top - b.top) > 5) return a.top - b.top;
      return a.left - b.left;
    });

    const lines = [];
    let currentLine = null;

    for (const item of converted) {
      if (!currentLine) {
        currentLine = { ...item, items: [item] };
        continue;
      }

      const isSameRow = Math.abs(item.top - currentLine.top) <= 5;
      const isAdjacent = (item.left - (currentLine.left + currentLine.width)) <= 32;

      if (isSameRow && isAdjacent) {
        const spaceNeeded = (item.left > (currentLine.left + currentLine.width + 2)) && !currentLine.str.endsWith(' ') && !item.str.startsWith(' ');
        currentLine.str += (spaceNeeded ? ' ' : '') + item.str;
        currentLine.width = (item.left + item.width) - currentLine.left;
        currentLine.height = Math.max(currentLine.height, item.height);
        currentLine.fontSize = Math.max(currentLine.fontSize, item.fontSize);
        currentLine.items.push(item);
      } else {
        lines.push(currentLine);
        currentLine = { ...item, items: [item] };
      }
    }

    if (currentLine) lines.push(currentLine);
    return lines;
  }

  buildInteractiveTextLayer(textLayer, textContent, viewport, pageNum) {
    if (!textContent || !textContent.items) return;

    const scale = this.renderScale;
    const lines = this.groupTextItemsIntoLines(textContent.items, viewport, scale);

    lines.forEach((line, idx) => {
      const block = document.createElement('div');
      block.className = 'acrobat-text-block';
      block.id = `block-${pageNum}-${idx}`;
      block.style.left = `${line.left}px`;
      block.style.top = `${line.top}px`;
      block.style.width = `${line.width + 6}px`;
      block.style.minHeight = `${line.height}px`;
      block.style.fontSize = `${line.fontSize}px`;
      block.style.fontFamily = window.docState.properties.fontFamily || 'Arial, sans-serif';

      block.innerHTML = `
        <div class="text-block-toolbar">
          <span class="text-btn-drag" title="Arrastrar para mover texto"><i class="fa-solid fa-arrows-up-down-left-right"></i></span>
          <span class="text-btn-delete" title="Borrar este texto"><i class="fa-solid fa-trash-can"></i></span>
        </div>
        <div class="text-block-content" spellcheck="false">${line.str}</div>
      `;

      this.setupLiveTextBlock(block, line, pageNum);
      textLayer.appendChild(block);
    });
  }

  setupLiveTextBlock(block, meta, pageNum) {
    const contentEl = block.querySelector('.text-block-content');
    const dragBtn = block.querySelector('.text-btn-drag');
    const deleteBtn = block.querySelector('.text-btn-delete');
    let hasBeenMoved = false;

    // Prevenir que eventos pointerdown traspasen al canvas inferior
    block.addEventListener('pointerdown', (e) => {
      const tool = window.docState.activeTool;
      if (tool === 'text' || tool === 'select' || tool === 'eraser') {
        e.stopPropagation();
      }
    });

    contentEl.addEventListener('pointerdown', (e) => {
      const tool = window.docState.activeTool;
      if (tool === 'text' || tool === 'select' || tool === 'eraser') {
        e.stopPropagation();
      }
    });

    // 1. Clic para editar o borrar
    contentEl.addEventListener('click', (e) => {
      const tool = window.docState.activeTool;

      // Si la herramienta es el Borrador, borrar este texto inmediatamente
      if (tool === 'eraser') {
        e.stopPropagation();
        const maskStroke = this.maskOriginalText(pageNum, meta);
        window.docState.pushUndo({
          type: 'delete_text',
          pageNum,
          blockId: block.id,
          blockHtml: block.outerHTML,
          textLayerId: `acrobat-text-layer-${pageNum}`,
          meta,
          maskStroke
        });
        block.remove();
        window.showToast('Texto eliminado del documento.', 'info');
        return;
      }

      if (tool !== 'text' && tool !== 'select') return;

      e.stopPropagation();
      this.activateLiveTextEditing(block, contentEl);
    });

    contentEl.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        contentEl.blur();
      }
    });

    contentEl.addEventListener('blur', () => {
      contentEl.contentEditable = 'false';
      block.classList.remove('editing');

      const currentText = contentEl.innerText.trim();
      const pageAnn = window.docState.initPageAnnotations(pageNum);

      if (currentText !== meta.str) {
        const wasModifiedBefore = block.classList.contains('modified');
        block.classList.add('modified');

        const existingIdx = pageAnn.texts.findIndex(t => t.id === block.id);
        const oldText = existingIdx >= 0 ? pageAnn.texts[existingIdx].text : meta.str;

        const record = {
          id: block.id,
          isReplacement: true,
          originalText: meta.str,
          text: currentText,
          boxX: parseFloat(block.style.left) || meta.left,
          boxY: parseFloat(block.style.top) || meta.top,
          boxW: block.offsetWidth || meta.width,
          boxH: block.offsetHeight || meta.height,
          x: (parseFloat(block.style.left) || meta.left) * this.renderScale,
          y: (parseFloat(block.style.top) || meta.top) * this.renderScale,
          size: meta.fontSize * this.renderScale,
          font: window.docState.properties.fontFamily || 'Arial, sans-serif',
          color: window.docState.properties.textColor || window.docState.properties.color || '#000000'
        };

        if (existingIdx >= 0) {
          pageAnn.texts[existingIdx] = record;
        } else {
          pageAnn.texts.push(record);
        }

        window.docState.pushUndo({
          type: 'edit_text',
          pageNum,
          blockId: block.id,
          oldText: oldText,
          newText: currentText,
          wasModified: wasModifiedBefore
        });

        window.showToast('Texto modificado en la hoja.', 'success');
      }
    });

    // 2. Botón para eliminar texto (tapa con parche blanco en el PDF)
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const maskStroke = this.maskOriginalText(pageNum, meta);
      window.docState.pushUndo({
        type: 'delete_text',
        pageNum,
        blockId: block.id,
        blockHtml: block.outerHTML,
        textLayerId: `acrobat-text-layer-${pageNum}`,
        meta,
        maskStroke
      });
      block.remove();
      window.showToast('Texto eliminado del documento.', 'info');
    });

    // 3. Arrastrar y mover texto libremente por la página (Drag and Drop estilo Acrobat)
    dragBtn.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      e.preventDefault();

      const startMouseX = e.clientX;
      const startMouseY = e.clientY;
      const initialLeft = parseFloat(block.style.left) || meta.left;
      const initialTop = parseFloat(block.style.top) || meta.top;

      // Al iniciar el primer movimiento, tapar el texto original con parche blanco
      if (!hasBeenMoved) {
        this.maskOriginalText(pageNum, meta);
        hasBeenMoved = true;
        block.classList.add('moved');
      }

      const onMouseMove = (moveEv) => {
        const dx = moveEv.clientX - startMouseX;
        const dy = moveEv.clientY - startMouseY;
        block.style.left = `${Math.round(initialLeft + dx)}px`;
        block.style.top = `${Math.round(initialTop + dy)}px`;
      };

      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);

        // Guardar nueva posición
        const pageAnn = window.docState.initPageAnnotations(pageNum);
        const existingIdx = pageAnn.texts.findIndex(t => t.id === block.id);
        const finalLeft = parseFloat(block.style.left);
        const finalTop = parseFloat(block.style.top);

        const record = {
          id: block.id,
          isReplacement: true,
          originalText: meta.str,
          text: contentEl.innerText.trim(),
          boxX: finalLeft,
          boxY: finalTop,
          boxW: block.offsetWidth || meta.width,
          boxH: block.offsetHeight || meta.height,
          x: finalLeft * this.renderScale,
          y: finalTop * this.renderScale,
          size: meta.fontSize * this.renderScale,
          font: window.docState.properties.fontFamily || 'Arial, sans-serif',
          color: window.docState.properties.textColor || window.docState.properties.color || '#000000'
        };

        if (existingIdx >= 0) {
          pageAnn.texts[existingIdx] = record;
        } else {
          pageAnn.texts.push(record);
        }

        window.docState.pushUndo({
          type: 'move_text',
          pageNum,
          blockId: block.id,
          oldLeft: initialLeft,
          oldTop: initialTop,
          newLeft: finalLeft,
          newTop: finalTop
        });

        window.showToast('Texto movido a nueva posición.', 'success');
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  }

  activateLiveTextEditing(block, contentEl) {
    if (!block || !contentEl) return;
    if (contentEl.isContentEditable) return;

    block.classList.add('editing');
    contentEl.contentEditable = 'true';
    contentEl.style.color = window.docState.properties.textColor || window.docState.properties.color || '#0f172a';

    contentEl.focus();
    try {
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(contentEl);
      sel.removeAllRanges();
      sel.addRange(range);
    } catch(err){}
  }

  maskOriginalText(pageNum, meta) {
    const pageAnn = window.docState.initPageAnnotations(pageNum);
    // Añade un rectángulo blanco sólido para tapar el texto original
    const maskStroke = {
      tool: 'rect',
      x: (meta.left - 2) * this.renderScale,
      y: (meta.top - 1) * this.renderScale,
      width: (meta.width + 8) * this.renderScale,
      height: (meta.height + 4) * this.renderScale,
      color: '#ffffff',
      isMask: true,
      fill: true
    };
    pageAnn.strokes.push(maskStroke);
    this.redrawPageAnnotations(pageNum);
    return maskStroke;
  }

  insertInlineTextBox(pageNum, cssCoords, prefilledText = '') {
    const pageObj = this.renderedPages.get(pageNum);
    if (!pageObj) return;

    const wrapper = pageObj.wrapper;
    const box = document.createElement('div');
    box.className = 'interactive-text-box';
    box.id = 'txtbox_' + Math.random().toString(36).substring(2, 9);
    box.style.left = `${Math.max(10, Math.round(cssCoords.x))}px`;
    box.style.top = `${Math.max(10, Math.round(cssCoords.y))}px`;
    box.style.fontFamily = window.docState.properties.fontFamily || 'Arial, sans-serif';
    box.style.fontSize = `${window.docState.properties.fontSize || 16}px`;
    box.style.color = window.docState.properties.textColor || window.docState.properties.color || '#0f172a';

    const defaultText = prefilledText || 'Escribe aquí...';

    box.innerHTML = `
      <div class="text-block-toolbar">
        <span class="text-btn-drag" title="Arrastrar para mover"><i class="fa-solid fa-arrows-up-down-left-right"></i></span>
        <span class="text-btn-delete" title="Eliminar cuadro"><i class="fa-solid fa-trash-can"></i></span>
      </div>
      <div class="interactive-text-content" contenteditable="true" spellcheck="false">${defaultText}</div>
    `;

    const contentEl = box.querySelector('.interactive-text-content');
    const dragBtn = box.querySelector('.text-btn-drag');
    const deleteBtn = box.querySelector('.text-btn-delete');

    // Prevenir fuga de pointerdown al canvas
    box.addEventListener('pointerdown', (e) => e.stopPropagation());

    // Permitir editar en cualquier momento al hacer clic
    contentEl.addEventListener('click', (e) => {
      e.stopPropagation();
      contentEl.contentEditable = 'true';
      box.classList.add('editing');
      contentEl.focus();
    });

    contentEl.addEventListener('blur', () => {
      box.classList.remove('editing');
      const text = contentEl.innerText.trim();
      if (!text || text === 'Escribe aquí...') {
        box.remove();
        const pageAnn = window.docState.initPageAnnotations(pageNum);
        pageAnn.texts = pageAnn.texts.filter(t => t.id !== box.id);
        return;
      }

      const pageAnn = window.docState.initPageAnnotations(pageNum);
      const existingIdx = pageAnn.texts.findIndex(t => t.id === box.id);
      const left = parseFloat(box.style.left) || 0;
      const top = parseFloat(box.style.top) || 0;

      const record = {
        id: box.id,
        isReplacement: false,
        text: text,
        boxX: left,
        boxY: top,
        boxW: box.offsetWidth,
        boxH: box.offsetHeight,
        x: left * this.renderScale,
        y: top * this.renderScale,
        size: (window.docState.properties.fontSize || 16) * this.renderScale,
        font: window.docState.properties.fontFamily || 'Arial, sans-serif',
        color: box.style.color || '#000000'
      };

      if (existingIdx >= 0) {
        pageAnn.texts[existingIdx] = record;
      } else {
        pageAnn.texts.push(record);
        window.docState.pushUndo({
          type: 'add_text',
          pageNum,
          boxId: box.id,
          record
        });
      }
    });

    // Eliminar
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const pageAnn = window.docState.initPageAnnotations(pageNum);
      const rec = pageAnn.texts.find(t => t.id === box.id);
      window.docState.pushUndo({
        type: 'delete_box',
        pageNum,
        boxId: box.id,
        boxHtml: box.outerHTML,
        record: rec
      });
      box.remove();
      pageAnn.texts = pageAnn.texts.filter(t => t.id !== box.id);
      window.showToast('Cuadro de texto eliminado.', 'info');
    });

    // Mover cuadro libremente
    dragBtn.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      e.preventDefault();

      const startMouseX = e.clientX;
      const startMouseY = e.clientY;
      const initialLeft = parseFloat(box.style.left) || 0;
      const initialTop = parseFloat(box.style.top) || 0;

      const onMouseMove = (moveEv) => {
        const dx = moveEv.clientX - startMouseX;
        const dy = moveEv.clientY - startMouseY;
        box.style.left = `${Math.round(initialLeft + dx)}px`;
        box.style.top = `${Math.round(initialTop + dy)}px`;
      };

      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);

        const pageAnn = window.docState.initPageAnnotations(pageNum);
        const existingIdx = pageAnn.texts.findIndex(t => t.id === box.id);
        const finalLeft = parseFloat(box.style.left);
        const finalTop = parseFloat(box.style.top);

        if (existingIdx >= 0) {
          pageAnn.texts[existingIdx].boxX = finalLeft;
          pageAnn.texts[existingIdx].boxY = finalTop;
          pageAnn.texts[existingIdx].x = finalLeft * this.renderScale;
          pageAnn.texts[existingIdx].y = finalTop * this.renderScale;
        }

        window.docState.pushUndo({
          type: 'move_box',
          pageNum,
          boxId: box.id,
          oldLeft: initialLeft,
          oldTop: initialTop,
          newLeft: finalLeft,
          newTop: finalTop
        });
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });

    wrapper.appendChild(box);

    // Foco automático con cursor al instante si es nuevo
    if (!prefilledText) {
      setTimeout(() => {
        box.classList.add('editing');
        contentEl.focus();
        try {
          const sel = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(contentEl);
          sel.removeAllRanges();
          sel.addRange(range);
        } catch(err){}
      }, 20);
    }
  }

  redrawPageAnnotations(pageNum) {
    const pageObj = this.renderedPages.get(pageNum);
    if (!pageObj) return;

    const ctx = pageObj.overlayCtx;
    const canvas = pageObj.overlayCanvas;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const pageAnn = window.docState.initPageAnnotations(pageNum);

    // Dibujar trazos
    pageAnn.strokes.forEach(s => {
      ctx.save();
      if (s.tool === 'pencil' || s.tool === 'highlighter') {
        if (s.points && s.points.length > 1) {
          ctx.beginPath();
          ctx.strokeStyle = s.color;
          ctx.globalAlpha = s.alpha || 1.0;
          ctx.lineWidth = s.lineWidth;
          ctx.lineCap = s.tool === 'highlighter' ? 'square' : 'round';
          ctx.lineJoin = 'round';
          ctx.moveTo(s.points[0].x, s.points[0].y);
          for (let i = 1; i < s.points.length; i++) {
            ctx.lineTo(s.points[i].x, s.points[i].y);
          }
          ctx.stroke();
        }
      } else if (s.tool === 'rect') {
        if (s.fill || s.isMask) {
          ctx.fillStyle = s.color || '#ffffff';
          ctx.fillRect(s.x, s.y, s.width, s.height);
        } else {
          ctx.beginPath();
          ctx.strokeStyle = s.color;
          ctx.lineWidth = s.lineWidth;
          ctx.strokeRect(s.x, s.y, s.width, s.height);
        }
      }
      ctx.restore();
    });

    // Dibujar textos
    pageAnn.texts.forEach(t => {
      ctx.save();
      ctx.font = `${t.size}px ${t.font}`;
      ctx.fillStyle = t.color;
      ctx.textBaseline = 'middle';
      ctx.fillText(t.text, t.x, t.y);
      ctx.restore();
    });
  }

  /* ==================== 3. SELLOS Y FIRMA DIGITAL ==================== */

  renderStampsOnPage(pageNum) {
    const pageObj = this.renderedPages.get(pageNum);
    if (!pageObj) return;

    const wrapper = pageObj.wrapper;
    wrapper.querySelectorAll('.stamp-overlay').forEach(el => el.remove());

    const pageAnn = window.docState.initPageAnnotations(pageNum);
    pageAnn.stamps.forEach(stamp => {
      const el = document.createElement('div');
      el.className = 'stamp-overlay';
      el.id = stamp.id;
      el.style.left = `${stamp.x}px`;
      el.style.top = `${stamp.y}px`;
      el.style.width = `${stamp.width}px`;
      el.style.height = `${stamp.height}px`;

      el.innerHTML = `
        <img src="${stamp.dataUrl}" alt="Firma" />
        <div class="stamp-handle-delete" title="Eliminar"><i class="fa-solid fa-xmark"></i></div>
        <div class="stamp-handle-resize" title="Redimensionar"></div>
      `;

      el.querySelector('.stamp-handle-delete').addEventListener('click', (e) => {
        e.stopPropagation();
        pageAnn.stamps = pageAnn.stamps.filter(s => s.id !== stamp.id);
        el.remove();
        window.showToast('Firma eliminada.', 'info');
      });

      this.makeStampInteractive(el, stamp);
      wrapper.appendChild(el);
    });
  }

  makeStampInteractive(el, stamp) {
    let dragging = false, resizing = false;
    let startX = 0, startY = 0;
    let startLeft = 0, startTop = 0;
    let startW = 0, startH = 0;

    const resizeHandle = el.querySelector('.stamp-handle-resize');

    el.addEventListener('pointerdown', (e) => {
      if (e.target === resizeHandle || e.target.closest('.stamp-handle-delete')) return;
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      startLeft = stamp.x;
      startTop = stamp.y;
      el.setPointerCapture(e.pointerId);
      e.stopPropagation();
    });

    resizeHandle.addEventListener('pointerdown', (e) => {
      resizing = true;
      startX = e.clientX;
      startY = e.clientY;
      startW = stamp.width;
      startH = stamp.height;
      resizeHandle.setPointerCapture(e.pointerId);
      e.stopPropagation();
    });

    window.addEventListener('pointermove', (e) => {
      const zoom = window.docState.zoom || 1.0;
      if (dragging) {
        const dx = (e.clientX - startX) / zoom;
        const dy = (e.clientY - startY) / zoom;
        stamp.x = Math.max(0, startLeft + dx);
        stamp.y = Math.max(0, startTop + dy);
        el.style.left = `${stamp.x}px`;
        el.style.top = `${stamp.y}px`;
      } else if (resizing) {
        const dx = (e.clientX - startX) / zoom;
        const dy = (e.clientY - startY) / zoom;
        stamp.width = Math.max(60, startW + dx);
        stamp.height = Math.max(25, startH + dy);
        el.style.width = `${stamp.width}px`;
        el.style.height = `${stamp.height}px`;
      }
    });

    window.addEventListener('pointerup', () => {
      dragging = false;
      resizing = false;
    });
  }

  addStampToActivePage(dataUrl, width = 160, height = 75) {
    const pageNum = window.docState.currentPage || 1;
    const pageAnn = window.docState.initPageAnnotations(pageNum);

    const stamp = {
      id: 'stamp_' + Math.random().toString(36).substring(2, 9),
      x: 100,
      y: 120,
      width: width,
      height: height,
      dataUrl: dataUrl
    };

    pageAnn.stamps.push(stamp);
    this.renderStampsOnPage(pageNum);
    window.showToast(`Sello/Firma estampado en la página ${pageNum}.`, 'success');
  }

  /* ==================== 4. MINIATURAS LATERALES Y GESTIÓN ==================== */

  async generateThumbnails() {
    const container = document.getElementById('thumbnail-list');
    const badge = document.getElementById('thumb-count-badge');
    if (!container) return;

    container.innerHTML = '';
    const state = window.docState;
    if (badge) badge.textContent = state.totalPages;

    for (let i = 1; i <= state.totalPages; i++) {
      const page = await state.pdfJsDoc.getPage(i);
      const viewport = page.getViewport({ scale: 0.28 });

      const thumbCanvas = document.createElement('canvas');
      const tw = Math.floor(viewport.width);
      const th = Math.floor(viewport.height);
      thumbCanvas.width = tw;
      thumbCanvas.height = th;
      const ctx = thumbCanvas.getContext('2d', { alpha: false });
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, tw, th);
      await page.render({ canvasContext: ctx, viewport: viewport }).promise;

      const item = document.createElement('div');
      item.className = `thumb-item p-2 relative flex flex-col items-center ${i === state.currentPage ? 'active' : ''}`;
      item.setAttribute('data-page', i);

      item.innerHTML = `
        <div class="thumb-actions">
          <button class="thumb-action-btn btn-th-rot" title="Rotar 90°"><i class="fa-solid fa-rotate-right"></i></button>
          <button class="thumb-action-btn btn-th-dup" title="Duplicar"><i class="fa-solid fa-copy"></i></button>
          <button class="thumb-action-btn btn-th-del hover:!bg-rose-600" title="Eliminar"><i class="fa-solid fa-trash-can"></i></button>
        </div>
        <img src="${thumbCanvas.toDataURL('image/png')}" class="max-w-full rounded pointer-events-none mb-1 shadow" />
        <span class="text-[10px] font-mono text-slate-400 font-semibold">Pág. ${i}</span>
      `;

      item.addEventListener('click', () => {
        this.scrollToPage(i);
        if (window.innerWidth < 1024) {
          document.getElementById('thumbnail-strip')?.classList.remove('open-mobile');
          document.getElementById('sidebar-backdrop')?.classList.add('hidden');
        }
      });

      item.querySelector('.btn-th-rot')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.rotatePage(i, 90);
      });

      item.querySelector('.btn-th-dup')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.duplicatePage(i);
      });

      item.querySelector('.btn-th-del')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.deletePage(i);
      });

      container.appendChild(item);
    }

    // Inicializar drag & drop en miniaturas con SortableJS
    if (window.Sortable) {
      new Sortable(container, {
        animation: 160,
        ghostClass: 'opacity-40',
        onEnd: (evt) => {
          this.reorderPages(evt.oldIndex + 1, evt.newIndex + 1);
        }
      });
    }
  }

  scrollToPage(pageNum) {
    window.docState.currentPage = pageNum;
    document.getElementById('input-page-num').value = pageNum;

    // Actualizar miniatura activa
    document.querySelectorAll('.thumb-item').forEach(el => {
      if (parseInt(el.getAttribute('data-page'), 10) === pageNum) {
        el.classList.add('active');
      } else {
        el.classList.remove('active');
      }
    });

    const target = document.getElementById(`acrobat-page-${pageNum}`);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  async rotatePage(pageNum, deg) {
    window.showLoading(true, `Rotando página ${pageNum}...`);
    try {
      const page = window.docState.pdfLibDoc.getPage(pageNum - 1);
      const currentAngle = page.getRotation().angle;
      page.setRotation(PDFLib.degrees((currentAngle + deg) % 360));

      const bytes = await window.docState.pdfLibDoc.save();
      await this.loadPDFBuffer(bytes.buffer, window.docState.name, bytes.byteLength);
      window.showToast(`Página ${pageNum} rotada.`, 'success');
    } catch (err) {
      window.showToast('Error al rotar la página.', 'error');
    } finally {
      window.showLoading(false);
    }
  }

  async duplicatePage(pageNum) {
    window.showLoading(true, `Duplicando página ${pageNum}...`);
    try {
      const [copied] = await window.docState.pdfLibDoc.copyPages(window.docState.pdfLibDoc, [pageNum - 1]);
      window.docState.pdfLibDoc.insertPage(pageNum, copied);

      const bytes = await window.docState.pdfLibDoc.save();
      await this.loadPDFBuffer(bytes.buffer, window.docState.name, bytes.byteLength);
      window.showToast('Página duplicada con éxito.', 'success');
    } catch (err) {
      window.showToast('Error al duplicar página.', 'error');
    } finally {
      window.showLoading(false);
    }
  }

  async deletePage(pageNum) {
    if (window.docState.totalPages <= 1) {
      window.showToast('No puedes eliminar la única página del documento.', 'warning');
      return;
    }
    if (!confirm(`¿Eliminar la página ${pageNum}?`)) return;

    window.showLoading(true, 'Eliminando página...');
    try {
      window.docState.pdfLibDoc.removePage(pageNum - 1);
      const bytes = await window.docState.pdfLibDoc.save();
      await this.loadPDFBuffer(bytes.buffer, window.docState.name, bytes.byteLength);
      window.showToast('Página eliminada.', 'info');
    } catch (err) {
      window.showToast('Error al eliminar página.', 'error');
    } finally {
      window.showLoading(false);
    }
  }

  async reorderPages(fromNum, toNum) {
    if (fromNum === toNum) return;
    window.showLoading(true, 'Reordenando páginas...');
    try {
      const doc = window.docState.pdfLibDoc;
      const count = doc.getPageCount();
      const pageIndices = Array.from({ length: count }, (_, i) => i);

      // Reordenar arreglo de índices
      const moved = pageIndices.splice(fromNum - 1, 1)[0];
      pageIndices.splice(toNum - 1, 0, moved);

      const newDoc = await PDFLib.PDFDocument.create();
      const copiedPages = await newDoc.copyPages(doc, pageIndices);
      copiedPages.forEach(p => newDoc.addPage(p));

      const bytes = await newDoc.save();
      await this.loadPDFBuffer(bytes.buffer, window.docState.name, bytes.byteLength);
      window.showToast('Páginas reordenadas.', 'success');
    } catch (err) {
      window.showToast('Error al reordenar.', 'error');
    } finally {
      window.showLoading(false);
    }
  }

  /* ==================== 5. EXPORTACIÓN CON QUEMADO VECTORIAL ==================== */

  async exportAndDownloadPDF() {
    if (!window.docState.hasDocument || !window.docState.pdfLibDoc) {
      window.showToast('No hay ningún documento abierto para guardar.', 'warning');
      return;
    }

    window.showLoading(true, 'Incrustando firmas vectoriales, textos y anotaciones...');
    try {
      const pdfDoc = window.docState.pdfLibDoc;
      const pages = pdfDoc.getPages();

      for (let i = 0; i < pages.length; i++) {
        const pageNum = i + 1;
        const pdfPage = pages[i];
        const { width: pdfW, height: pdfH } = pdfPage.getSize();

        const pageAnn = window.docState.annotations[pageNum];
        if (!pageAnn) continue;

        const pageObj = this.renderedPages.get(pageNum);
        if (!pageObj) continue;

        const cssW = pageObj.cssWidth;
        const cssH = pageObj.cssHeight;
        const scaleFactorX = pdfW / cssW;
        const scaleFactorY = pdfH / cssH;

        // 1. Quemado de trazos y dibujos mediante capa PNG nítida de alta resolución
        if (pageAnn.strokes.length > 0) {
          const offCanvas = document.createElement('canvas');
          offCanvas.width = pdfW * 2;
          offCanvas.height = pdfH * 2;
          const offCtx = offCanvas.getContext('2d');
          offCtx.scale(2, 2);

          pageAnn.strokes.forEach(s => {
            offCtx.save();
            if (s.tool === 'pencil' || s.tool === 'highlighter') {
              if (s.points && s.points.length > 1) {
                offCtx.beginPath();
                offCtx.strokeStyle = s.color;
                offCtx.globalAlpha = s.alpha || 1.0;
                offCtx.lineWidth = (s.lineWidth / this.renderScale) * scaleFactorX;
                offCtx.lineCap = s.tool === 'highlighter' ? 'square' : 'round';
                offCtx.lineJoin = 'round';
                offCtx.moveTo((s.points[0].x / this.renderScale) * scaleFactorX, (s.points[0].y / this.renderScale) * scaleFactorY);
                for (let k = 1; k < s.points.length; k++) {
                  offCtx.lineTo((s.points[k].x / this.renderScale) * scaleFactorX, (s.points[k].y / this.renderScale) * scaleFactorY);
                }
                offCtx.stroke();
              }
            } else if (s.tool === 'rect') {
              if (s.fill || s.isMask) {
                offCtx.fillStyle = s.color || '#ffffff';
                offCtx.fillRect(
                  (s.x / this.renderScale) * scaleFactorX,
                  (s.y / this.renderScale) * scaleFactorY,
                  (s.width / this.renderScale) * scaleFactorX,
                  (s.height / this.renderScale) * scaleFactorY
                );
              } else {
                offCtx.beginPath();
                offCtx.strokeStyle = s.color;
                offCtx.lineWidth = (s.lineWidth / this.renderScale) * scaleFactorX;
                offCtx.strokeRect(
                  (s.x / this.renderScale) * scaleFactorX,
                  (s.y / this.renderScale) * scaleFactorY,
                  (s.width / this.renderScale) * scaleFactorX,
                  (s.height / this.renderScale) * scaleFactorY
                );
              }
            }
            offCtx.restore();
          });

          const strokeImgBytes = await fetch(offCanvas.toDataURL('image/png')).then(r => r.arrayBuffer());
          const embeddedStrokes = await pdfDoc.embedPng(strokeImgBytes);
          pdfPage.drawImage(embeddedStrokes, { x: 0, y: 0, width: pdfW, height: pdfH });
        }

        // 2. Incrustación de textos (reemplazos in-place y nuevos textos libres)
        if (pageAnn.texts.length > 0) {
          for (const t of pageAnn.texts) {
            // Si es un reemplazo de texto existente, tapar el texto original con un rectángulo blanco limpio
            if (t.isReplacement) {
              const rX = (t.boxX || 0) * scaleFactorX;
              const rW = ((t.boxW || 40) + 4) * scaleFactorX;
              const rH = ((t.boxH || 14) + 4) * scaleFactorY;
              // En coordenadas PDF, el origen (0,0) está en la esquina inferior izquierda
              const rY = pdfH - ((t.boxY || 0) * scaleFactorY) - rH;

              pdfPage.drawRectangle({
                x: Math.max(0, rX - 2),
                y: Math.max(0, rY),
                width: rW + 4,
                height: rH + 2,
                color: PDFLib.rgb(1, 1, 1),
                borderWidth: 0
              });
            }

            // Dibujamos el nuevo texto nítido en canvas de alta resolución
            const textCanvas = document.createElement('canvas');
            textCanvas.width = pdfW * 2;
            textCanvas.height = pdfH * 2;
            const tCtx = textCanvas.getContext('2d');
            tCtx.scale(2, 2);
            tCtx.font = `${(t.size / this.renderScale) * scaleFactorY}px ${t.font}`;
            tCtx.fillStyle = t.color || '#000000';
            tCtx.textBaseline = 'top';
            const posX = (t.boxX !== undefined ? t.boxX : (t.x / this.renderScale)) * scaleFactorX;
            const posY = (t.boxY !== undefined ? t.boxY : (t.y / this.renderScale)) * scaleFactorY;
            tCtx.fillText(t.text, posX, posY);

            const txtBytes = await fetch(textCanvas.toDataURL('image/png')).then(r => r.arrayBuffer());
            const embeddedTxt = await pdfDoc.embedPng(txtBytes);
            pdfPage.drawImage(embeddedTxt, { x: 0, y: 0, width: pdfW, height: pdfH });
          }
        }

        // 3. Incrustación de sellos y firmas digitales
        if (pageAnn.stamps.length > 0) {
          for (const stamp of pageAnn.stamps) {
            const stampBytes = await fetch(stamp.dataUrl).then(r => r.arrayBuffer());
            const embeddedStamp = await pdfDoc.embedPng(stampBytes);

            const sWidth = stamp.width * scaleFactorX;
            const sHeight = stamp.height * scaleFactorY;
            const sX = stamp.x * scaleFactorX;
            // Coordenada Y en PDF se mide desde el fondo inferior hacia arriba
            const sY = pdfH - (stamp.y * scaleFactorY) - sHeight;

            pdfPage.drawImage(embeddedStamp, {
              x: sX,
              y: sY,
              width: sWidth,
              height: sHeight
            });
          }
        }
      }

      const finalBytes = await pdfDoc.save();
      const blob = new Blob([finalBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      const baseName = window.docState.name.replace(/\.pdf$/i, '');
      a.download = `${baseName}_Editado.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      window.showToast('Documento guardado y descargado con éxito.', 'success');
    } catch (err) {
      console.error('Error al exportar PDF:', err);
      window.showToast('Error al exportar el documento: ' + err.message, 'error');
    } finally {
      window.showLoading(false);
    }
  }

  /* ==================== 6. TOP BAR Y NAVEGACIÓN ==================== */

  setupTopBar() {
    // Dropdown Archivo
    const fileMenuBtn = document.getElementById('btn-file-menu');
    const fileDropdown = document.getElementById('dropdown-file-menu');
    fileMenuBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      fileDropdown?.classList.toggle('hidden');
    });

    window.addEventListener('click', () => this.closeFileDropdown());

    // Paginación
    document.getElementById('btn-page-prev')?.addEventListener('click', () => {
      if (window.docState.currentPage > 1) {
        this.scrollToPage(window.docState.currentPage - 1);
      }
    });

    document.getElementById('btn-page-next')?.addEventListener('click', () => {
      if (window.docState.currentPage < window.docState.totalPages) {
        this.scrollToPage(window.docState.currentPage + 1);
      }
    });

    document.getElementById('input-page-num')?.addEventListener('change', (e) => {
      const page = parseInt(e.target.value, 10);
      if (!isNaN(page) && page >= 1 && page <= window.docState.totalPages) {
        this.scrollToPage(page);
      }
    });

    // Zoom
    document.getElementById('btn-zoom-in')?.addEventListener('click', () => window.docState.zoomIn());
    document.getElementById('btn-zoom-out')?.addEventListener('click', () => window.docState.zoomOut());
    document.getElementById('btn-zoom-reset')?.addEventListener('click', () => window.docState.resetZoom());
    document.getElementById('btn-fit-width')?.addEventListener('click', () => this.fitToWidth());

    // Guardar PDF
    document.getElementById('btn-save-pdf')?.addEventListener('click', () => this.exportAndDownloadPDF());

    // Conectar Botones Deshacer y Rehacer (Barra superior y Ribbon)
    document.getElementById('btn-undo')?.addEventListener('click', () => this.undo());
    document.getElementById('btn-redo')?.addEventListener('click', () => this.redo());
    document.getElementById('btn-ribbon-undo')?.addEventListener('click', () => this.undo());
    document.getElementById('btn-ribbon-redo')?.addEventListener('click', () => this.redo());

    window.docState.on('historyChanged', () => this.updateUndoRedoButtons());
    this.updateUndoRedoButtons();
  }

  undo() {
    const state = window.docState;
    if (!state.undoStack || state.undoStack.length === 0) {
      window.showToast('No hay más acciones para deshacer.', 'info');
      return;
    }

    const action = state.undoStack.pop();
    state.redoStack.push(action);

    switch (action.type) {
      case 'stroke': {
        const pageAnn = state.annotations[action.pageNum];
        if (pageAnn && pageAnn.strokes) {
          const idx = pageAnn.strokes.lastIndexOf(action.stroke);
          if (idx !== -1) pageAnn.strokes.splice(idx, 1);
          else pageAnn.strokes.pop();
          this.redrawPageAnnotations(action.pageNum);
        }
        break;
      }
      case 'draw': {
        const pageAnn = state.annotations[action.pageNum];
        if (pageAnn && pageAnn.strokes && pageAnn.strokes.length > 0) {
          const popped = pageAnn.strokes.pop();
          action.stroke = popped;
          this.redrawPageAnnotations(action.pageNum);
        }
        break;
      }
      case 'add_text': {
        const el = document.getElementById(action.boxId);
        if (el) el.remove();
        const pageAnn = state.annotations[action.pageNum];
        if (pageAnn) {
          pageAnn.texts = pageAnn.texts.filter(t => t.id !== action.boxId);
        }
        break;
      }
      case 'delete_box': {
        if (action.record) {
          this.insertInlineTextBox(action.pageNum, { x: action.record.boxX, y: action.record.boxY }, action.record.text);
        }
        break;
      }
      case 'edit_text': {
        const block = document.getElementById(action.blockId);
        if (block) {
          const content = block.querySelector('.text-block-content');
          if (content) content.innerText = action.oldText;
          if (!action.wasModified) block.classList.remove('modified');
        }
        const pageAnn = state.annotations[action.pageNum];
        if (pageAnn) {
          const t = pageAnn.texts.find(x => x.id === action.blockId);
          if (t) {
            if (!action.wasModified) {
              pageAnn.texts = pageAnn.texts.filter(x => x.id !== action.blockId);
            } else {
              t.text = action.oldText;
            }
          }
        }
        break;
      }
      case 'move_text': {
        const block = document.getElementById(action.blockId);
        if (block) {
          block.style.left = `${action.oldLeft}px`;
          block.style.top = `${action.oldTop}px`;
        }
        const pageAnn = state.annotations[action.pageNum];
        if (pageAnn) {
          const t = pageAnn.texts.find(x => x.id === action.blockId);
          if (t) {
            t.boxX = action.oldLeft;
            t.boxY = action.oldTop;
            t.x = action.oldLeft * this.renderScale;
            t.y = action.oldTop * this.renderScale;
          }
        }
        break;
      }
      case 'move_box': {
        const box = document.getElementById(action.boxId);
        if (box) {
          box.style.left = `${action.oldLeft}px`;
          box.style.top = `${action.oldTop}px`;
        }
        const pageAnn = state.annotations[action.pageNum];
        if (pageAnn) {
          const t = pageAnn.texts.find(x => x.id === action.boxId);
          if (t) {
            t.boxX = action.oldLeft;
            t.boxY = action.oldTop;
            t.x = action.oldLeft * this.renderScale;
            t.y = action.oldTop * this.renderScale;
          }
        }
        break;
      }
      case 'delete_text': {
        // Restaurar el texto y quitar la máscara blanca
        const pageAnn = state.annotations[action.pageNum];
        if (pageAnn && action.maskStroke) {
          pageAnn.strokes = pageAnn.strokes.filter(s => s !== action.maskStroke);
          this.redrawPageAnnotations(action.pageNum);
        }
        if (action.blockHtml && action.textLayerId) {
          const layer = document.getElementById(action.textLayerId);
          if (layer) {
            const temp = document.createElement('div');
            temp.innerHTML = action.blockHtml;
            const newBlock = temp.firstElementChild;
            if (newBlock) {
              layer.appendChild(newBlock);
              this.setupLiveTextBlock(newBlock, action.meta, action.pageNum);
            }
          }
        }
        break;
      }
      case 'stamp': {
        const el = document.getElementById(action.stampId);
        if (el) el.remove();
        const pageAnn = state.annotations[action.pageNum];
        if (pageAnn) {
          pageAnn.stamps = pageAnn.stamps.filter(s => s.id !== action.stampId);
        }
        break;
      }
    }

    this.updateUndoRedoButtons();
    window.showToast('Acción deshecha (Ctrl+Z)', 'info');
  }

  redo() {
    const state = window.docState;
    if (!state.redoStack || state.redoStack.length === 0) {
      window.showToast('No hay más acciones para rehacer.', 'info');
      return;
    }

    const action = state.redoStack.pop();
    state.undoStack.push(action);

    switch (action.type) {
      case 'stroke':
      case 'draw': {
        if (action.stroke) {
          const pageAnn = state.initPageAnnotations(action.pageNum);
          pageAnn.strokes.push(action.stroke);
          this.redrawPageAnnotations(action.pageNum);
        }
        break;
      }
      case 'add_text': {
        if (action.record) {
          this.insertInlineTextBox(action.pageNum, { x: action.record.boxX, y: action.record.boxY }, action.record.text);
        }
        break;
      }
      case 'delete_box': {
        const el = document.getElementById(action.boxId);
        if (el) el.remove();
        const pageAnn = state.annotations[action.pageNum];
        if (pageAnn) {
          pageAnn.texts = pageAnn.texts.filter(t => t.id !== action.boxId);
        }
        break;
      }
      case 'edit_text': {
        const block = document.getElementById(action.blockId);
        if (block) {
          const content = block.querySelector('.text-block-content');
          if (content) content.innerText = action.newText;
          block.classList.add('modified');
        }
        const pageAnn = state.annotations[action.pageNum];
        if (pageAnn) {
          const t = pageAnn.texts.find(x => x.id === action.blockId);
          if (t) t.text = action.newText;
        }
        break;
      }
      case 'move_text': {
        const block = document.getElementById(action.blockId);
        if (block) {
          block.style.left = `${action.newLeft}px`;
          block.style.top = `${action.newTop}px`;
        }
        const pageAnn = state.annotations[action.pageNum];
        if (pageAnn) {
          const t = pageAnn.texts.find(x => x.id === action.blockId);
          if (t) {
            t.boxX = action.newLeft;
            t.boxY = action.newTop;
            t.x = action.newLeft * this.renderScale;
            t.y = action.newTop * this.renderScale;
          }
        }
        break;
      }
      case 'move_box': {
        const box = document.getElementById(action.boxId);
        if (box) {
          box.style.left = `${action.newLeft}px`;
          box.style.top = `${action.newTop}px`;
        }
        const pageAnn = state.annotations[action.pageNum];
        if (pageAnn) {
          const t = pageAnn.texts.find(x => x.id === action.boxId);
          if (t) {
            t.boxX = action.newLeft;
            t.boxY = action.newTop;
            t.x = action.newLeft * this.renderScale;
            t.y = action.newTop * this.renderScale;
          }
        }
        break;
      }
      case 'delete_text': {
        const block = document.getElementById(action.blockId);
        if (block) block.remove();
        if (action.maskStroke) {
          const pageAnn = state.initPageAnnotations(action.pageNum);
          pageAnn.strokes.push(action.maskStroke);
          this.redrawPageAnnotations(action.pageNum);
        }
        break;
      }
    }

    this.updateUndoRedoButtons();
    window.showToast('Acción rehecha (Ctrl+Y)', 'info');
  }

  updateUndoRedoButtons() {
    const state = window.docState;
    const canUndo = Boolean(state.undoStack && state.undoStack.length > 0);
    const canRedo = Boolean(state.redoStack && state.redoStack.length > 0);

    const undoBtns = [document.getElementById('btn-undo'), document.getElementById('btn-ribbon-undo')];
    const redoBtns = [document.getElementById('btn-redo'), document.getElementById('btn-ribbon-redo')];

    undoBtns.forEach(btn => {
      if (!btn) return;
      btn.disabled = !canUndo;
      btn.style.opacity = canUndo ? '1' : '0.4';
      btn.style.cursor = canUndo ? 'pointer' : 'not-allowed';
    });

    redoBtns.forEach(btn => {
      if (!btn) return;
      btn.disabled = !canRedo;
      btn.style.opacity = canRedo ? '1' : '0.4';
      btn.style.cursor = canRedo ? 'pointer' : 'not-allowed';
    });
  }

  closeFileDropdown() {
    document.getElementById('dropdown-file-menu')?.classList.add('hidden');
  }

  applyZoom(zoom) {
    const stage = document.getElementById('pdf-render-stage');
    const zoomText = document.getElementById('btn-zoom-reset');
    if (stage) stage.style.transform = `scale(${zoom})`;
    if (zoomText) zoomText.textContent = `${Math.round(zoom * 100)}%`;
  }

  fitToWidth() {
    const viewport = document.getElementById('document-viewport');
    const firstPage = document.querySelector('.acrobat-page-wrapper');
    if (!viewport || !firstPage) return;

    const padding = window.innerWidth < 768 ? 20 : 80;
    const availableWidth = Math.max(100, viewport.clientWidth - padding);
    const pageWidth = parseFloat(firstPage.style.width) || 600;
    const targetZoom = Math.min(2.5, Math.max(0.2, availableWidth / pageWidth));
    window.docState.setZoom(targetZoom);
  }

  setupPanelsToggle() {
    const thumbStrip = document.getElementById('thumbnail-strip');
    const propsPanel = document.getElementById('properties-panel');
    const backdrop = document.getElementById('sidebar-backdrop');
    const btnMobileThumbs = document.getElementById('btn-mobile-thumbs');
    const btnMobileProps = document.getElementById('btn-mobile-props');
    const btnCollapseThumbs = document.getElementById('btn-collapse-thumbs');
    const btnCollapseProps = document.getElementById('btn-collapse-properties');
    const btnToggleProps = document.getElementById('btn-toggle-properties');

    const closeAllDrawers = () => {
      thumbStrip?.classList.remove('open-mobile');
      propsPanel?.classList.remove('open-mobile');
      backdrop?.classList.add('hidden');
    };

    // Botón Móvil: Abrir/Cerrar Miniaturas
    btnMobileThumbs?.addEventListener('click', () => {
      propsPanel?.classList.remove('open-mobile');
      const isOpen = thumbStrip?.classList.toggle('open-mobile');
      if (isOpen) backdrop?.classList.remove('hidden');
      else backdrop?.classList.add('hidden');
    });

    // Botón Móvil: Abrir/Cerrar Propiedades
    btnMobileProps?.addEventListener('click', () => {
      thumbStrip?.classList.remove('open-mobile');
      const isOpen = propsPanel?.classList.toggle('open-mobile');
      if (isOpen) backdrop?.classList.remove('hidden');
      else backdrop?.classList.add('hidden');
    });

    // Telón Backdrop táctil para cerrar paneles al tocar afuera
    backdrop?.addEventListener('click', closeAllDrawers);

    // Botón Colapsar Miniaturas (Desktop / Móvil)
    btnCollapseThumbs?.addEventListener('click', () => {
      if (window.innerWidth < 1024) {
        closeAllDrawers();
      } else {
        thumbStrip?.classList.toggle('collapsed');
      }
    });

    // Botón Colapsar Propiedades (Desktop / Móvil)
    btnCollapseProps?.addEventListener('click', () => {
      if (window.innerWidth < 1024) {
        closeAllDrawers();
      } else {
        propsPanel?.classList.toggle('collapsed');
      }
    });

    // Botón Ribbon para alternar panel de propiedades
    btnToggleProps?.addEventListener('click', () => {
      if (window.innerWidth < 1024) {
        thumbStrip?.classList.remove('open-mobile');
        const isOpen = propsPanel?.classList.toggle('open-mobile');
        if (isOpen) backdrop?.classList.remove('hidden');
        else backdrop?.classList.add('hidden');
      } else {
        propsPanel?.classList.toggle('collapsed');
      }
    });
  }

  /* ==================== 7. CINTA DE HERRAMIENTAS (RIBBON) ==================== */

  setupRibbon() {
    // Pestañas
    const tabs = document.querySelectorAll('.ribbon-tab');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const target = tab.getAttribute('data-tab');
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        document.querySelectorAll('.ribbon-content-section').forEach(sec => {
          if (sec.id === `ribbon-sec-${target}`) {
            sec.classList.remove('hidden');
          } else {
            sec.classList.add('hidden');
          }
        });
      });
    });

    // Herramientas de Edición
    document.querySelectorAll('[data-action="tool"]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-action="tool"]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const tool = btn.getAttribute('data-tool');
        window.docState.setTool(tool);
        this.updateCursorMode(tool);
      });
    });

    // Muestras de color rápido
    document.querySelectorAll('.color-swatch').forEach(swatch => {
      swatch.addEventListener('click', () => {
        document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
        swatch.classList.add('active');
        const color = swatch.getAttribute('data-color');
        window.docState.properties.color = color;
        const customInput = document.getElementById('ribbon-color-custom');
        if (customInput) customInput.value = color;
        const propInput = document.getElementById('prop-stroke-color');
        if (propInput) propInput.value = color;
        document.getElementById('prop-stroke-color-hex').textContent = color;
      });
    });

    // Botones de Firma Rápida
    document.getElementById('btn-ribbon-draw-sign')?.addEventListener('click', () => this.openSignatureModal());
    
    // Subir PNG con eliminación de fondo
    const signInput = document.getElementById('input-ribbon-upload-sign');
    signInput?.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        this.processSignatureFile(e.target.files[0]);
        signInput.value = '';
      }
    });

    // Sellos predefinidos
    document.getElementById('btn-stamp-approved')?.addEventListener('click', () => {
      this.generateTextStamp('APROBADO', '#10b981');
    });

    document.getElementById('btn-stamp-confidential')?.addEventListener('click', () => {
      this.generateTextStamp('CONFIDENCIAL', '#ef4444');
    });

    document.getElementById('btn-stamp-date')?.addEventListener('click', () => {
      const today = new Date().toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' });
      this.generateTextStamp(today, '#6366f1', 180, 50);
    });

    // Acciones de Páginas en Ribbon
    document.getElementById('btn-ribbon-rotate-cw')?.addEventListener('click', () => {
      this.rotatePage(window.docState.currentPage, 90);
    });
    document.getElementById('btn-ribbon-rotate-ccw')?.addEventListener('click', () => {
      this.rotatePage(window.docState.currentPage, -90);
    });
    document.getElementById('btn-ribbon-duplicate-page')?.addEventListener('click', () => {
      this.duplicatePage(window.docState.currentPage);
    });
    document.getElementById('btn-ribbon-delete-page')?.addEventListener('click', () => {
      this.deletePage(window.docState.currentPage);
    });
    document.getElementById('btn-ribbon-insert-pdf')?.addEventListener('click', () => {
      this.promptInsertPDF();
    });
    document.getElementById('btn-ribbon-split-range')?.addEventListener('click', () => {
      this.splitByRange();
    });

    // Filtros fotográficos CamScanner en Ribbon
    document.querySelectorAll('.btn-apply-filter').forEach(btn => {
      btn.addEventListener('click', () => {
        const filter = btn.getAttribute('data-filter');
        this.applyFilterToCurrentPage(filter);
      });
    });

    // OCR en Ribbon
    document.getElementById('btn-ribbon-run-ocr')?.addEventListener('click', () => this.runOCROnCurrentPage());

    // Compresión en Ribbon
    document.getElementById('ribbon-compress-quality')?.addEventListener('input', (e) => {
      document.getElementById('label-compress-quality').textContent = `${e.target.value}%`;
    });
    document.getElementById('btn-ribbon-execute-compress')?.addEventListener('click', () => this.executeCompression());

    // Conversor en Ribbon
    document.getElementById('btn-convert-word-pdf')?.addEventListener('click', () => {
      const inp = document.getElementById('main-file-input');
      inp.accept = '.docx';
      inp.click();
    });
    document.getElementById('btn-convert-imgs-pdf')?.addEventListener('click', () => {
      const inp = document.getElementById('main-file-input');
      inp.accept = 'image/*';
      inp.click();
    });
    document.getElementById('btn-export-pdf-to-md')?.addEventListener('click', () => this.exportPDFToMarkdown());
    document.getElementById('btn-open-md-editor')?.addEventListener('click', () => this.openMarkdownModal());
  }

  updateCursorMode(tool) {
    const stage = document.getElementById('pdf-render-stage');
    stage?.classList.remove('tool-mode-text', 'tool-mode-select', 'tool-mode-eraser');
    if (tool === 'text') stage?.classList.add('tool-mode-text');
    if (tool === 'select') stage?.classList.add('tool-mode-select');
    if (tool === 'eraser') stage?.classList.add('tool-mode-eraser');

    const overlays = document.querySelectorAll('.acrobat-overlay-canvas');
    overlays.forEach(c => {
      if (tool === 'pencil' || tool === 'highlighter' || tool === 'rect' || tool === 'eraser') {
        c.style.cursor = 'crosshair';
      } else if (tool === 'text') {
        c.style.cursor = 'text';
      } else if (tool === 'hand') {
        c.style.cursor = 'grab';
      } else {
        c.style.cursor = 'default';
      }
    });
  }

  /* ==================== 8. PANELES LATERALES Y PROPIEDADES ==================== */

  setupPanelsToggle() {
    const thumbPanel = document.getElementById('thumbnail-strip');
    const propPanel = document.getElementById('properties-panel');

    document.getElementById('btn-collapse-thumbs')?.addEventListener('click', () => {
      thumbPanel?.classList.toggle('collapsed');
    });

    document.getElementById('btn-toggle-thumbnails')?.addEventListener('click', () => {
      thumbPanel?.classList.toggle('collapsed');
    });

    document.getElementById('btn-collapse-properties')?.addEventListener('click', () => {
      propPanel?.classList.toggle('collapsed');
    });

    document.getElementById('btn-toggle-properties')?.addEventListener('click', () => {
      propPanel?.classList.toggle('collapsed');
    });

    document.getElementById('btn-thumb-add-pdf')?.addEventListener('click', () => {
      this.promptInsertPDF();
    });
  }

  setupPropertiesPanel() {
    const strokeColor = document.getElementById('prop-stroke-color');
    const strokeWidth = document.getElementById('prop-stroke-width');
    const opacity = document.getElementById('prop-opacity');
    const fontSize = document.getElementById('prop-font-size');
    const fontFamily = document.getElementById('prop-font-family');

    strokeColor?.addEventListener('input', (e) => {
      window.docState.properties.color = e.target.value;
      document.getElementById('prop-stroke-color-hex').textContent = e.target.value;
    });

    strokeWidth?.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      window.docState.properties.lineWidth = val;
      document.getElementById('prop-stroke-width-val').textContent = `${val}px`;
    });

    opacity?.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      window.docState.properties.opacity = val / 100;
      document.getElementById('prop-opacity-val').textContent = `${val}%`;
    });

    fontSize?.addEventListener('input', (e) => {
      window.docState.properties.fontSize = parseInt(e.target.value, 10) || 16;
    });

    fontFamily?.addEventListener('change', (e) => {
      window.docState.properties.fontFamily = e.target.value;
    });

    document.getElementById('btn-clear-annotations')?.addEventListener('click', () => {
      const pageNum = window.docState.currentPage;
      if (confirm(`¿Limpiar todas las anotaciones de la página ${pageNum}?`)) {
        window.docState.annotations[pageNum] = { strokes: [], texts: [], stamps: [] };
        this.redrawPageAnnotations(pageNum);
        this.renderStampsOnPage(pageNum);
        window.showToast('Anotaciones limpiadas.', 'info');
      }
    });
  }

  setupKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
      const activeEl = document.activeElement;
      const isTextInput = activeEl && (
        activeEl.tagName === 'INPUT' ||
        activeEl.tagName === 'TEXTAREA' ||
        (activeEl.isContentEditable && !e.ctrlKey && !e.metaKey)
      );

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        if (!activeEl || !activeEl.isContentEditable) {
          e.preventDefault();
          if (e.shiftKey) {
            this.redo();
          } else {
            this.undo();
          }
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        if (!activeEl || !activeEl.isContentEditable) {
          e.preventDefault();
          this.redo();
        }
      } else if (!isTextInput) {
        if (e.key === 'v' || e.key === 'V') {
          window.docState.setTool('select');
        } else if (e.key === 'p' || e.key === 'P') {
          window.docState.setTool('pencil');
        } else if (e.key === 't' || e.key === 'T') {
          window.docState.setTool('text');
        } else if (e.key === 'u' || e.key === 'U') {
          window.docState.setTool('highlighter');
        }
      }
    });
  }

  /* ==================== 9. MODALES: FIRMA, OCR, MARKDOWN ==================== */

  setupSignatureModal() {
    const modal = document.getElementById('modal-signature');
    const canvas = document.getElementById('canvas-signature-pad');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    let drawing = false;
    const getPos = (e) => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    canvas.onpointerdown = (e) => {
      drawing = true;
      const p = getPos(e);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      canvas.setPointerCapture(e.pointerId);
    };

    canvas.onpointermove = (e) => {
      if (!drawing) return;
      const p = getPos(e);
      ctx.lineTo(p.x, p.y);
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
    };

    canvas.onpointerup = (e) => {
      drawing = false;
      try { canvas.releasePointerCapture(e.pointerId); } catch(err){}
    };

    document.getElementById('btn-modal-sig-close')?.addEventListener('click', () => modal?.classList.add('hidden'));
    document.getElementById('btn-modal-sig-clear')?.addEventListener('click', () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    });

    document.getElementById('btn-modal-sig-apply')?.addEventListener('click', () => {
      const dataUrl = canvas.toDataURL('image/png');
      this.addStampToActivePage(dataUrl);
      modal?.classList.add('hidden');
    });
  }

  openSignatureModal() {
    const modal = document.getElementById('modal-signature');
    const canvas = document.getElementById('canvas-signature-pad');
    if (modal && canvas) {
      canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
      modal.classList.remove('hidden');
    }
  }

  processSignatureFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        // Eliminar fondo blanco para transparencia total
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = img.width;
        tempCanvas.height = img.height;
        const ctx = tempCanvas.getContext('2d');
        ctx.drawImage(img, 0, 0);

        const imgData = ctx.getImageData(0, 0, img.width, img.height);
        const data = imgData.data;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i] > 195 && data[i+1] > 195 && data[i+2] > 195) {
            data[i+3] = 0; // Transparente
          }
        }
        ctx.putImageData(imgData, 0, 0);
        this.addStampToActivePage(tempCanvas.toDataURL('image/png'));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  generateTextStamp(text, color, w = 170, h = 60) {
    const canvas = document.createElement('canvas');
    canvas.width = w * 2;
    canvas.height = h * 2;
    const ctx = canvas.getContext('2d');
    ctx.scale(2, 2);

    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.strokeRect(4, 4, w - 8, h - 8);

    ctx.font = 'bold 15px Arial, sans-serif';
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2);

    this.addStampToActivePage(canvas.toDataURL('image/png'), w, h);
  }

  /* ==================== 10. FILTROS Y OCR ==================== */

  async applyFilterToCurrentPage(filterType) {
    const pageNum = window.docState.currentPage || 1;
    const pageObj = this.renderedPages.get(pageNum);
    if (!pageObj) return;

    window.showLoading(true, `Aplicando filtro ${filterType}...`);
    try {
      const canvas = pageObj.pdfCanvas;
      const ctx = pageObj.pdfCtx;

      // Re-renderizar página original limpia primero
      const page = await window.docState.pdfJsDoc.getPage(pageNum);
      await page.render({ canvasContext: ctx, viewport: pageObj.viewport }).promise;

      if (filterType === 'original') {
        window.showToast('Filtro restablecido.', 'info');
        return;
      }

      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imgData.data;

      if (filterType === 'grayscale') {
        for (let i = 0; i < data.length; i += 4) {
          const gray = 0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2];
          data[i] = data[i+1] = data[i+2] = gray;
        }
      } else if (filterType === 'bw') {
        for (let i = 0; i < data.length; i += 4) {
          const gray = 0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2];
          const val = gray > 145 ? 255 : 0;
          data[i] = data[i+1] = data[i+2] = val;
        }
      } else if (filterType === 'magic') {
        // Magic Color (CamScanner style)
        for (let i = 0; i < data.length; i += 4) {
          const lum = 0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2];
          if (lum > 165) {
            const boost = (lum - 165) / 90;
            data[i] = Math.min(255, data[i] + (255 - data[i]) * boost * 0.95);
            data[i+1] = Math.min(255, data[i+1] + (255 - data[i+1]) * boost * 0.95);
            data[i+2] = Math.min(255, data[i+2] + (255 - data[i+2]) * boost * 0.95);
          } else {
            data[i] = Math.max(0, data[i] * 0.85);
            data[i+1] = Math.max(0, data[i+1] * 0.85);
            data[i+2] = Math.max(0, data[i+2] * 0.85);
          }
        }
      }

      ctx.putImageData(imgData, 0, 0);
      window.showToast(`Filtro ${filterType} aplicado a la página ${pageNum}.`, 'success');
    } catch (err) {
      window.showToast('Error al aplicar filtro.', 'error');
    } finally {
      window.showLoading(false);
    }
  }

  async runOCROnCurrentPage() {
    const pageNum = window.docState.currentPage || 1;
    const pageObj = this.renderedPages.get(pageNum);
    if (!pageObj) return;

    // Regla de Oro: comprobar si ya contiene texto digital seleccionable
    const page = await window.docState.pdfJsDoc.getPage(pageNum);
    const textContent = await page.getTextContent();
    const rawText = textContent.items.map(it => it.str).join(' ').trim();

    if (rawText.length > 50) {
      window.showToast('Documento digital nativo: El texto ya es seleccionable.', 'info');
      this.showOcrResultModal(rawText);
      return;
    }

    const modal = document.getElementById('modal-ocr');
    modal?.classList.remove('hidden');

    const statusEl = document.getElementById('ocr-modal-status');
    const percentEl = document.getElementById('ocr-modal-percent');
    const progressEl = document.getElementById('ocr-modal-progress-bar');
    const textarea = document.getElementById('ocr-modal-text-result');
    const lang = document.getElementById('select-ocr-lang')?.value || 'spa+eng';

    if (statusEl) statusEl.textContent = 'Inicializando motor OCR WebAssembly...';

    try {
      const worker = await Tesseract.createWorker(lang, 1, {
        logger: m => {
          if (m.progress && progressEl && percentEl) {
            const p = Math.round(m.progress * 100);
            progressEl.style.width = `${p}%`;
            percentEl.textContent = `${p}%`;
          }
          if (m.status && statusEl) {
            statusEl.textContent = m.status;
          }
        }
      });

      const { data: { text } } = await worker.recognize(pageObj.pdfCanvas);
      await worker.terminate();

      if (textarea) textarea.value = text.trim();
      if (statusEl) statusEl.textContent = '¡Texto reconocido!';
      window.showToast('OCR completado con éxito.', 'success');
    } catch (err) {
      console.error('Error en OCR:', err);
      window.showToast('Error durante el OCR: ' + err.message, 'error');
    }
  }

  showOcrResultModal(text) {
    const modal = document.getElementById('modal-ocr');
    const textarea = document.getElementById('ocr-modal-text-result');
    if (modal && textarea) {
      textarea.value = text;
      modal.classList.remove('hidden');
    }
  }

  setupOcrModal() {
    document.getElementById('btn-modal-ocr-close')?.addEventListener('click', () => {
      document.getElementById('modal-ocr')?.classList.add('hidden');
    });

    document.getElementById('btn-ocr-copy')?.addEventListener('click', () => {
      const text = document.getElementById('ocr-modal-text-result')?.value;
      if (text) {
        navigator.clipboard.writeText(text).then(() => window.showToast('Texto copiado al portapapeles.', 'success'));
      }
    });

    document.getElementById('btn-ocr-download-txt')?.addEventListener('click', () => {
      const text = document.getElementById('ocr-modal-text-result')?.value;
      if (!text) return;
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Texto_OCR_${Date.now()}.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
  }

  /* ==================== 11. COMPRESIÓN, IMPORTACIÓN Y CONVERSIÓN ==================== */

  async executeCompression() {
    if (!window.docState.hasDocument) return;

    const qualityVal = parseInt(document.getElementById('ribbon-compress-quality').value, 10) / 100;
    window.showLoading(true, 'Recomprimiendo documento en memoria RAM...');
    try {
      const newPdf = await PDFLib.PDFDocument.create();

      for (let i = 1; i <= window.docState.totalPages; i++) {
        const page = await window.docState.pdfJsDoc.getPage(i);
        const origVp = page.getViewport({ scale: 1.0 });
        const scaleVp = page.getViewport({ scale: 1.2 });

        const canvas = document.createElement('canvas');
        canvas.width = scaleVp.width;
        canvas.height = scaleVp.height;
        const ctx = canvas.getContext('2d');
        await page.render({ canvasContext: ctx, viewport: scaleVp }).promise;

        const jpegUrl = canvas.toDataURL('image/jpeg', qualityVal);
        const imgBytes = await fetch(jpegUrl).then(r => r.arrayBuffer());
        const embedded = await newPdf.embedJpg(imgBytes);

        const newP = newPdf.addPage([origVp.width, origVp.height]);
        newP.drawImage(embedded, { x: 0, y: 0, width: origVp.width, height: origVp.height });
      }

      const compressedBytes = await newPdf.save({ useObjectStreams: true });
      const diff = window.docState.size - compressedBytes.byteLength;
      const pct = Math.round((diff / window.docState.size) * 100);

      // Cargar el documento comprimido directamente en el visor
      await this.loadPDFBuffer(compressedBytes.buffer, window.docState.name, compressedBytes.byteLength);

      const statusEl = document.getElementById('ribbon-compress-status');
      if (statusEl) {
        statusEl.textContent = `Ahorro: -${pct}% (${this.formatBytes(compressedBytes.byteLength)})`;
      }
      window.showToast(`Documento optimizado: -${pct}% de peso`, 'success');
    } catch (err) {
      console.error('Error al comprimir:', err);
      window.showToast('Error al comprimir documento.', 'error');
    } finally {
      window.showLoading(false);
    }
  }

  async importWordDocx(file) {
    window.showLoading(true, 'Renderizando documento Word con docx-preview...');
    try {
      const buffer = await file.arrayBuffer();
      const container = document.createElement('div');
      container.style.position = 'absolute';
      container.style.left = '-9999px';
      container.style.width = '800px';
      document.body.appendChild(container);

      await window.docx.renderAsync(buffer, container, null, { className: 'docx', inWrapper: true });

      const opt = {
        margin: [10, 10, 10, 10],
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
      };

      const pdfBlob = await html2pdf().set(opt).from(container).outputPdf('blob');
      container.remove();

      const pdfBuffer = await pdfBlob.arrayBuffer();
      await this.loadPDFBuffer(pdfBuffer, file.name.replace(/\.docx$/i, '.pdf'), pdfBlob.size);
      window.showToast('Documento Word importado fielmente como PDF.', 'success');
    } catch (err) {
      console.error('Error importando Word:', err);
      window.showToast('Error al importar Word (.docx).', 'error');
    } finally {
      window.showLoading(false);
    }
  }

  async importImageAsPDF(file) {
    window.showLoading(true, 'Convirtiendo imagen a PDF...');
    try {
      const pdfDoc = await PDFLib.PDFDocument.create();
      const buffer = await file.arrayBuffer();
      let img;
      if (file.type === 'image/png') {
        img = await pdfDoc.embedPng(buffer);
      } else {
        img = await pdfDoc.embedJpg(buffer);
      }

      const dims = img.scale(1.0);
      const page = pdfDoc.addPage([dims.width + 40, dims.height + 40]);
      page.drawImage(img, { x: 20, y: 20, width: dims.width, height: dims.height });

      const bytes = await pdfDoc.save();
      await this.loadPDFBuffer(bytes.buffer, file.name + '.pdf', bytes.byteLength);
      window.showToast('Imagen convertida a PDF.', 'success');
    } catch (err) {
      window.showToast('Error al procesar la imagen.', 'error');
    } finally {
      window.showLoading(false);
    }
  }

  async promptInsertPDF() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/pdf';
    input.onchange = async (e) => {
      if (e.target.files && e.target.files[0]) {
        window.showLoading(true, 'Fusionando páginas del nuevo PDF...');
        try {
          const newBuffer = await e.target.files[0].arrayBuffer();
          const extraPdf = await PDFLib.PDFDocument.load(newBuffer, { ignoreEncryption: true });
          const count = extraPdf.getPageCount();
          const indices = Array.from({ length: count }, (_, i) => i);
          const copiedPages = await window.docState.pdfLibDoc.copyPages(extraPdf, indices);
          copiedPages.forEach(p => window.docState.pdfLibDoc.addPage(p));

          const bytes = await window.docState.pdfLibDoc.save();
          await this.loadPDFBuffer(bytes.buffer, window.docState.name, bytes.byteLength);
          window.showToast(`Se insertaron ${count} páginas adicionales.`, 'success');
        } catch (err) {
          window.showToast('Error al fusionar PDF.', 'error');
        } finally {
          window.showLoading(false);
        }
      }
    };
    input.click();
  }

  async splitByRange() {
    const total = window.docState.totalPages;
    const range = prompt(`Ingresa las páginas a extraer (ej. 1-3, 5, 8-${total}):`);
    if (!range) return;

    window.showLoading(true, 'Extrayendo páginas...');
    try {
      const indices = [];
      range.split(',').forEach(part => {
        part = part.trim();
        if (part.includes('-')) {
          const [s, e] = part.split('-').map(n => parseInt(n, 10));
          if (!isNaN(s) && !isNaN(e)) {
            for (let i = Math.min(s, e); i <= Math.max(s, e); i++) {
              if (i >= 1 && i <= total) indices.push(i - 1);
            }
          }
        } else {
          const n = parseInt(part, 10);
          if (!isNaN(n) && n >= 1 && n <= total) indices.push(n - 1);
        }
      });

      const uniqueIndices = Array.from(new Set(indices)).sort((a, b) => a - b);
      if (uniqueIndices.length === 0) {
        window.showToast('Rango no válido.', 'warning');
        return;
      }

      const newPdf = await PDFLib.PDFDocument.create();
      const copied = await newPdf.copyPages(window.docState.pdfLibDoc, uniqueIndices);
      copied.forEach(p => newPdf.addPage(p));

      const bytes = await newPdf.save();
      const blob = new Blob([bytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `PDF_Extraido_Paginas_${uniqueIndices.map(i => i + 1).join('_')}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      window.showToast('Páginas extraídas y descargadas.', 'success');
    } catch (err) {
      window.showToast('Error al extraer páginas.', 'error');
    } finally {
      window.showLoading(false);
    }
  }

  async exportPDFToMarkdown() {
    if (!window.docState.hasDocument) return;

    window.showLoading(true, 'Extrayendo Markdown estructurado con geometría 2D...');
    try {
      let md = `# ${window.docState.name.replace(/\.pdf$/i, '')}\n\n`;

      for (let i = 1; i <= window.docState.totalPages; i++) {
        const page = await window.docState.pdfJsDoc.getPage(i);
        const textContent = await page.getTextContent();
        const items = textContent.items;
        if (!items || items.length === 0) continue;

        // Agrupar en líneas según coordenada Y
        const lineMap = new Map();
        items.forEach(it => {
          if (!it.str || it.str.trim() === '') return;
          const y = Math.round(it.transform[5] / 4) * 4;
          if (!lineMap.has(y)) lineMap.set(y, []);
          lineMap.get(y).push({ str: it.str, x: it.transform[4] });
        });

        const sortedY = Array.from(lineMap.keys()).sort((a, b) => b - a);
        md += `\n<!-- Página ${i} -->\n\n`;

        sortedY.forEach(y => {
          const line = lineMap.get(y);
          line.sort((a, b) => a.x - b.x);
          md += line.map(it => it.str).join(' ') + '\n\n';
        });
      }

      const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${window.docState.name.replace(/\.pdf$/i, '')}.md`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      window.showToast('Archivo Markdown extraído y descargado.', 'success');
    } catch (err) {
      window.showToast('Error al exportar a Markdown.', 'error');
    } finally {
      window.showLoading(false);
    }
  }

  setupMarkdownModal() {
    const modal = document.getElementById('modal-markdown');
    const editor = document.getElementById('modal-md-editor');
    const preview = document.getElementById('modal-md-preview');

    editor?.addEventListener('input', () => {
      let val = editor.value;
      // Fórmulas KaTeX
      val = val.replace(/\$\$([\s\S]*?)\$\$/g, (m, expr) => {
        try { return `<div class="my-2 flex justify-center">${window.katex.renderToString(expr.trim(), { displayMode: true, throwOnError: false })}</div>`; } catch(e){ return m; }
      });
      val = val.replace(/\$([^\$\n]+?)\$/g, (m, expr) => {
        try { return window.katex.renderToString(expr.trim(), { displayMode: false, throwOnError: false }); } catch(e){ return m; }
      });
      if (window.marked && preview) {
        const parsedHtml = window.marked.parse(val);
        preview.innerHTML = window.sanitizeHTML(parsedHtml);
        if (window.hljs) {
          preview.querySelectorAll('pre code').forEach(el => window.hljs.highlightElement(el));
        }
      }
    });

    document.getElementById('btn-modal-md-close')?.addEventListener('click', () => modal?.classList.add('hidden'));

    document.getElementById('btn-modal-md-export')?.addEventListener('click', async () => {
      if (!preview) return;
      window.showLoading(true, 'Compilando Markdown a PDF...');
      try {
        const opt = {
          margin: [15, 15, 15, 15],
          filename: 'Markdown_Documento.pdf',
          html2canvas: { scale: 2 },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
        };
        const pdfBlob = await html2pdf().set(opt).from(preview).outputPdf('blob');
        const buffer = await pdfBlob.arrayBuffer();
        await this.loadPDFBuffer(buffer, 'Markdown_Documento.pdf', pdfBlob.size);
        modal?.classList.add('hidden');
        window.showToast('Documento compilado y cargado en el visor.', 'success');
      } catch (err) {
        window.showToast('Error al compilar Markdown.', 'error');
      } finally {
        window.showLoading(false);
      }
    });
  }

  openMarkdownModal() {
    const modal = document.getElementById('modal-markdown');
    const editor = document.getElementById('modal-md-editor');
    if (editor && !editor.value) {
      editor.value = `# Documento Técnico con Fórmulas y Código

Fórmula KaTeX:
$$f(x) = \\int_{-\\infty}^{\\infty} \\hat{f}(\\xi)\\,e^{2 \\pi i \\xi x}\\,d\\xi$$

Bloque de código:
\`\`\`javascript
console.log("PDF Editor WebAssembly");
\`\`\`
`;
      editor.dispatchEvent(new Event('input'));
    }
    modal?.classList.remove('hidden');
  }

  formatBytes(bytes) {
    if (!+bytes) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  }
}

// Sanitizador de HTML en el cliente para prevenir XSS
window.sanitizeHTML = function(dirtyHtml) {
  if (!dirtyHtml || typeof dirtyHtml !== 'string') return '';
  const parser = new DOMParser();
  const doc = parser.parseFromString(dirtyHtml, 'text/html');

  // Eliminar etiquetas que ejecutan scripts o cargan contenido externo no autorizado
  const bannedTags = ['script', 'iframe', 'object', 'embed', 'form', 'base', 'link', 'meta', 'applet'];
  bannedTags.forEach(tag => {
    doc.querySelectorAll(tag).forEach(el => el.remove());
  });

  // Eliminar atributos peligrosos como eventos on* y javascript:
  doc.querySelectorAll('*').forEach(el => {
    Array.from(el.attributes).forEach(attr => {
      const name = attr.name.toLowerCase();
      const val = attr.value.trim().toLowerCase();
      if (name.startsWith('on') || val.startsWith('javascript:') || (name === 'href' && val.startsWith('data:text/html'))) {
        el.removeAttribute(attr.name);
      }
    });
  });

  return doc.body.innerHTML;
};

// Helpers globales con protección XSS
window.showToast = function(msg, type = 'info') {
  const c = document.getElementById('toast-container');
  if (!c) return;
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  const icons = {
    success: 'fa-circle-check text-emerald-400',
    error: 'fa-circle-xmark text-rose-400',
    warning: 'fa-triangle-exclamation text-amber-400',
    info: 'fa-circle-info text-cyan-400'
  };
  t.innerHTML = `<i class="fa-solid ${icons[type] || icons.info}"></i><span></span>`;
  const span = t.querySelector('span');
  if (span) span.textContent = String(msg || '');
  c.appendChild(t);
  setTimeout(() => {
    t.style.opacity = '0';
    setTimeout(() => t.remove(), 250);
  }, 3500);
};

window.showLoading = function(show, msg = 'Procesando...') {
  const o = document.getElementById('global-loading-overlay');
  const txt = document.getElementById('loading-overlay-text');
  if (!o) return;
  if (show) {
    if (txt) txt.textContent = msg;
    o.classList.remove('hidden');
  } else {
    o.classList.add('hidden');
  }
};

document.addEventListener('DOMContentLoaded', () => {
  window.unifiedApp = new UnifiedAcrobatApp();
  window.unifiedApp.init();
});

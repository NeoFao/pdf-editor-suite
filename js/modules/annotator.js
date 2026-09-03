/**
 * PDF Editor - Módulo 2: Editor de Anotaciones y Firma Digital
 * Dibujo libre, resaltado fluorescente, texto, sellado de firmas digitales y exportación vectorial.
 * Integrado con pdfjsLib para renderizado y pdf-lib para incrustación vectorial final.
 */

class AnnotatorModule {
  constructor() {
    this.pdfJsDoc = null;
    this.originalBuffer = null;
    this.currentPageNum = 1;
    this.totalPageCount = 0;
    this.renderScale = 1.5; // Escala nítida para alta densidad de píxeles
    this.isDrawing = false;
    this.currentPath = [];
    this.activeStampElement = null;

    // Firma digital
    this.signaturePadCanvas = null;
    this.signaturePadCtx = null;
    this.isSigning = false;
  }

  init() {
    this.setupEventListeners();
    this.initSignatureModal();
  }

  setupEventListeners() {
    const dropzone = document.getElementById('annotator-dropzone');
    const fileInput = document.getElementById('annotator-file-input');

    if (dropzone && fileInput) {
      dropzone.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', async (e) => {
        if (e.target.files && e.target.files[0]) {
          await this.loadFile(e.target.files[0]);
          fileInput.value = '';
        }
      });

      ['dragenter', 'dragover'].forEach(ev => {
        dropzone.addEventListener(ev, (e) => {
          e.preventDefault();
          dropzone.classList.add('dragover');
        });
      });

      ['dragleave', 'drop'].forEach(ev => {
        dropzone.addEventListener(ev, (e) => {
          e.preventDefault();
          dropzone.classList.remove('dragover');
        });
      });

      dropzone.addEventListener('drop', async (e) => {
        const file = Array.from(e.dataTransfer.files).find(f => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
        if (file) {
          await this.loadFile(file);
        } else {
          window.showToast('Por favor, arrastra un archivo PDF válido.', 'warning');
        }
      });
    }

    // Controles de herramientas
    const toolButtons = document.querySelectorAll('[data-tool]');
    toolButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tool = btn.getAttribute('data-tool');
        this.setActiveTool(tool);
      });
    });

    // Color picker y grosor
    const colorPicker = document.getElementById('annotator-color');
    colorPicker?.addEventListener('input', (e) => {
      window.appState.annotator.color = e.target.value;
    });

    const widthSlider = document.getElementById('annotator-width');
    widthSlider?.addEventListener('input', (e) => {
      window.appState.annotator.lineWidth = parseInt(e.target.value, 10);
    });

    // Paginación
    document.getElementById('annotator-prev-page')?.addEventListener('click', () => this.goToPage(this.currentPageNum - 1));
    document.getElementById('annotator-next-page')?.addEventListener('click', () => this.goToPage(this.currentPageNum + 1));
    document.getElementById('annotator-page-select')?.addEventListener('change', (e) => {
      this.goToPage(parseInt(e.target.value, 10));
    });

    // Guardar / Exportar
    document.getElementById('annotator-export-btn')?.addEventListener('click', () => this.exportAnnotatedPDF());

    // Abrir modal de firma
    document.getElementById('annotator-open-signature-btn')?.addEventListener('click', () => {
      this.openSignatureModal();
    });

    // Subir firma en imagen PNG
    const signImgInput = document.getElementById('annotator-signature-img-input');
    signImgInput?.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        this.handleSignatureImageUpload(e.target.files[0]);
        signImgInput.value = '';
      }
    });

    // Reaccionar a cambios globales de Zoom (50% a 180%)
    window.appState.on('zoomChanged', (zoom) => {
      this.applyZoom(zoom);
    });
  }

  async loadFile(file) {
    window.showLoading(true, 'Abriendo documento para edición...');
    try {
      this.originalBuffer = await file.arrayBuffer();
      
      // Cargar en pdfjsLib
      this.pdfJsDoc = await pdfjsLib.getDocument({ data: new Uint8Array(this.originalBuffer) }).promise;
      this.totalPageCount = this.pdfJsDoc.numPages;
      this.currentPageNum = 1;

      // Inicializar estructura de anotaciones vacía por página
      window.appState.annotator.annotations = {};
      window.appState.annotator.stamps = [];
      for (let i = 1; i <= this.totalPageCount; i++) {
        window.appState.annotator.annotations[i] = [];
      }

      // Actualizar UI
      document.getElementById('annotator-empty-state')?.classList.add('hidden');
      document.getElementById('annotator-workspace')?.classList.remove('hidden');
      
      this.updatePaginationUI();
      await this.renderPage(1);
      window.showToast(`Documento cargado: ${file.name} (${this.totalPageCount} págs.)`, 'success');
    } catch (err) {
      console.error('Error al cargar PDF en Anotador:', err);
      window.showToast('Error al abrir el PDF. Verifica que el archivo sea válido.', 'error');
    } finally {
      window.showLoading(false);
    }
  }

  updatePaginationUI() {
    const pageSelect = document.getElementById('annotator-page-select');
    const totalPagesSpan = document.getElementById('annotator-total-pages');

    if (totalPagesSpan) totalPagesSpan.textContent = this.totalPageCount;

    if (pageSelect) {
      pageSelect.innerHTML = '';
      for (let i = 1; i <= this.totalPageCount; i++) {
        const opt = document.createElement('option');
        opt.value = i;
        opt.textContent = i;
        pageSelect.appendChild(opt);
      }
      pageSelect.value = this.currentPageNum;
    }
  }

  async goToPage(pageNum) {
    if (pageNum < 1 || pageNum > this.totalPageCount || pageNum === this.currentPageNum) return;
    this.currentPageNum = pageNum;
    const pageSelect = document.getElementById('annotator-page-select');
    if (pageSelect) pageSelect.value = pageNum;
    await this.renderPage(pageNum);
  }

  async renderPage(pageNum) {
    if (!this.pdfJsDoc) return;

    const page = await this.pdfJsDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: this.renderScale });

    const renderCanvas = document.getElementById('annotator-render-canvas');
    const annotCanvas = document.getElementById('annotator-draw-canvas');
    const pageContainer = document.getElementById('annotator-page-container');

    if (!renderCanvas || !annotCanvas || !pageContainer) return;

    // Configurar dimensiones físicas (alta resolución)
    renderCanvas.width = viewport.width;
    renderCanvas.height = viewport.height;
    annotCanvas.width = viewport.width;
    annotCanvas.height = viewport.height;

    // Establecer tamaño visual en CSS
    const cssWidth = viewport.width / this.renderScale;
    const cssHeight = viewport.height / this.renderScale;
    pageContainer.style.width = `${cssWidth}px`;
    pageContainer.style.height = `${cssHeight}px`;

    // Renderizar página del PDF
    const renderCtx = renderCanvas.getContext('2d');
    await page.render({ canvasContext: renderCtx, viewport: viewport }).promise;

    // Redibujar anotaciones existentes de esta página
    this.redrawAnnotations();
    this.renderStampsForPage();
    this.setupDrawingListeners(annotCanvas);
    this.applyZoom(window.appState.zoomLevel);
  }

  applyZoom(zoom) {
    const container = document.getElementById('annotator-zoom-content');
    const zoomText = document.getElementById('annotator-zoom-indicator');
    if (container) {
      container.style.transform = `scale(${zoom})`;
    }
    if (zoomText) {
      zoomText.textContent = `${Math.round(zoom * 100)}%`;
    }
  }

  setActiveTool(tool) {
    window.appState.annotator.activeTool = tool;
    document.querySelectorAll('[data-tool]').forEach(btn => {
      if (btn.getAttribute('data-tool') === tool) {
        btn.classList.add('bg-indigo-600', 'text-white');
        btn.classList.remove('bg-slate-800', 'text-slate-300');
      } else {
        btn.classList.remove('bg-indigo-600', 'text-white');
        btn.classList.add('bg-slate-800', 'text-slate-300');
      }
    });

    const annotCanvas = document.getElementById('annotator-draw-canvas');
    if (annotCanvas) {
      if (tool === 'pencil' || tool === 'highlighter') {
        annotCanvas.style.cursor = 'crosshair';
      } else if (tool === 'text') {
        annotCanvas.style.cursor = 'text';
      } else {
        annotCanvas.style.cursor = 'default';
      }
    }
  }

  setupDrawingListeners(canvas) {
    const ctx = canvas.getContext('2d');

    const getCanvasCoords = (e) => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY
      };
    };

    canvas.onpointerdown = (e) => {
      const tool = window.appState.annotator.activeTool;
      const coords = getCanvasCoords(e);

      if (tool === 'pencil' || tool === 'highlighter') {
        this.isDrawing = true;
        this.currentPath = [coords];
        canvas.setPointerCapture(e.pointerId);
      } else if (tool === 'text') {
        this.handleTextInsertion(coords);
      }
    };

    canvas.onpointermove = (e) => {
      if (!this.isDrawing) return;
      const tool = window.appState.annotator.activeTool;
      const coords = getCanvasCoords(e);
      this.currentPath.push(coords);

      // Trazo dinámico en pantalla
      ctx.beginPath();
      const prev = this.currentPath[this.currentPath.length - 2];
      ctx.moveTo(prev.x, prev.y);
      ctx.lineTo(coords.x, coords.y);

      if (tool === 'highlighter') {
        ctx.strokeStyle = window.appState.annotator.color;
        ctx.globalAlpha = 0.35;
        ctx.lineWidth = window.appState.annotator.lineWidth * 4;
        ctx.lineCap = 'square';
      } else {
        ctx.strokeStyle = window.appState.annotator.color;
        ctx.globalAlpha = 1.0;
        ctx.lineWidth = window.appState.annotator.lineWidth * this.renderScale;
        ctx.lineCap = 'round';
      }
      ctx.stroke();
    };

    canvas.onpointerup = (e) => {
      if (!this.isDrawing) return;
      this.isDrawing = false;
      try { canvas.releasePointerCapture(e.pointerId); } catch(err) {}

      const tool = window.appState.annotator.activeTool;
      if (this.currentPath.length > 1) {
        const annotation = {
          type: tool,
          points: [...this.currentPath],
          color: window.appState.annotator.color,
          lineWidth: tool === 'highlighter' ? window.appState.annotator.lineWidth * 4 : window.appState.annotator.lineWidth * this.renderScale,
          alpha: tool === 'highlighter' ? 0.35 : 1.0
        };

        if (!window.appState.annotator.annotations[this.currentPageNum]) {
          window.appState.annotator.annotations[this.currentPageNum] = [];
        }
        window.appState.annotator.annotations[this.currentPageNum].push(annotation);
      }
      this.currentPath = [];
      this.redrawAnnotations();
    };
  }

  handleTextInsertion(coords) {
    const textInput = prompt('Escribe el texto que deseas insertar:');
    if (!textInput || textInput.trim() === '') return;

    const annotation = {
      type: 'text',
      text: textInput,
      x: coords.x,
      y: coords.y,
      color: window.appState.annotator.color,
      size: (window.appState.annotator.lineWidth + 12) * this.renderScale
    };

    if (!window.appState.annotator.annotations[this.currentPageNum]) {
      window.appState.annotator.annotations[this.currentPageNum] = [];
    }
    window.appState.annotator.annotations[this.currentPageNum].push(annotation);
    this.redrawAnnotations();
  }

  redrawAnnotations() {
    const canvas = document.getElementById('annotator-draw-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const list = window.appState.annotator.annotations[this.currentPageNum] || [];
    list.forEach(ann => {
      ctx.save();
      if (ann.type === 'pencil' || ann.type === 'highlighter') {
        if (ann.points && ann.points.length > 1) {
          ctx.beginPath();
          ctx.strokeStyle = ann.color;
          ctx.globalAlpha = ann.alpha;
          ctx.lineWidth = ann.lineWidth;
          ctx.lineCap = ann.type === 'highlighter' ? 'square' : 'round';
          ctx.lineJoin = 'round';

          ctx.moveTo(ann.points[0].x, ann.points[0].y);
          for (let i = 1; i < ann.points.length; i++) {
            ctx.lineTo(ann.points[i].x, ann.points[i].y);
          }
          ctx.stroke();
        }
      } else if (ann.type === 'text') {
        ctx.font = `${ann.size}px Arial, sans-serif`;
        ctx.fillStyle = ann.color;
        ctx.textBaseline = 'middle';
        ctx.fillText(ann.text, ann.x, ann.y);
      }
      ctx.restore();
    });
  }

  /* ==================== SELLOS Y FIRMA DIGITAL ==================== */

  initSignatureModal() {
    const modal = document.getElementById('signature-modal');
    this.signaturePadCanvas = document.getElementById('signature-pad-canvas');
    if (!this.signaturePadCanvas) return;
    this.signaturePadCtx = this.signaturePadCanvas.getContext('2d');

    const clearBtn = document.getElementById('sig-clear-btn');
    const closeBtn = document.getElementById('sig-close-btn');
    const applyBtn = document.getElementById('sig-apply-btn');

    clearBtn?.addEventListener('click', () => this.clearSignaturePad());
    closeBtn?.addEventListener('click', () => modal.classList.add('hidden'));
    applyBtn?.addEventListener('click', () => this.applySignaturePad());

    // Eventos de trazo en el pad de firma
    let drawing = false;
    const canvas = this.signaturePadCanvas;
    const ctx = this.signaturePadCtx;

    const getPos = (e) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      };
    };

    canvas.onpointerdown = (e) => {
      drawing = true;
      const pos = getPos(e);
      ctx.beginPath();
      ctx.moveTo(pos.x, pos.y);
      canvas.setPointerCapture(e.pointerId);
    };

    canvas.onpointermove = (e) => {
      if (!drawing) return;
      const pos = getPos(e);
      ctx.lineTo(pos.x, pos.y);
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
    };

    canvas.onpointerup = (e) => {
      drawing = false;
      try { canvas.releasePointerCapture(e.pointerId); } catch(err){}
    };
  }

  openSignatureModal() {
    const modal = document.getElementById('signature-modal');
    if (modal) {
      modal.classList.remove('hidden');
      this.clearSignaturePad();
    }
  }

  clearSignaturePad() {
    if (!this.signaturePadCtx || !this.signaturePadCanvas) return;
    this.signaturePadCtx.clearRect(0, 0, this.signaturePadCanvas.width, this.signaturePadCanvas.height);
  }

  applySignaturePad() {
    const dataUrl = this.signaturePadCanvas.toDataURL('image/png');
    this.addSignatureStamp(dataUrl);
    document.getElementById('signature-modal')?.classList.add('hidden');
    window.showToast('Firma insertada en la página actual. Arrástrala para posicionarla.', 'success');
  }

  handleSignatureImageUpload(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        // Filtrar fondo blanco para asegurar transparencia PNG pura
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = img.width;
        tempCanvas.height = img.height;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.drawImage(img, 0, 0);

        const imgData = tempCtx.getImageData(0, 0, img.width, img.height);
        const data = imgData.data;

        // Umbral de blanqueamiento para firmas escaneadas en papel
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i+1];
          const b = data[i+2];
          // Si el píxel es casi blanco, hacerlo completamente transparente
          if (r > 200 && g > 200 && b > 200) {
            data[i+3] = 0;
          }
        }
        tempCtx.putImageData(imgData, 0, 0);
        const transparentDataUrl = tempCanvas.toDataURL('image/png');

        this.addSignatureStamp(transparentDataUrl);
        window.showToast('Firma importada con fondo transparente.', 'success');
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  addSignatureStamp(dataUrl) {
    const stamp = {
      id: 'stamp_' + Math.random().toString(36).substring(2, 9),
      pageIndex: this.currentPageNum,
      x: 80,
      y: 80,
      width: 160,
      height: 80,
      dataUrl: dataUrl
    };

    window.appState.annotator.stamps.push(stamp);
    this.renderStampsForPage();
  }

  renderStampsForPage() {
    // Limpiar sellos DOM anteriores
    const container = document.getElementById('annotator-page-container');
    if (!container) return;

    container.querySelectorAll('.stamp-overlay').forEach(el => el.remove());

    const pageStamps = window.appState.annotator.stamps.filter(s => s.pageIndex === this.currentPageNum);
    pageStamps.forEach(stamp => {
      const stampEl = document.createElement('div');
      stampEl.className = 'stamp-overlay';
      stampEl.id = stamp.id;
      stampEl.style.left = `${stamp.x}px`;
      stampEl.style.top = `${stamp.y}px`;
      stampEl.style.width = `${stamp.width}px`;
      stampEl.style.height = `${stamp.height}px`;

      stampEl.innerHTML = `
        <img src="${stamp.dataUrl}" alt="Firma" />
        <div class="stamp-handle-delete" title="Eliminar"><i class="fa-solid fa-xmark"></i></div>
        <div class="stamp-handle-resize" title="Redimensionar"></div>
      `;

      // Eliminar sello
      stampEl.querySelector('.stamp-handle-delete').addEventListener('click', (e) => {
        e.stopPropagation();
        window.appState.annotator.stamps = window.appState.annotator.stamps.filter(s => s.id !== stamp.id);
        stampEl.remove();
        window.showToast('Firma eliminada.', 'info');
      });

      // Arrastrar sello
      this.makeDraggableAndResizable(stampEl, stamp);

      container.appendChild(stampEl);
    });
  }

  makeDraggableAndResizable(el, stamp) {
    let isDragging = false;
    let isResizing = false;
    let startX = 0, startY = 0;
    let startLeft = 0, startTop = 0;
    let startWidth = 0, startHeight = 0;

    const resizeHandle = el.querySelector('.stamp-handle-resize');

    el.addEventListener('pointerdown', (e) => {
      if (e.target === resizeHandle || e.target.closest('.stamp-handle-delete')) return;
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      startLeft = stamp.x;
      startTop = stamp.y;
      el.setPointerCapture(e.pointerId);
      e.stopPropagation();
    });

    resizeHandle.addEventListener('pointerdown', (e) => {
      isResizing = true;
      startX = e.clientX;
      startY = e.clientY;
      startWidth = stamp.width;
      startHeight = stamp.height;
      resizeHandle.setPointerCapture(e.pointerId);
      e.stopPropagation();
    });

    window.addEventListener('pointermove', (e) => {
      if (isDragging) {
        const dx = (e.clientX - startX) / window.appState.zoomLevel;
        const dy = (e.clientY - startY) / window.appState.zoomLevel;
        stamp.x = Math.max(0, startLeft + dx);
        stamp.y = Math.max(0, startTop + dy);
        el.style.left = `${stamp.x}px`;
        el.style.top = `${stamp.y}px`;
      } else if (isResizing) {
        const dx = (e.clientX - startX) / window.appState.zoomLevel;
        const dy = (e.clientY - startY) / window.appState.zoomLevel;
        stamp.width = Math.max(60, startWidth + dx);
        stamp.height = Math.max(30, startHeight + dy);
        el.style.width = `${stamp.width}px`;
        el.style.height = `${stamp.height}px`;
      }
    });

    window.addEventListener('pointerup', () => {
      isDragging = false;
      isResizing = false;
    });
  }

  /* ==================== QUEMADO VECTORIAL & EXPORTACIÓN ==================== */

  async exportAnnotatedPDF() {
    if (!this.originalBuffer) {
      window.showToast('No hay documento abierto para exportar.', 'warning');
      return;
    }

    window.showLoading(true, 'Incrustando firmas y anotaciones vectoriales...');
    try {
      const pdfDoc = await PDFLib.PDFDocument.load(this.originalBuffer, { ignoreEncryption: true });
      const pages = pdfDoc.getPages();

      for (let i = 0; i < pages.length; i++) {
        const pageNum = i + 1;
        const pdfPage = pages[i];
        const { width: pdfWidth, height: pdfHeight } = pdfPage.getSize();

        // Verificar si hay anotaciones de dibujo en esta página
        const annList = window.appState.annotator.annotations[pageNum] || [];
        const stamps = window.appState.annotator.stamps.filter(s => s.pageIndex === pageNum);

        if (annList.length === 0 && stamps.length === 0) continue;

        // Si hay dibujos o texto, renderizarlos a un canvas transparente temporal a la resolución exacta del PDF
        if (annList.length > 0) {
          const offscreenCanvas = document.createElement('canvas');
          offscreenCanvas.width = pdfWidth * 2; // Doble resolución para nitidez
          offscreenCanvas.height = pdfHeight * 2;
          const offCtx = offscreenCanvas.getContext('2d');
          offCtx.scale(2, 2);

          const scaleRatioX = pdfWidth / (document.getElementById('annotator-render-canvas').width / this.renderScale);
          const scaleRatioY = pdfHeight / (document.getElementById('annotator-render-canvas').height / this.renderScale);

          annList.forEach(ann => {
            offCtx.save();
            if (ann.type === 'pencil' || ann.type === 'highlighter') {
              if (ann.points && ann.points.length > 1) {
                offCtx.beginPath();
                offCtx.strokeStyle = ann.color;
                offCtx.globalAlpha = ann.alpha;
                offCtx.lineWidth = (ann.lineWidth / this.renderScale) * scaleRatioX;
                offCtx.lineCap = ann.type === 'highlighter' ? 'square' : 'round';
                offCtx.lineJoin = 'round';

                const p0 = ann.points[0];
                offCtx.moveTo((p0.x / this.renderScale) * scaleRatioX, (p0.y / this.renderScale) * scaleRatioY);
                for (let k = 1; k < ann.points.length; k++) {
                  const pk = ann.points[k];
                  offCtx.lineTo((pk.x / this.renderScale) * scaleRatioX, (pk.y / this.renderScale) * scaleRatioY);
                }
                offCtx.stroke();
              }
            } else if (ann.type === 'text') {
              offCtx.font = `${(ann.size / this.renderScale) * scaleRatioY}px Arial, sans-serif`;
              offCtx.fillStyle = ann.color;
              offCtx.textBaseline = 'middle';
              offCtx.fillText(ann.text, (ann.x / this.renderScale) * scaleRatioX, (ann.y / this.renderScale) * scaleRatioY);
            }
            offCtx.restore();
          });

          const overlayPngUrl = offscreenCanvas.toDataURL('image/png');
          const pngBytes = await fetch(overlayPngUrl).then(res => res.arrayBuffer());
          const embeddedImage = await pdfDoc.embedPng(pngBytes);
          pdfPage.drawImage(embeddedImage, {
            x: 0,
            y: 0,
            width: pdfWidth,
            height: pdfHeight
          });
        }

        // Incrustar firmas (sellos)
        for (const stamp of stamps) {
          const stampBytes = await fetch(stamp.dataUrl).then(res => res.arrayBuffer());
          const stampImg = await pdfDoc.embedPng(stampBytes);

          // Escalar coordenadas del visor CSS a coordenadas del PDF (origen inferior izquierdo en PDF)
          const domContainer = document.getElementById('annotator-page-container');
          const domWidth = parseFloat(domContainer.style.width);
          const domHeight = parseFloat(domContainer.style.height);

          const factorX = pdfWidth / domWidth;
          const factorY = pdfHeight / domHeight;

          const stampPdfWidth = stamp.width * factorX;
          const stampPdfHeight = stamp.height * factorY;
          const stampPdfX = stamp.x * factorX;
          // Invertir eje Y para pdf-lib (origen Y en bottom)
          const stampPdfY = pdfHeight - (stamp.y * factorY) - stampPdfHeight;

          pdfPage.drawImage(stampImg, {
            x: stampPdfX,
            y: stampPdfY,
            width: stampPdfWidth,
            height: stampPdfHeight
          });
        }
      }

      const finalBytes = await pdfDoc.save();
      const blob = new Blob([finalBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      a.download = `PDF_Anotado_Firmado_${Date.now()}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      window.showToast('Documento firmado y exportado con éxito.', 'success');
    } catch (err) {
      console.error('Error al exportar anotaciones en PDF:', err);
      window.showToast('Error al exportar el PDF con anotaciones: ' + err.message, 'error');
    } finally {
      window.showLoading(false);
    }
  }
}

window.annotatorModule = new AnnotatorModule();

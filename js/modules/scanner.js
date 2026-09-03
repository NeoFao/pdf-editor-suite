/**
 * PDF Editor - Módulo 4: Escáner OCR & Filtros Fotográficos
 * Filtros CamScanner en Canvas 2D: Magic Color, Blanco y Negro, Escala de Grises.
 * Motor OCR Tesseract.js (WASM) con barra de progreso y regla de respaldo automático.
 */

class ScannerModule {
  constructor() {
    this.originalImage = null;
    this.processedCanvas = null;
    this.webcamStream = null;
    this.isProcessingOCR = false;
  }

  init() {
    this.processedCanvas = document.getElementById('scanner-canvas');
    this.setupEventListeners();
  }

  setupEventListeners() {
    const dropzone = document.getElementById('scanner-dropzone');
    const fileInput = document.getElementById('scanner-file-input');

    if (dropzone && fileInput) {
      dropzone.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', async (e) => {
        if (e.target.files && e.target.files[0]) {
          await this.loadImage(e.target.files[0]);
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
        const file = Array.from(e.dataTransfer.files).find(f => f.type.startsWith('image/') || f.type === 'application/pdf');
        if (file) {
          if (file.type === 'application/pdf') {
            await this.loadPdfAsScannedImage(file);
          } else {
            await this.loadImage(file);
          }
        }
      });
    }

    // Cámara web
    document.getElementById('scanner-webcam-btn')?.addEventListener('click', () => this.toggleWebcam());
    document.getElementById('scanner-capture-btn')?.addEventListener('click', () => this.captureWebcam());

    // Botones de filtro
    document.querySelectorAll('[data-filter]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const filter = btn.getAttribute('data-filter');
        this.applyFilter(filter);
      });
    });

    // Botón de ejecución OCR
    document.getElementById('scanner-run-ocr-btn')?.addEventListener('click', () => this.runOCR());

    // Acciones sobre texto extraído
    document.getElementById('scanner-copy-text-btn')?.addEventListener('click', () => this.copyExtractedText());
    document.getElementById('scanner-download-txt-btn')?.addEventListener('click', () => this.downloadTxt());
    document.getElementById('scanner-export-pdf-btn')?.addEventListener('click', () => this.exportScannedPDF());
  }

  async loadImage(file) {
    window.showLoading(true, 'Cargando documento fotográfico...');
    try {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          this.originalImage = img;
          this.showScannerWorkspace();
          this.applyFilter('magic'); // Magic Color por defecto
          window.showLoading(false);
          window.showToast('Documento cargado. Filtro Magic Color aplicado.', 'success');
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    } catch (err) {
      window.showLoading(false);
      window.showToast('Error al abrir la imagen.', 'error');
    }
  }

  async loadPdfAsScannedImage(file) {
    window.showLoading(true, 'Verificando texto nativo del PDF...');
    try {
      const buffer = await file.arrayBuffer();
      const pdfDoc = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
      const page = await pdfDoc.getPage(1);

      // REGLA CRÍTICA OCR: Verificar si contiene texto digital seleccionable
      const textContent = await page.getTextContent();
      const rawText = textContent.items.map(item => item.str).join('').trim();

      if (rawText.length > 50) {
        // Tiene texto nativo! No desperdiciar OCR en texto digital
        window.showToast('Documento digital nativo detectado: El PDF ya contiene texto seleccionable.', 'info');
        document.getElementById('scanner-ocr-result').value = textContent.items.map(item => item.str).join(' ');
      }

      // Renderizar página a canvas para aplicar filtros
      const viewport = page.getViewport({ scale: 2.0 });
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = viewport.width;
      tempCanvas.height = viewport.height;
      const ctx = tempCanvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport: viewport }).promise;

      const img = new Image();
      img.onload = () => {
        this.originalImage = img;
        this.showScannerWorkspace();
        this.applyFilter('magic');
        window.showLoading(false);
      };
      img.src = tempCanvas.toDataURL('image/png');
    } catch (err) {
      window.showLoading(false);
      window.showToast('Error al procesar PDF en el escáner.', 'error');
    }
  }

  showScannerWorkspace() {
    document.getElementById('scanner-empty-state')?.classList.add('hidden');
    document.getElementById('scanner-workspace')?.classList.remove('hidden');
    this.stopWebcam();
  }

  /* ==================== FILTROS FOTOGRÁFICOS ==================== */

  applyFilter(filterType) {
    if (!this.originalImage) return;

    window.appState.scanner.currentFilter = filterType;

    // Actualizar botones de filtro activo
    document.querySelectorAll('[data-filter]').forEach(b => {
      if (b.getAttribute('data-filter') === filterType) {
        b.classList.add('bg-indigo-600', 'text-white');
        b.classList.remove('bg-slate-800', 'text-slate-300');
      } else {
        b.classList.remove('bg-indigo-600', 'text-white');
        b.classList.add('bg-slate-800', 'text-slate-300');
      }
    });

    const canvas = document.getElementById('scanner-canvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    canvas.width = this.originalImage.width;
    canvas.height = this.originalImage.height;

    // Dibujar imagen original
    ctx.drawImage(this.originalImage, 0, 0);

    if (filterType === 'original') {
      return;
    }

    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imgData.data;
    const len = data.length;

    if (filterType === 'grayscale') {
      // Desaturación ponderada luminosa (ITU-R BT.601)
      for (let i = 0; i < len; i += 4) {
        const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        data[i] = gray;
        data[i + 1] = gray;
        data[i + 2] = gray;
      }
    } else if (filterType === 'bw') {
      // Blanco y Negro binario con umbralización adaptativa
      for (let i = 0; i < len; i += 4) {
        const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        const val = gray > 140 ? 255 : 0;
        data[i] = val;
        data[i + 1] = val;
        data[i + 2] = val;
      }
    } else if (filterType === 'magic') {
      // Magic Color (CamScanner style): Blanquea fondos, intensifica tinta de texto y mantiene tintes de color
      for (let i = 0; i < len; i += 4) {
        let r = data[i];
        let g = data[i + 1];
        let b = data[i + 2];

        // Calcular luminosidad
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;

        // Estiramiento de contraste no lineal
        if (lum > 165) {
          // Fondo claro: empujar hacia blanco puro
          const boost = (lum - 165) / (255 - 165);
          r = Math.min(255, r + (255 - r) * boost * 0.95);
          g = Math.min(255, g + (255 - g) * boost * 0.95);
          b = Math.min(255, b + (255 - b) * boost * 0.95);
        } else {
          // Tinta oscura: profundizar el contraste del texto
          const darken = 1.25;
          r = Math.max(0, r * (lum / 200) * darken);
          g = Math.max(0, g * (lum / 200) * darken);
          b = Math.max(0, b * (lum / 200) * darken);
        }

        data[i] = r;
        data[i + 1] = g;
        data[i + 2] = b;
      }
    }

    ctx.putImageData(imgData, 0, 0);
  }

  /* ==================== CÁMARA WEB ==================== */

  async toggleWebcam() {
    const video = document.getElementById('scanner-webcam-video');
    const container = document.getElementById('scanner-webcam-container');

    if (this.webcamStream) {
      this.stopWebcam();
      return;
    }

    try {
      this.webcamStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }
      });
      if (video && container) {
        video.srcObject = this.webcamStream;
        container.classList.remove('hidden');
      }
    } catch (err) {
      window.showToast('No se pudo acceder a la cámara: ' + err.message, 'error');
    }
  }

  captureWebcam() {
    const video = document.getElementById('scanner-webcam-video');
    if (!video || !this.webcamStream) return;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const img = new Image();
    img.onload = () => {
      this.originalImage = img;
      this.showScannerWorkspace();
      this.applyFilter('magic');
      window.showToast('Fotografía capturada con éxito.', 'success');
    };
    img.src = canvas.toDataURL('image/jpeg', 0.95);
  }

  stopWebcam() {
    if (this.webcamStream) {
      this.webcamStream.getTracks().forEach(t => t.stop());
      this.webcamStream = null;
    }
    document.getElementById('scanner-webcam-container')?.classList.add('hidden');
  }

  /* ==================== MOTOR OCR TESSERACT ==================== */

  async runOCR() {
    const canvas = document.getElementById('scanner-canvas');
    if (!canvas) {
      window.showToast('Carga o escanea una imagen primero.', 'warning');
      return;
    }

    if (this.isProcessingOCR) return;
    this.isProcessingOCR = true;

    const progressContainer = document.getElementById('scanner-ocr-progress-container');
    const progressBar = document.getElementById('scanner-ocr-progress-bar');
    const statusText = document.getElementById('scanner-ocr-status-text');
    const textarea = document.getElementById('scanner-ocr-result');
    const langSelect = document.getElementById('scanner-ocr-lang');

    const lang = langSelect ? langSelect.value : 'spa+eng';

    progressContainer?.classList.remove('hidden');
    if (progressBar) progressBar.style.width = '5%';
    if (statusText) statusText.textContent = 'Inicializando motor OCR WebAssembly...';

    try {
      const worker = await Tesseract.createWorker(lang, 1, {
        logger: m => {
          if (m.status && statusText) {
            const statusMap = {
              'loading tesseract core': 'Cargando núcleo WASM...',
              'loading language traineddata': `Descargando modelo de lenguaje (${lang})...`,
              'initializing api': 'Inicializando API OCR...',
              'recognizing text': 'Reconociendo caracteres y texto...'
            };
            statusText.textContent = statusMap[m.status] || m.status;
          }
          if (m.progress && progressBar) {
            const pct = Math.round(m.progress * 100);
            progressBar.style.width = `${pct}%`;
          }
        }
      });

      const { data: { text } } = await worker.recognize(canvas);
      await worker.terminate();

      if (textarea) textarea.value = text.trim();
      window.appState.scanner.ocrText = text.trim();

      if (progressBar) progressBar.style.width = '100%';
      if (statusText) statusText.textContent = '¡Reconocimiento completado!';
      window.showToast('Texto extraído con éxito por OCR.', 'success');
    } catch (err) {
      console.error('Error en Tesseract OCR:', err);
      window.showToast('Error al ejecutar OCR: ' + err.message, 'error');
      if (statusText) statusText.textContent = 'Error en el motor OCR.';
    } finally {
      this.isProcessingOCR = false;
      setTimeout(() => {
        progressContainer?.classList.add('hidden');
      }, 3000);
    }
  }

  copyExtractedText() {
    const text = document.getElementById('scanner-ocr-result')?.value;
    if (!text) {
      window.showToast('No hay texto para copiar.', 'warning');
      return;
    }
    navigator.clipboard.writeText(text).then(() => {
      window.showToast('Texto copiado al portapapeles.', 'success');
    });
  }

  downloadTxt() {
    const text = document.getElementById('scanner-ocr-result')?.value;
    if (!text) {
      window.showToast('No hay texto para descargar.', 'warning');
      return;
    }
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Texto_OCR_${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    window.showToast('Archivo .txt descargado.', 'success');
  }

  async exportScannedPDF() {
    const canvas = document.getElementById('scanner-canvas');
    if (!canvas) return;

    window.showLoading(true, 'Generando PDF escaneado...');
    try {
      const pdfDoc = await PDFLib.PDFDocument.create();
      const imgBytes = await fetch(canvas.toDataURL('image/jpeg', 0.9)).then(r => r.arrayBuffer());
      const embeddedJpg = await pdfDoc.embedJpg(imgBytes);

      // Usar tamaño estándar A4 (595.28 x 841.89) o proporción de la imagen
      const page = pdfDoc.addPage([canvas.width * 0.75, canvas.height * 0.75]);
      page.drawImage(embeddedJpg, {
        x: 0,
        y: 0,
        width: canvas.width * 0.75,
        height: canvas.height * 0.75
      });

      const pdfBytes = await pdfDoc.save();
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      a.download = `Documento_Escaneado_${Date.now()}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      window.showToast('PDF escaneado generado y descargado.', 'success');
    } catch (err) {
      console.error('Error al exportar PDF escaneado:', err);
      window.showToast('Error al exportar el documento.', 'error');
    } finally {
      window.showLoading(false);
    }
  }
}

window.scannerModule = new ScannerModule();

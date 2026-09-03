/**
 * PDF Editor - Módulo 3: Compresor y Optimizador
 * Reducción de escala y compresión adaptativa de documentos en el navegador.
 * Cero almacenamiento: Procesamiento en memoria de canvas y recompresión JPEG/Flate.
 */

class CompressorModule {
  constructor() {
    this.currentFile = null;
    this.originalBuffer = null;
    this.compressedBlob = null;
  }

  init() {
    this.setupEventListeners();
  }

  setupEventListeners() {
    const dropzone = document.getElementById('compressor-dropzone');
    const fileInput = document.getElementById('compressor-file-input');

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
          window.showToast('Por favor, selecciona un PDF para comprimir.', 'warning');
        }
      });
    }

    // Sliders y presets
    const qualitySlider = document.getElementById('compressor-quality');
    const qualityVal = document.getElementById('compressor-quality-val');
    qualitySlider?.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      window.appState.compressor.quality = val / 100;
      if (qualityVal) qualityVal.textContent = `${val}%`;
    });

    const scaleSelect = document.getElementById('compressor-scale');
    scaleSelect?.addEventListener('change', (e) => {
      window.appState.compressor.scaleDpi = parseFloat(e.target.value);
    });

    // Botón de iniciar compresión
    document.getElementById('compressor-start-btn')?.addEventListener('click', () => this.executeCompression());

    // Botón de descargar comprimido
    document.getElementById('compressor-download-btn')?.addEventListener('click', () => this.downloadCompressed());
  }

  async loadFile(file) {
    this.currentFile = file;
    window.appState.compressor.file = file;
    window.appState.compressor.originalSize = file.size;

    this.originalBuffer = await file.arrayBuffer();

    // Actualizar UI
    document.getElementById('compressor-empty-state')?.classList.add('hidden');
    document.getElementById('compressor-controls')?.classList.remove('hidden');
    document.getElementById('compressor-results')?.classList.add('hidden');

    const fileNameEl = document.getElementById('compressor-file-name');
    const origSizeEl = document.getElementById('compressor-orig-size');
    if (fileNameEl) fileNameEl.textContent = file.name;
    if (origSizeEl) origSizeEl.textContent = this.formatBytes(file.size);

    window.showToast(`Archivo cargado: ${file.name} (${this.formatBytes(file.size)})`, 'info');
  }

  async executeCompression() {
    if (!this.originalBuffer) {
      window.showToast('Primero carga un archivo PDF.', 'warning');
      return;
    }

    window.showLoading(true, 'Optimizando y recomprimiendo páginas...');
    const progressEl = document.getElementById('compressor-progress-bar');
    const progressPercent = document.getElementById('compressor-progress-percent');

    try {
      const pdfJsDoc = await pdfjsLib.getDocument({ data: new Uint8Array(this.originalBuffer) }).promise;
      const totalPages = pdfJsDoc.numPages;

      const newPdf = await PDFLib.PDFDocument.create();
      const quality = window.appState.compressor.quality || 0.65;
      const renderScale = window.appState.compressor.scaleDpi || 1.2;

      for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
        // Actualizar barra de progreso
        const percent = Math.round((pageNum / totalPages) * 100);
        if (progressEl) progressEl.style.width = `${percent}%`;
        if (progressPercent) progressPercent.textContent = `${percent}% (${pageNum}/${totalPages})`;

        const page = await pdfJsDoc.getPage(pageNum);
        const origViewport = page.getViewport({ scale: 1.0 });
        const scaleViewport = page.getViewport({ scale: renderScale });

        const canvas = document.createElement('canvas');
        canvas.width = scaleViewport.width;
        canvas.height = scaleViewport.height;
        const ctx = canvas.getContext('2d');

        await page.render({ canvasContext: ctx, viewport: scaleViewport }).promise;

        // Recompresión adaptativa en JPEG de alta eficiencia
        const jpegDataUrl = canvas.toDataURL('image/jpeg', quality);
        const imgBytes = await fetch(jpegDataUrl).then(r => r.arrayBuffer());

        const embeddedJpg = await newPdf.embedJpg(imgBytes);

        // Crear página con las dimensiones físicas originales
        const newPage = newPdf.addPage([origViewport.width, origViewport.height]);
        newPage.drawImage(embeddedJpg, {
          x: 0,
          y: 0,
          width: origViewport.width,
          height: origViewport.height
        });
      }

      const compressedBytes = await newPdf.save({ useObjectStreams: true });
      this.compressedBlob = new Blob([compressedBytes], { type: 'application/pdf' });
      window.appState.compressor.compressedSize = this.compressedBlob.size;

      this.showResults();
      window.showToast('Compresión finalizada con éxito.', 'success');
    } catch (err) {
      console.error('Error al comprimir PDF:', err);
      window.showToast('Ocurrió un error durante la compresión: ' + err.message, 'error');
    } finally {
      window.showLoading(false);
    }
  }

  showResults() {
    const resultsContainer = document.getElementById('compressor-results');
    if (!resultsContainer) return;

    resultsContainer.classList.remove('hidden');

    const origSize = window.appState.compressor.originalSize;
    const compSize = window.appState.compressor.compressedSize;
    const diff = origSize - compSize;
    const pctSavings = Math.round((diff / origSize) * 100);

    document.getElementById('res-orig-size').textContent = this.formatBytes(origSize);
    document.getElementById('res-comp-size').textContent = this.formatBytes(compSize);

    const savingsBadge = document.getElementById('res-savings-badge');
    if (savingsBadge) {
      if (pctSavings > 0) {
        savingsBadge.className = 'text-emerald-400 font-bold text-lg';
        savingsBadge.textContent = `-${pctSavings}% Ahorro`;
      } else {
        savingsBadge.className = 'text-amber-400 font-bold text-lg';
        savingsBadge.textContent = 'Optimizado';
      }
    }
  }

  downloadCompressed() {
    if (!this.compressedBlob) return;

    const url = URL.createObjectURL(this.compressedBlob);
    const a = document.createElement('a');
    a.href = url;
    const baseName = this.currentFile?.name?.replace(/\.pdf$/i, '') || 'documento';
    a.download = `${baseName}_comprimido.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    window.showToast('Descarga iniciada.', 'success');
  }

  formatBytes(bytes, decimals = 2) {
    if (!+bytes) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
  }
}

window.compressorModule = new CompressorModule();

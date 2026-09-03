/**
 * PDF Editor - Gestor de Estado Global del Documento (Acrobat Style)
 * Mantiene en memoria el archivo activo, páginas, anotaciones y herramientas.
 */

class DocumentState {
  constructor() {
    this.hasDocument = false;
    this.name = 'Sin título.pdf';
    this.size = 0;
    this.buffer = null;
    this.pdfLibDoc = null;
    this.pdfJsDoc = null;
    this.currentPage = 1;
    this.totalPages = 0;
    this.zoom = 1.0; // 50% a 180%
    
    // Lista de páginas { id, pageNum, rotation, width, height, thumbnailDataUrl }
    this.pages = [];

    // Herramienta activa: 'select', 'hand', 'text', 'pencil', 'highlighter', 'eraser', 'rect'
    this.activeTool = 'select';
    this.activeRibbonTab = 'edit'; // 'edit', 'sign', 'pages', 'ocr', 'tools'

    // Propiedades de estilo para herramientas
    this.properties = {
      color: '#ef4444',
      highlighterColor: '#facc15',
      lineWidth: 3,
      highlighterWidth: 18,
      opacity: 1.0,
      fontSize: 16,
      fontFamily: 'Arial, sans-serif',
      textColor: '#0f172a'
    };

    // Almacén de anotaciones por página: pageNum -> { strokes: [], texts: [], stamps: [] }
    this.annotations = {};

    // Pilas de Deshacer / Rehacer
    this.undoStack = [];
    this.redoStack = [];

    // Estado OCR y Compresión
    this.ocr = {
      language: 'spa+eng',
      status: '',
      progress: 0,
      text: ''
    };

    this.compression = {
      quality: 0.65,
      scaleDpi: 1.2,
      originalSize: 0,
      estimatedSize: 0
    };

    this.listeners = new Map();
  }

  on(event, cb) {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event).push(cb);
  }

  emit(event, data) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).forEach(cb => cb(data));
    }
  }

  setTool(tool) {
    this.activeTool = tool;
    this.emit('toolChanged', tool);
  }

  setRibbonTab(tab) {
    this.activeRibbonTab = tab;
    this.emit('ribbonTabChanged', tab);
  }

  setZoom(zoom) {
    const clamped = Math.min(1.8, Math.max(0.5, zoom));
    this.zoom = Math.round(clamped * 100) / 100;
    this.emit('zoomChanged', this.zoom);
    return this.zoom;
  }

  zoomIn() { return this.setZoom(this.zoom + 0.1); }
  zoomOut() { return this.setZoom(this.zoom - 0.1); }
  resetZoom() { return this.setZoom(1.0); }

  initPageAnnotations(pageNum) {
    if (!this.annotations[pageNum]) {
      this.annotations[pageNum] = {
        strokes: [],
        texts: [],
        stamps: []
      };
    }
    return this.annotations[pageNum];
  }

  pushUndo(action) {
    this.undoStack.push(action);
    this.redoStack = []; // limpiar redo al hacer nueva acción
    this.emit('historyChanged', { canUndo: true, canRedo: false });
  }

  undo() {
    if (window.unifiedApp && typeof window.unifiedApp.undo === 'function') {
      window.unifiedApp.undo();
    }
  }

  redo() {
    if (window.unifiedApp && typeof window.unifiedApp.redo === 'function') {
      window.unifiedApp.redo();
    }
  }
}

window.docState = new DocumentState();
// Mantener alias de compatibilidad
window.appState = window.docState;

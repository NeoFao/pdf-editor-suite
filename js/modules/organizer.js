/**
 * PDF Editor - Módulo 1: Organizador y Gestor de Páginas
 * Fusión, división por rangos, rotación 90°/180°, reordenación drag-and-drop y eliminación.
 * Desarrollado con pdf-lib y pdf.js para renderizado de alta velocidad en cliente.
 */

class OrganizerModule {
  constructor() {
    this.container = null;
    this.sortableInstance = null;
  }

  init() {
    this.container = document.getElementById('organizer-module');
    this.setupEventListeners();
  }

  setupEventListeners() {
    const dropzone = document.getElementById('organizer-dropzone');
    const fileInput = document.getElementById('organizer-file-input');

    if (!dropzone || !fileInput) return;

    dropzone.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', async (e) => {
      if (e.target.files && e.target.files.length > 0) {
        await this.handleFiles(Array.from(e.target.files));
        fileInput.value = '';
      }
    });

    // Drag & drop en la zona de carga
    ['dragenter', 'dragover'].forEach(eventName => {
      dropzone.addEventListener(eventName, (e) => {
        e.preventDefault();
        dropzone.classList.add('dragover');
      });
    });

    ['dragleave', 'drop'].forEach(eventName => {
      dropzone.addEventListener(eventName, (e) => {
        e.preventDefault();
        dropzone.classList.remove('dragover');
      });
    });

    dropzone.addEventListener('drop', async (e) => {
      const files = Array.from(e.dataTransfer.files).filter(f => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
      if (files.length > 0) {
        await this.handleFiles(files);
      } else {
        window.showToast('Por favor, selecciona archivos PDF válidos.', 'warning');
      }
    });

    // Botones de acción rápida
    document.getElementById('organizer-btn-rotate-cw')?.addEventListener('click', () => this.rotateSelected(90));
    document.getElementById('organizer-btn-rotate-ccw')?.addEventListener('click', () => this.rotateSelected(-90));
    document.getElementById('organizer-btn-select-all')?.addEventListener('click', () => this.toggleSelectAll());
    document.getElementById('organizer-btn-delete-selected')?.addEventListener('click', () => this.deleteSelected());
    document.getElementById('organizer-btn-export-merged')?.addEventListener('click', () => this.exportMergedPDF());
    document.getElementById('organizer-btn-split-range')?.addEventListener('click', () => this.splitByRangeDialog());
    document.getElementById('organizer-btn-clear')?.addEventListener('click', () => this.clearAll());
  }

  async handleFiles(files) {
    window.showLoading(true, 'Cargando y procesando páginas PDF...');
    try {
      for (const file of files) {
        const buffer = await file.arrayBuffer();
        const fileId = 'f_' + Math.random().toString(36).substring(2, 9);

        // Cargar documento en pdf-lib
        const pdfLibDoc = await PDFLib.PDFDocument.load(buffer, { ignoreEncryption: true });
        
        // Cargar documento en pdf.js para miniaturas
        const pdfJsDoc = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
        const pageCount = pdfJsDoc.numPages;

        const fileRecord = {
          id: fileId,
          name: file.name,
          size: file.size,
          buffer: buffer,
          pdfLibDoc: pdfLibDoc,
          pageCount: pageCount
        };
        window.appState.organizer.files.push(fileRecord);

        // Generar miniaturas para cada página
        for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
          const pageId = `p_${fileId}_${pageNum}`;
          const page = await pdfJsDoc.getPage(pageNum);
          const viewport = page.getViewport({ scale: 0.35 });

          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          canvas.width = viewport.width;
          canvas.height = viewport.height;

          await page.render({ canvasContext: ctx, viewport: viewport }).promise;
          const thumbnailDataUrl = canvas.toDataURL('image/jpeg', 0.85);

          window.appState.organizer.pages.push({
            id: pageId,
            fileId: fileId,
            fileName: file.name,
            pageIndex: pageNum - 1,
            displayNum: pageNum,
            rotation: 0,
            thumbnailDataUrl: thumbnailDataUrl,
            width: viewport.width,
            height: viewport.height
          });
        }
      }

      this.renderPagesGrid();
      window.showToast(`Se cargaron ${files.length} documento(s) correctamente.`, 'success');
    } catch (err) {
      console.error('Error al procesar PDF en Organizador:', err);
      window.showToast('Error al leer el archivo PDF. Asegúrate de que no esté protegido por contraseña restrictiva.', 'error');
    } finally {
      window.showLoading(false);
    }
  }

  renderPagesGrid() {
    const grid = document.getElementById('organizer-pages-grid');
    const emptyState = document.getElementById('organizer-empty-state');
    const toolbar = document.getElementById('organizer-toolbar');
    const pageCountBadge = document.getElementById('organizer-page-count');

    if (!grid) return;

    if (window.appState.organizer.pages.length === 0) {
      grid.innerHTML = '';
      if (emptyState) emptyState.classList.remove('hidden');
      if (toolbar) toolbar.classList.add('hidden');
      return;
    }

    if (emptyState) emptyState.classList.add('hidden');
    if (toolbar) toolbar.classList.remove('hidden');
    if (pageCountBadge) pageCountBadge.textContent = `${window.appState.organizer.pages.length} páginas`;

    grid.innerHTML = '';

    window.appState.organizer.pages.forEach((page, index) => {
      const card = document.createElement('div');
      card.className = `thumb-card glass-panel rounded-lg p-3 relative select-none flex flex-col items-center justify-between border ${window.appState.organizer.selectedPages.has(page.id) ? 'selected border-indigo-500 ring-2 ring-indigo-500/50' : 'border-slate-800'}`;
      card.setAttribute('data-id', page.id);
      card.setAttribute('data-index', index);

      card.innerHTML = `
        <div class="w-full flex items-center justify-between mb-2 text-xs text-slate-400">
          <span class="font-semibold text-slate-200">#${index + 1}</span>
          <span class="truncate max-w-[110px] text-slate-400" title="${page.fileName}">${page.fileName}</span>
          <input type="checkbox" class="page-checkbox rounded text-indigo-600 bg-slate-800 border-slate-700" ${window.appState.organizer.selectedPages.has(page.id) ? 'checked' : ''} />
        </div>
        <div class="thumbnail-wrapper relative w-full h-44 flex items-center justify-center overflow-hidden bg-slate-900/60 rounded border border-slate-800">
          <img src="${page.thumbnailDataUrl}" 
               class="max-h-full max-w-full object-contain transition-transform duration-200 pointer-events-none" 
               style="transform: rotate(${page.rotation}deg);" 
               alt="Página ${index + 1}" />
        </div>
        <div class="w-full flex items-center justify-between mt-3 pt-2 border-t border-slate-800/80 text-xs">
          <button type="button" class="btn-rot-cw text-slate-400 hover:text-indigo-400 p-1" title="Rotar 90° horario">
            <i class="fa-solid fa-rotate-right"></i>
          </button>
          <button type="button" class="btn-duplicate text-slate-400 hover:text-cyan-400 p-1" title="Duplicar página">
            <i class="fa-solid fa-copy"></i>
          </button>
          <button type="button" class="btn-preview-page text-slate-400 hover:text-emerald-400 p-1" title="Vista previa ampliada">
            <i class="fa-solid fa-eye"></i>
          </button>
          <button type="button" class="btn-delete text-slate-400 hover:text-rose-400 p-1" title="Eliminar página">
            <i class="fa-solid fa-trash-can"></i>
          </button>
        </div>
      `;

      // Eventos de selección de tarjeta
      const checkbox = card.querySelector('.page-checkbox');
      checkbox.addEventListener('click', (e) => {
        e.stopPropagation();
        this.togglePageSelection(page.id);
      });

      card.addEventListener('click', (e) => {
        if (!e.target.closest('button')) {
          this.togglePageSelection(page.id);
        }
      });

      // Botones de acción individual
      card.querySelector('.btn-rot-cw').addEventListener('click', (e) => {
        e.stopPropagation();
        this.rotatePage(page.id, 90);
      });

      card.querySelector('.btn-duplicate').addEventListener('click', (e) => {
        e.stopPropagation();
        this.duplicatePage(index);
      });

      card.querySelector('.btn-preview-page').addEventListener('click', (e) => {
        e.stopPropagation();
        this.previewSinglePage(page);
      });

      card.querySelector('.btn-delete').addEventListener('click', (e) => {
        e.stopPropagation();
        this.deletePage(index);
      });

      grid.appendChild(card);
    });

    // Inicializar o actualizar SortableJS para drag-and-drop
    if (window.Sortable) {
      if (this.sortableInstance) {
        this.sortableInstance.destroy();
      }
      this.sortableInstance = new Sortable(grid, {
        animation: 180,
        ghostClass: 'sortable-ghost',
        chosenClass: 'sortable-chosen',
        handle: '.thumbnail-wrapper',
        onEnd: (evt) => {
          const item = window.appState.organizer.pages.splice(evt.oldIndex, 1)[0];
          window.appState.organizer.pages.splice(evt.newIndex, 0, item);
          this.renderPagesGrid();
        }
      });
    }
  }

  togglePageSelection(pageId) {
    if (window.appState.organizer.selectedPages.has(pageId)) {
      window.appState.organizer.selectedPages.delete(pageId);
    } else {
      window.appState.organizer.selectedPages.add(pageId);
    }
    this.renderPagesGrid();
  }

  toggleSelectAll() {
    const total = window.appState.organizer.pages.length;
    if (window.appState.organizer.selectedPages.size === total) {
      window.appState.organizer.selectedPages.clear();
    } else {
      window.appState.organizer.selectedPages.clear();
      window.appState.organizer.pages.forEach(p => window.appState.organizer.selectedPages.add(p.id));
    }
    this.renderPagesGrid();
  }

  rotatePage(pageId, deg) {
    const page = window.appState.organizer.pages.find(p => p.id === pageId);
    if (page) {
      page.rotation = (page.rotation + deg) % 360;
      if (page.rotation < 0) page.rotation += 360;
      this.renderPagesGrid();
    }
  }

  rotateSelected(deg) {
    const selected = window.appState.organizer.selectedPages;
    if (selected.size === 0) {
      window.showToast('Selecciona al menos una página para rotar.', 'info');
      return;
    }
    window.appState.organizer.pages.forEach(p => {
      if (selected.has(p.id)) {
        p.rotation = (p.rotation + deg) % 360;
        if (p.rotation < 0) p.rotation += 360;
      }
    });
    this.renderPagesGrid();
    window.showToast(`Se rotaron ${selected.size} página(s).`, 'success');
  }

  duplicatePage(index) {
    const target = window.appState.organizer.pages[index];
    if (!target) return;

    const duplicated = {
      ...target,
      id: `p_${target.fileId}_copy_${Math.random().toString(36).substring(2, 7)}`,
      fileName: `${target.fileName} (Copia)`
    };

    window.appState.organizer.pages.splice(index + 1, 0, duplicated);
    this.renderPagesGrid();
    window.showToast('Página duplicada con éxito.', 'success');
  }

  deletePage(index) {
    const removed = window.appState.organizer.pages.splice(index, 1)[0];
    if (removed) {
      window.appState.organizer.selectedPages.delete(removed.id);
      this.renderPagesGrid();
      window.showToast('Página eliminada.', 'info');
    }
  }

  deleteSelected() {
    const selected = window.appState.organizer.selectedPages;
    if (selected.size === 0) {
      window.showToast('Selecciona al menos una página para eliminar.', 'info');
      return;
    }
    window.appState.organizer.pages = window.appState.organizer.pages.filter(p => !selected.has(p.id));
    selected.clear();
    this.renderPagesGrid();
    window.showToast('Páginas seleccionadas eliminadas.', 'info');
  }

  previewSinglePage(page) {
    const modalImg = document.getElementById('preview-modal-img');
    const modal = document.getElementById('image-preview-modal');
    if (modalImg && modal) {
      modalImg.src = page.thumbnailDataUrl;
      modalImg.style.transform = `rotate(${page.rotation}deg)`;
      modal.classList.remove('hidden');
    }
  }

  clearAll() {
    if (window.appState.organizer.pages.length === 0) return;
    if (confirm('¿Estás seguro de que deseas limpiar todas las páginas cargadas?')) {
      window.appState.organizer.files = [];
      window.appState.organizer.pages = [];
      window.appState.organizer.selectedPages.clear();
      this.renderPagesGrid();
      window.showToast('Organizador reiniciado.', 'info');
    }
  }

  async exportMergedPDF() {
    const pages = window.appState.organizer.pages;
    if (pages.length === 0) {
      window.showToast('No hay páginas para exportar.', 'warning');
      return;
    }

    window.showLoading(true, 'Generando y fusionando documento PDF...');
    try {
      const mergedPdf = await PDFLib.PDFDocument.create();

      // Mapa de documentos cargados en memoria por ID
      const fileDocMap = new Map();
      for (const f of window.appState.organizer.files) {
        fileDocMap.set(f.id, f.pdfLibDoc);
      }

      for (const p of pages) {
        const srcDoc = fileDocMap.get(p.fileId);
        if (!srcDoc) continue;

        const [copiedPage] = await mergedPdf.copyPages(srcDoc, [p.pageIndex]);

        // Aplicar rotación acumulada
        if (p.rotation !== 0) {
          const currentRot = copiedPage.getRotation().angle;
          copiedPage.setRotation(PDFLib.degrees((currentRot + p.rotation) % 360));
        }

        mergedPdf.addPage(copiedPage);
      }

      const pdfBytes = await mergedPdf.save();
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      a.download = `Documento_Organizado_${Date.now()}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      window.showToast('PDF exportado y descargado exitosamente.', 'success');
    } catch (err) {
      console.error('Error al exportar PDF:', err);
      window.showToast('Ocurrió un error al fusionar el PDF: ' + err.message, 'error');
    } finally {
      window.showLoading(false);
    }
  }

  splitByRangeDialog() {
    const total = window.appState.organizer.pages.length;
    if (total === 0) {
      window.showToast('Carga un PDF primero para dividirlo.', 'warning');
      return;
    }

    const rangeInput = prompt(
      `Ingresa los rangos o números de páginas a extraer separados por comas.\nEjemplo: 1-3, 5, 8-${total}\n(Total de páginas actuales: ${total})`
    );

    if (!rangeInput) return;

    const indices = this.parseRange(rangeInput, total);
    if (indices.length === 0) {
      window.showToast('Rango de páginas no válido.', 'error');
      return;
    }

    this.extractPagesToNewPDF(indices);
  }

  parseRange(rangeStr, maxPages) {
    const indices = new Set();
    const parts = rangeStr.split(',');

    for (let part of parts) {
      part = part.trim();
      if (part.includes('-')) {
        const [startStr, endStr] = part.split('-');
        const start = parseInt(startStr, 10);
        const end = parseInt(endStr, 10);
        if (!isNaN(start) && !isNaN(end)) {
          const min = Math.max(1, Math.min(start, end));
          const max = Math.min(maxPages, Math.max(start, end));
          for (let i = min; i <= max; i++) {
            indices.add(i - 1);
          }
        }
      } else {
        const pageNum = parseInt(part, 10);
        if (!isNaN(pageNum) && pageNum >= 1 && pageNum <= maxPages) {
          indices.add(pageNum - 1);
        }
      }
    }

    return Array.from(indices).sort((a, b) => a - b);
  }

  async extractPagesToNewPDF(selectedIndices) {
    window.showLoading(true, 'Extrayendo páginas seleccionadas...');
    try {
      const splitPdf = await PDFLib.PDFDocument.create();
      const fileDocMap = new Map();
      for (const f of window.appState.organizer.files) {
        fileDocMap.set(f.id, f.pdfLibDoc);
      }

      for (const idx of selectedIndices) {
        const pageInfo = window.appState.organizer.pages[idx];
        if (!pageInfo) continue;

        const srcDoc = fileDocMap.get(pageInfo.fileId);
        if (!srcDoc) continue;

        const [copiedPage] = await splitPdf.copyPages(srcDoc, [pageInfo.pageIndex]);
        if (pageInfo.rotation !== 0) {
          const currentRot = copiedPage.getRotation().angle;
          copiedPage.setRotation(PDFLib.degrees((currentRot + pageInfo.rotation) % 360));
        }
        splitPdf.addPage(copiedPage);
      }

      const pdfBytes = await splitPdf.save();
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      a.download = `PDF_Extraido_Paginas_${selectedIndices.map(i => i + 1).join('_')}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      window.showToast(`Se extrajeron ${selectedIndices.length} páginas exitosamente.`, 'success');
    } catch (err) {
      console.error('Error al extraer páginas:', err);
      window.showToast('Error al dividir el documento.', 'error');
    } finally {
      window.showLoading(false);
    }
  }
}

window.organizerModule = new OrganizerModule();

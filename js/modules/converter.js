/**
 * PDF Editor - Módulo 5: Conversor Multiformato
 * 1. Word (.docx) a PDF (docx-preview + html2pdf.js)
 * 2. Imágenes (PNG/JPG/WebP) a PDF (pdf-lib)
 * 3. PDF a Markdown (.md) con reconstrucción geométrica 2D (pdfjsLib)
 * 4. Markdown (.md) a PDF con fórmulas KaTeX y resaltado de código sintáctico
 */

class ConverterModule {
  constructor() {
    this.uploadedImages = [];
    this.currentDocxBuffer = null;
    this.currentPdfBuffer = null;
  }

  init() {
    this.setupTabs();
    this.setupWordToPdf();
    this.setupImagesToPdf();
    this.setupPdfToMarkdown();
    this.setupMarkdownToPdf();
  }

  setupTabs() {
    const tabs = document.querySelectorAll('[data-converter-tab]');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const target = tab.getAttribute('data-converter-tab');
        window.appState.converter.activeTab = target;

        tabs.forEach(t => {
          if (t === tab) {
            t.classList.add('bg-indigo-600', 'text-white');
            t.classList.remove('bg-slate-800', 'text-slate-400');
          } else {
            t.classList.remove('bg-indigo-600', 'text-white');
            t.classList.add('bg-slate-800', 'text-slate-400');
          }
        });

        document.querySelectorAll('.converter-section').forEach(sec => {
          if (sec.id === `converter-${target}-sec`) {
            sec.classList.remove('hidden');
          } else {
            sec.classList.add('hidden');
          }
        });
      });
    });
  }

  /* ==================== 1. WORD (.docx) A PDF ==================== */

  setupWordToPdf() {
    const fileInput = document.getElementById('converter-docx-input');
    const dropzone = document.getElementById('converter-docx-dropzone');
    const convertBtn = document.getElementById('converter-docx-btn');

    dropzone?.addEventListener('click', () => fileInput.click());

    fileInput?.addEventListener('change', async (e) => {
      if (e.target.files && e.target.files[0]) {
        await this.handleDocxFile(e.target.files[0]);
      }
    });

    ['dragenter', 'dragover'].forEach(ev => {
      dropzone?.addEventListener(ev, (e) => {
        e.preventDefault();
        dropzone.classList.add('dragover');
      });
    });

    ['dragleave', 'drop'].forEach(ev => {
      dropzone?.addEventListener(ev, (e) => {
        e.preventDefault();
        dropzone.classList.remove('dragover');
      });
    });

    dropzone?.addEventListener('drop', async (e) => {
      const file = Array.from(e.dataTransfer.files).find(f => f.name.toLowerCase().endsWith('.docx'));
      if (file) {
        await this.handleDocxFile(file);
      } else {
        window.showToast('Por favor, arrastra un archivo Word .docx válido.', 'warning');
      }
    });

    convertBtn?.addEventListener('click', () => this.exportDocxToPdf());
  }

  async handleDocxFile(file) {
    window.showLoading(true, 'Renderizando documento Word con docx-preview...');
    try {
      this.currentDocxBuffer = await file.arrayBuffer();
      const previewContainer = document.getElementById('converter-docx-preview');
      if (previewContainer && window.docx) {
        previewContainer.innerHTML = '';
        await window.docx.renderAsync(this.currentDocxBuffer, previewContainer, null, {
          className: 'docx',
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: false
        });

        document.getElementById('converter-docx-preview-wrapper')?.classList.remove('hidden');
        document.getElementById('converter-docx-actions')?.classList.remove('hidden');
        window.showToast(`Documento Word ${file.name} cargado con fidelidad tipográfica.`, 'success');
      }
    } catch (err) {
      console.error('Error al renderizar docx:', err);
      window.showToast('Error al renderizar el archivo Word: ' + err.message, 'error');
    } finally {
      window.showLoading(false);
    }
  }

  async exportDocxToPdf() {
    const previewContainer = document.getElementById('converter-docx-preview');
    if (!previewContainer) return;

    window.showLoading(true, 'Generando PDF de alta resolución desde Word...');
    try {
      const opt = {
        margin: [10, 10, 10, 10],
        filename: `Word_Convertido_${Date.now()}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, letterRendering: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
      };

      await html2pdf().set(opt).from(previewContainer).save();
      window.showToast('PDF generado y descargado con éxito.', 'success');
    } catch (err) {
      console.error('Error al convertir Word a PDF:', err);
      window.showToast('Error al exportar a PDF.', 'error');
    } finally {
      window.showLoading(false);
    }
  }

  /* ==================== 2. IMÁGENES A PDF ==================== */

  setupImagesToPdf() {
    const fileInput = document.getElementById('converter-img-input');
    const dropzone = document.getElementById('converter-img-dropzone');
    const convertBtn = document.getElementById('converter-img-btn');

    dropzone?.addEventListener('click', () => fileInput.click());

    fileInput?.addEventListener('change', (e) => {
      if (e.target.files && e.target.files.length > 0) {
        this.handleImageFiles(Array.from(e.target.files));
        fileInput.value = '';
      }
    });

    ['dragenter', 'dragover'].forEach(ev => {
      dropzone?.addEventListener(ev, (e) => {
        e.preventDefault();
        dropzone.classList.add('dragover');
      });
    });

    ['dragleave', 'drop'].forEach(ev => {
      dropzone?.addEventListener(ev, (e) => {
        e.preventDefault();
        dropzone.classList.remove('dragover');
      });
    });

    dropzone?.addEventListener('drop', (e) => {
      const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
      if (files.length > 0) {
        this.handleImageFiles(files);
      }
    });

    convertBtn?.addEventListener('click', () => this.exportImagesToPdf());
  }

  handleImageFiles(files) {
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = (e) => {
        this.uploadedImages.push({
          id: 'img_' + Math.random().toString(36).substring(2, 7),
          name: file.name,
          type: file.type,
          dataUrl: e.target.result
        });
        this.renderImageGrid();
      };
      reader.readAsDataURL(file);
    });
  }

  renderImageGrid() {
    const grid = document.getElementById('converter-img-grid');
    const actions = document.getElementById('converter-img-actions');
    if (!grid) return;

    grid.innerHTML = '';
    if (this.uploadedImages.length === 0) {
      if (actions) actions.classList.add('hidden');
      return;
    }

    if (actions) actions.classList.remove('hidden');

    this.uploadedImages.forEach((item, index) => {
      const card = document.createElement('div');
      card.className = 'glass-panel rounded-lg p-2 relative flex flex-col items-center border border-slate-800';
      card.innerHTML = `
        <span class="absolute top-1 left-2 text-xs font-bold text-slate-300">#${index + 1}</span>
        <button type="button" class="absolute top-1 right-2 text-rose-400 hover:text-rose-300 text-xs p-1" title="Quitar">
          <i class="fa-solid fa-xmark"></i>
        </button>
        <img src="${item.dataUrl}" class="w-full h-32 object-contain rounded mt-4" alt="${item.name}" />
        <span class="text-xs text-slate-400 truncate w-full mt-2 text-center" title="${item.name}">${item.name}</span>
      `;

      card.querySelector('button').addEventListener('click', (e) => {
        e.stopPropagation();
        this.uploadedImages.splice(index, 1);
        this.renderImageGrid();
      });

      grid.appendChild(card);
    });
  }

  async exportImagesToPdf() {
    if (this.uploadedImages.length === 0) {
      window.showToast('No hay imágenes cargadas.', 'warning');
      return;
    }

    window.showLoading(true, 'Generando PDF a partir de imágenes...');
    try {
      const pdfDoc = await PDFLib.PDFDocument.create();
      const marginSelect = document.getElementById('converter-img-margin');
      const marginVal = marginSelect ? parseInt(marginSelect.value, 10) : 20;

      for (const item of this.uploadedImages) {
        const imgBytes = await fetch(item.dataUrl).then(r => r.arrayBuffer());
        let embeddedImg;
        if (item.type === 'image/png') {
          embeddedImg = await pdfDoc.embedPng(imgBytes);
        } else {
          embeddedImg = await pdfDoc.embedJpg(imgBytes);
        }

        const imgDims = embeddedImg.scale(1.0);
        // Página con dimensiones de la imagen más márgenes
        const pageWidth = imgDims.width + (marginVal * 2);
        const pageHeight = imgDims.height + (marginVal * 2);

        const page = pdfDoc.addPage([pageWidth, pageHeight]);
        page.drawImage(embeddedImg, {
          x: marginVal,
          y: marginVal,
          width: imgDims.width,
          height: imgDims.height
        });
      }

      const pdfBytes = await pdfDoc.save();
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      a.download = `Imagenes_A_PDF_${Date.now()}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      window.showToast('PDF de imágenes creado y descargado.', 'success');
    } catch (err) {
      console.error('Error al convertir imágenes a PDF:', err);
      window.showToast('Error al procesar imágenes: ' + err.message, 'error');
    } finally {
      window.showLoading(false);
    }
  }

  /* ==================== 3. PDF A MARKDOWN (.md) CON GEOMETRÍA 2D ==================== */

  setupPdfToMarkdown() {
    const fileInput = document.getElementById('converter-pdfmd-input');
    const dropzone = document.getElementById('converter-pdfmd-dropzone');
    const copyBtn = document.getElementById('converter-pdfmd-copy');
    const downloadBtn = document.getElementById('converter-pdfmd-download');

    dropzone?.addEventListener('click', () => fileInput.click());

    fileInput?.addEventListener('change', async (e) => {
      if (e.target.files && e.target.files[0]) {
        await this.convertPdfToMarkdown(e.target.files[0]);
      }
    });

    ['dragenter', 'dragover'].forEach(ev => {
      dropzone?.addEventListener(ev, (e) => {
        e.preventDefault();
        dropzone.classList.add('dragover');
      });
    });

    ['dragleave', 'drop'].forEach(ev => {
      dropzone?.addEventListener(ev, (e) => {
        e.preventDefault();
        dropzone.classList.remove('dragover');
      });
    });

    dropzone?.addEventListener('drop', async (e) => {
      const file = Array.from(e.dataTransfer.files).find(f => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
      if (file) {
        await this.convertPdfToMarkdown(file);
      }
    });

    copyBtn?.addEventListener('click', () => {
      const text = document.getElementById('converter-pdfmd-output')?.value;
      if (text) {
        navigator.clipboard.writeText(text).then(() => window.showToast('Markdown copiado.', 'success'));
      }
    });

    downloadBtn?.addEventListener('click', () => {
      const text = document.getElementById('converter-pdfmd-output')?.value;
      if (!text) return;
      const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Documento_Convertido_${Date.now()}.md`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      window.showToast('Archivo Markdown descargado.', 'success');
    });
  }

  async convertPdfToMarkdown(file) {
    window.showLoading(true, 'Extrayendo estructura geométrica 2D del PDF...');
    try {
      const buffer = await file.arrayBuffer();
      const pdfDoc = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
      const numPages = pdfDoc.numPages;

      let markdownOutput = `# ${file.name.replace(/\.pdf$/i, '')}\n\n`;

      for (let i = 1; i <= numPages; i++) {
        const page = await pdfDoc.getPage(i);
        const textContent = await page.getTextContent();
        const items = textContent.items;

        if (!items || items.length === 0) continue;

        // Calcular tamaño de fuente promedio para inferir jerarquía de títulos
        const fontSizes = items.map(it => Math.abs(it.transform[0] || it.height || 10));
        fontSizes.sort((a, b) => a - b);
        const medianFontSize = fontSizes[Math.floor(fontSizes.length / 2)] || 11;

        // Agrupar elementos en líneas según coordenada Y geométrica (tolerancia ~3.5px)
        const lineMap = new Map();
        items.forEach(item => {
          if (!item.str || item.str.trim() === '') return;
          const y = Math.round(item.transform[5] / 4) * 4;
          if (!lineMap.has(y)) {
            lineMap.set(y, []);
          }
          lineMap.get(y).push({
            str: item.str,
            x: item.transform[4],
            fontSize: Math.abs(item.transform[0] || item.height || 10)
          });
        });

        // Ordenar líneas de arriba hacia abajo (en PDF, Y mayor está arriba)
        const sortedY = Array.from(lineMap.keys()).sort((a, b) => b - a);

        let pageMarkdown = `\n<!-- Página ${i} -->\n\n`;

        sortedY.forEach(y => {
          const lineItems = lineMap.get(y);
          // Ordenar palabras de izquierda a derecha (coordenada X)
          lineItems.sort((a, b) => a.x - b.x);

          const maxFontSizeInLine = Math.max(...lineItems.map(it => it.fontSize));
          const lineText = lineItems.map(it => it.str).join(' ').trim();

          if (!lineText) return;

          // Detección de posibles tablas (elementos con separación de columnas amplia)
          const hasWideGaps = lineItems.length >= 3 && lineItems.some((it, idx) => {
            if (idx === 0) return false;
            return (it.x - lineItems[idx - 1].x) > 100;
          });

          if (hasWideGaps) {
            // Formatear como fila de tabla
            pageMarkdown += `| ${lineItems.map(it => it.str.trim()).join(' | ')} |\n`;
          } else if (maxFontSizeInLine > medianFontSize * 1.6) {
            // Título H1
            pageMarkdown += `\n# ${lineText}\n\n`;
          } else if (maxFontSizeInLine > medianFontSize * 1.3) {
            // Subtítulo H2
            pageMarkdown += `\n## ${lineText}\n\n`;
          } else if (maxFontSizeInLine > medianFontSize * 1.15) {
            // Encabezado H3
            pageMarkdown += `\n### ${lineText}\n\n`;
          } else {
            // Párrafo normal
            pageMarkdown += `${lineText}\n\n`;
          }
        });

        markdownOutput += pageMarkdown;
      }

      const outputEl = document.getElementById('converter-pdfmd-output');
      if (outputEl) outputEl.value = markdownOutput;
      document.getElementById('converter-pdfmd-result')?.classList.remove('hidden');
      window.showToast('Conversión a Markdown estructurado completada.', 'success');
    } catch (err) {
      console.error('Error en PDF a Markdown:', err);
      window.showToast('Error al convertir PDF a Markdown: ' + err.message, 'error');
    } finally {
      window.showLoading(false);
    }
  }

  /* ==================== 4. MARKDOWN A PDF CON KATEX Y RESALTADO ==================== */

  setupMarkdownToPdf() {
    const editor = document.getElementById('converter-md-editor');
    const preview = document.getElementById('converter-md-preview');
    const exportBtn = document.getElementById('converter-md-export-btn');

    if (editor) {
      editor.value = window.appState.converter.markdownContent;
      editor.addEventListener('input', () => {
        this.renderMarkdownLivePreview();
      });
    }

    exportBtn?.addEventListener('click', () => this.exportMarkdownToPdf());

    // Renderizado inicial
    this.renderMarkdownLivePreview();
  }

  renderMarkdownLivePreview() {
    const editor = document.getElementById('converter-md-editor');
    const preview = document.getElementById('converter-md-preview');
    if (!editor || !preview) return;

    let content = editor.value;

    // Procesar expresiones matemáticas KaTeX antes de marked
    // Fórmulas en bloque $$...$$
    content = content.replace(/\$\$([\s\S]*?)\$\$/g, (match, expr) => {
      try {
        if (window.katex) {
          return `<div class="my-3 flex justify-center">${window.katex.renderToString(expr.trim(), { displayMode: true, throwOnError: false })}</div>`;
        }
      } catch(e) {}
      return match;
    });

    // Fórmulas inline $...$
    content = content.replace(/\$([^\$\n]+?)\$/g, (match, expr) => {
      try {
        if (window.katex) {
          return window.katex.renderToString(expr.trim(), { displayMode: false, throwOnError: false });
        }
      } catch(e) {}
      return match;
    });

    // Parsear Markdown con marked.js
    if (window.marked) {
      preview.innerHTML = window.marked.parse(content);

      // Resaltado de sintaxis en bloques de código
      if (window.hljs) {
        preview.querySelectorAll('pre code').forEach(block => {
          window.hljs.highlightElement(block);
        });
      }
    }
  }

  async exportMarkdownToPdf() {
    const preview = document.getElementById('converter-md-preview');
    if (!preview) return;

    window.showLoading(true, 'Compilando documento Markdown a PDF...');
    try {
      // Clona el contenedor para estilarlo en modo imprimible
      const printableClone = preview.cloneNode(true);
      printableClone.style.backgroundColor = '#ffffff';
      printableClone.style.color = '#1e293b';
      printableClone.style.padding = '20px';

      // Ajustar colores para impresión
      printableClone.querySelectorAll('*').forEach(el => {
        if (el.tagName === 'H1' || el.tagName === 'H2' || el.tagName === 'H3') {
          el.style.color = '#0f172a';
        }
      });

      const opt = {
        margin: [15, 15, 15, 15],
        filename: `Markdown_Documento_${Date.now()}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
      };

      await html2pdf().set(opt).from(printableClone).save();
      window.showToast('PDF compilado y descargado exitosamente.', 'success');
    } catch (err) {
      console.error('Error al exportar Markdown a PDF:', err);
      window.showToast('Error al exportar a PDF.', 'error');
    } finally {
      window.showLoading(false);
    }
  }
}

window.converterModule = new ConverterModule();

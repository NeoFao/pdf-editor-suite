import { PdfiumEngine } from '../engine/pdfium/PdfiumEngine';
import type { DocHandle } from '../engine/PdfEngine';
import { DocumentModel } from '../model/DocumentModel';
import type { PageModel } from '../model/types';
import { CommandBus } from '../commands/Command';
import { EditTextRunCmd } from '../commands/EditTextRun';
import { Viewer } from './Viewer';
import type { EditRequest } from './TextLayer';

/** Orquesta motor + modelo + comandos + visor. Punto de entrada de la app nueva. */
export class App {
  private engine!: PdfiumEngine;
  private doc: DocHandle | null = null;
  private model: DocumentModel | null = null;
  private bus: CommandBus | null = null;
  private viewer: Viewer | null = null;
  private docName = 'documento.pdf';
  private readonly viewerEl: HTMLElement;
  private readonly status: HTMLElement;

  constructor(private readonly rootEl: HTMLElement) {
    rootEl.textContent = '';
    const bar = document.createElement('div');
    bar.className = 'toolbar';
    Object.assign(bar.style, { display: 'flex', gap: '8px', alignItems: 'center', padding: '8px', borderBottom: '1px solid #ccc', font: '14px sans-serif' });

    const file = document.createElement('input');
    file.type = 'file'; file.accept = 'application/pdf'; file.id = 'file-input';
    file.addEventListener('change', () => { const f = file.files?.[0]; if (f) void this.openFile(f); });

    const btnSave = this.button('Guardar', 'btn-save', () => this.save());
    const btnUndo = this.button('Deshacer', 'btn-undo', () => { this.bus?.undo(); });
    const btnRedo = this.button('Rehacer', 'btn-redo', () => { this.bus?.redo(); });

    this.status = document.createElement('span');
    this.status.id = 'status'; this.status.style.marginLeft = 'auto'; this.status.style.color = '#555';

    bar.append(file, btnSave, btnUndo, btnRedo, this.status);
    rootEl.appendChild(bar);

    this.viewerEl = document.createElement('div');
    this.viewerEl.id = 'viewer';
    Object.assign(this.viewerEl.style, { position: 'absolute', top: '52px', bottom: '0', left: '0', right: '0', overflow: 'auto', background: '#525659', padding: '16px' });
    rootEl.appendChild(this.viewerEl);

    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); this.bus?.undo(); }
      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y')) { e.preventDefault(); this.bus?.redo(); }
    });
  }

  private button(label: string, id: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.textContent = label; b.id = id; b.addEventListener('click', onClick);
    return b;
  }

  private async ensureEngine(): Promise<PdfiumEngine> {
    if (!this.engine) this.engine = await PdfiumEngine.create();
    return this.engine;
  }

  async openFile(file: File): Promise<void> {
    this.setStatus('Cargando…');
    const engine = await this.ensureEngine();
    if (this.doc !== null) engine.close(this.doc);
    this.docName = file.name || 'documento.pdf';
    const bytes = new Uint8Array(await file.arrayBuffer());
    const doc = await engine.open(bytes);
    this.doc = doc;
    const pages: PageModel[] = [];
    const count = engine.pageCount(doc);
    for (let i = 0; i < count; i++) {
      pages.push({ index: i, sizePt: engine.pageSize(doc, i), rotation: 0, runs: engine.getPageText(doc, i) });
    }
    this.model = new DocumentModel(pages);
    this.bus = new CommandBus({ engine, model: this.model, doc });
    this.viewerEl.textContent = '';
    this.viewer = new Viewer(this.viewerEl, engine, doc, this.model, (req) => this.handleEdit(req));
    this.setStatus(`${count} página(s)`);
  }

  private handleEdit(req: EditRequest): void {
    if (!this.doc || !this.engine || !this.model || !this.bus) return;
    const res = this.engine.editTextRun(this.doc, req.pageIndex, req.runId, req.newText);
    if (!res.ok) {
      req.el.textContent = req.oldText; // revertir la vista
      this.setStatus(res.reason === 'glyph-missing'
        ? 'La fuente de esa línea no tiene alguno de esos caracteres; edición no aplicada.'
        : 'No se puede editar ese elemento.');
      return;
    }
    this.model.updateRunText(req.pageIndex, req.runId, req.newText);
    this.bus.pushExecuted(new EditTextRunCmd(req.pageIndex, req.runId, req.newText, req.oldText));
    this.setStatus('Editado.');
  }

  private save(): void {
    if (!this.doc || !this.engine) return;
    const bytes = this.engine.save(this.doc);
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = this.docName.replace(/\.pdf$/i, '') + '_editado.pdf';
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    this.setStatus('Guardado.');
  }

  private setStatus(msg: string): void { this.status.textContent = msg; }
}

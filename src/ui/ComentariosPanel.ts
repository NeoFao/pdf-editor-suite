import type { CommentInfo, CommentKind } from '../engine/PdfEngine';

/** Lo que el panel necesita del resto de la app (sin conocer `App`). */
export interface ComentariosHooks {
  /** Nº de páginas del documento abierto (0 si no hay). */
  totalPaginas(): number;
  /** Anotaciones con comentario de una página (lectura al motor). */
  leerPagina(pageIndex: number): CommentInfo[];
  /** Navega a la página (único punto de entrada de navegación, E-032). */
  irAPagina(pageIndex: number): void;
  /** Marca la nota en el visor. */
  resaltar(pageIndex: number, annotIndex: number): void;
  editar(pageIndex: number, annotIndex: number, texto: string): void;
  borrar(pageIndex: number, annotIndex: number): void;
}

type Fila = CommentInfo & { pageIndex: number };

const ETIQUETA: Record<CommentKind, string> = {
  note: 'Nota', highlight: 'Resaltado', underline: 'Subrayado', strikeout: 'Tachado', freetext: 'Texto libre', other: 'Anotación'
};
/** Páginas leídas por tanda antes de ceder el hilo (E-043: nunca 500 getComments seguidos). */
const PAGINAS_POR_TANDA = 20;
const EXTRACTO_MAX = 140;

/**
 * Panel "Comentarios" (pestaña del panel lateral). Lectura PEREZOSA: no toca el
 * motor hasta que se muestra la pestaña; entonces lee las páginas por tandas
 * cediendo el hilo entre ellas, y pinta lo que va encontrando. Mientras está
 * oculto solo se marca como "sucio" (`invalidar*`) y se relee al volver a abrirlo.
 * Alcance: anotaciones reales del PDF (ver `CommentKind`). Todo texto del
 * documento entra por `textContent` (nunca innerHTML, §2.2).
 */
export class ComentariosPanel {
  private porPagina = new Map<number, CommentInfo[]>();
  private visible = false;
  private sucio = true;
  private cargando = false;
  /** Se incrementa al invalidar: una lectura en curso con un número viejo se descarta. */
  private generacion = 0;
  private filtro = '';
  private editando: { pageIndex: number; annotIndex: number } | null = null;
  private readonly filtroEl: HTMLInputElement;
  private readonly listaEl: HTMLElement;
  private readonly estadoEl: HTMLElement;

  constructor(host: HTMLElement, private readonly hooks: ComentariosHooks) {
    this.filtroEl = document.createElement('input');
    this.filtroEl.type = 'search';
    this.filtroEl.className = 'comentarios-filtro';
    this.filtroEl.placeholder = 'Filtrar comentarios';
    this.filtroEl.setAttribute('aria-label', 'Filtrar comentarios');
    this.filtroEl.addEventListener('input', () => { this.filtro = this.filtroEl.value.trim().toLowerCase(); this.pintar(); });
    this.estadoEl = document.createElement('p');
    this.estadoEl.className = 'comentarios-estado';
    this.estadoEl.setAttribute('role', 'status');
    this.listaEl = document.createElement('ul');
    this.listaEl.className = 'comentarios-lista';
    this.listaEl.setAttribute('aria-label', 'Comentarios del documento');
    this.listaEl.addEventListener('keydown', (e) => this.teclado(e));
    host.append(this.filtroEl, this.estadoEl, this.listaEl);
  }

  /** La pestaña se muestra/oculta. Al mostrarse con datos viejos, (re)lee. */
  setVisible(v: boolean): void {
    this.visible = v;
    if (v && this.sucio) void this.cargar();
  }

  /** Cambió el conjunto de páginas o se recargó el documento: todo lo leído vale poco. */
  invalidarTodo(): void {
    this.generacion++;
    this.cargando = false;
    this.sucio = true;
    this.porPagina.clear();
    this.editando = null;
    if (this.visible) void this.cargar();
    else this.pintar();
  }

  /** Cambió UNA página (E-044: no se relee el documento entero). */
  invalidarPagina(pageIndex: number): void {
    if (!this.visible || this.sucio) { this.sucio = true; return; }
    this.porPagina.set(pageIndex, this.hooks.leerPagina(pageIndex));
    this.pintar();
  }

  private async cargar(): Promise<void> {
    if (this.cargando) return;
    this.cargando = true;
    const gen = this.generacion;
    const total = this.hooks.totalPaginas();
    this.porPagina.clear();
    this.sucio = false;
    for (let i = 0; i < total; i++) {
      if (gen !== this.generacion) return; // se invalidó a mitad: la carga nueva ya está en marcha
      this.porPagina.set(i, this.hooks.leerPagina(i));
      if ((i + 1) % PAGINAS_POR_TANDA === 0 && i + 1 < total) {
        this.pintar(`Leyendo comentarios… ${i + 1} de ${total} páginas`);
        await new Promise<void>((r) => setTimeout(r, 0)); // cede el hilo
      }
    }
    if (gen !== this.generacion) return;
    this.cargando = false;
    this.pintar();
  }

  private todos(): Fila[] {
    const out: Fila[] = [];
    for (const [pageIndex, lista] of [...this.porPagina.entries()].sort((a, b) => a[0] - b[0])) {
      for (const c of lista) out.push({ ...c, pageIndex });
    }
    return out;
  }

  /** `progreso`: texto de estado mientras la lectura por tandas sigue en curso. */
  private pintar(progreso?: string): void {
    const todos = this.todos();
    const vistos = todos.filter((c) => !this.filtro || `${c.text} ${c.author} ${ETIQUETA[c.kind]}`.toLowerCase().includes(this.filtro));
    this.listaEl.textContent = '';
    if (progreso) this.estadoEl.textContent = progreso;
    else if (this.hooks.totalPaginas() === 0) this.estadoEl.textContent = '';
    else if (todos.length === 0) this.estadoEl.textContent = 'Este documento no tiene comentarios.';
    else if (vistos.length === 0) this.estadoEl.textContent = 'Sin resultados para el filtro.';
    else this.estadoEl.textContent = `${vistos.length} comentario(s)`;
    let paginaActual = -1;
    for (const c of vistos) {
      if (c.pageIndex !== paginaActual) {
        paginaActual = c.pageIndex;
        const cab = document.createElement('li');
        cab.className = 'comentarios-pagina';
        cab.textContent = `Página ${c.pageIndex + 1}`;
        this.listaEl.appendChild(cab);
      }
      this.listaEl.appendChild(this.crearFila(c));
    }
  }

  private crearFila(c: Fila): HTMLLIElement {
    const li = document.createElement('li');
    li.className = 'comentario';
    const pagina = c.pageIndex + 1;
    if (this.editando && this.editando.pageIndex === c.pageIndex && this.editando.annotIndex === c.index) {
      const ta = document.createElement('textarea');
      ta.className = 'comentario-editor';
      ta.value = c.text;
      ta.setAttribute('aria-label', `Texto del comentario de la página ${pagina}`);
      const guardar = this.btn('Guardar', 'Guardar comentario', () => this.guardarEdicion(c, ta.value));
      const cancelar = this.btn('Cancelar', 'Cancelar edición', () => { this.editando = null; this.pintar(); });
      ta.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.stopPropagation(); this.editando = null; this.pintar(); }
        else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.guardarEdicion(c, ta.value); }
      });
      li.append(ta, guardar, cancelar);
      queueMicrotask(() => ta.focus());
      return li;
    }
    const abrir = document.createElement('button');
    abrir.type = 'button';
    abrir.className = 'comentario-item';
    const extracto = c.text.length > EXTRACTO_MAX ? `${c.text.slice(0, EXTRACTO_MAX)}…` : c.text;
    abrir.setAttribute('aria-label', `${ETIQUETA[c.kind]} en la página ${pagina}${c.author ? ` de ${c.author}` : ''}: ${extracto || 'sin texto'}`);
    const meta = document.createElement('span');
    meta.className = 'comentario-meta';
    meta.textContent = `${ETIQUETA[c.kind]} · Página ${pagina}${c.author ? ` · ${c.author}` : ''}`;
    const txt = document.createElement('span');
    txt.className = 'comentario-texto';
    txt.textContent = extracto || '(sin texto)';
    abrir.append(meta, txt);
    abrir.addEventListener('click', () => { this.hooks.irAPagina(c.pageIndex); this.hooks.resaltar(c.pageIndex, c.index); });
    const editar = this.btn('Editar', `Editar comentario de la página ${pagina}`, () => { this.editando = { pageIndex: c.pageIndex, annotIndex: c.index }; this.pintar(); });
    const borrar = this.btn('Borrar', `Borrar comentario de la página ${pagina}`, () => this.hooks.borrar(c.pageIndex, c.index));
    li.append(abrir, editar, borrar);
    return li;
  }

  private guardarEdicion(c: Fila, texto: string): void {
    this.editando = null;
    if (texto !== c.text) this.hooks.editar(c.pageIndex, c.index, texto); // el comando dispara invalidarPagina
    this.pintar();
  }

  private btn(texto: string, aria: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'comentario-accion';
    b.textContent = texto;
    b.setAttribute('aria-label', aria);
    b.addEventListener('click', onClick);
    return b;
  }

  /** Flechas arriba/abajo mueven el foco entre los elementos (Tab sigue recorriendo también sus acciones). */
  private teclado(e: KeyboardEvent): void {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = Array.from(this.listaEl.querySelectorAll<HTMLElement>('.comentario-item'));
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    const j = e.key === 'ArrowDown' ? Math.min(items.length - 1, i + 1) : Math.max(0, i - 1);
    e.preventDefault();
    items[j]?.focus();
  }
}

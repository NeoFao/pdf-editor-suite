import type { CommentInfo, CommentKind } from '../engine/PdfEngine';

/** Lo que el panel necesita del resto de la app (sin conocer `App`). */
export interface ComentariosHooks {
  /** Nº de páginas del documento abierto (0 si no hay). */
  totalPaginas(): number;
  /** Anotaciones con comentario de una página (lectura al motor). */
  leerPagina(pageIndex: number): CommentInfo[];
  /** Texto de la página que cubre una anotación de marcado (QuadPoints); '' si no cubre ninguno. Lectura perezosa. */
  textoMarcado(pageIndex: number, c: CommentInfo): string;
  /** Navega a la página (único punto de entrada de navegación, E-032). */
  irAPagina(pageIndex: number): void;
  /** Marca la nota en el visor. */
  resaltar(pageIndex: number, annotIndex: number): void;
  /** Abre el editor de nota (diálogo, B4) con el texto actual; quien lo implementa guarda el resultado. */
  editar(pageIndex: number, annotIndex: number, textoActual: string): void;
  borrar(pageIndex: number, annotIndex: number): void;
}

type Fila = CommentInfo & { pageIndex: number; marcado: string };

const ETIQUETA: Record<CommentKind, string> = {
  note: 'Nota', highlight: 'Resaltado', underline: 'Subrayado', strikeout: 'Tachado', freetext: 'Texto libre', other: 'Anotación'
};
/** Páginas leídas por tanda antes de ceder el hilo (E-043: nunca 500 getComments seguidos). */
const PAGINAS_POR_TANDA = 20;
const EXTRACTO_MAX = 140;
/** Un tramo de trabajo síncrono mayor que esto (ms) cede el hilo antes de seguir leyendo (E-043). */
const TRAMO_MAX_MS = 25;
const esMarcado = (k: CommentKind): boolean => k === 'highlight' || k === 'underline' || k === 'strikeout';
const recortar = (t: string): string => (t.length > EXTRACTO_MAX ? `${t.slice(0, EXTRACTO_MAX)}…` : t);

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
  /** Texto marcado por anotación (clave «página:índice»), calculado una vez al leer la página y vaciado con ella. */
  private textos = new Map<string, string>();
  private visible = false;
  private sucio = true;
  private cargando = false;
  /** Se incrementa al invalidar: una lectura en curso con un número viejo se descarta. */
  private generacion = 0;
  private filtro = '';
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
    this.textos.clear();
    if (this.visible) void this.cargar();
    else this.pintar();
  }

  /** Cambió UNA página (E-044: no se relee el documento entero). */
  invalidarPagina(pageIndex: number): void {
    if (!this.visible || this.sucio) { this.sucio = true; return; }
    this.leerYGuardar(pageIndex);
    this.pintar();
  }

  /** Lee una página y (re)calcula el texto marcado de sus marcados; descarta lo cacheado de esa página. */
  private leerYGuardar(pageIndex: number): void {
    const prefijo = `${pageIndex}:`;
    for (const k of [...this.textos.keys()]) if (k.startsWith(prefijo)) this.textos.delete(k);
    const lista = this.hooks.leerPagina(pageIndex);
    this.porPagina.set(pageIndex, lista);
    for (const c of lista) if (esMarcado(c.kind)) this.textos.set(`${prefijo}${c.index}`, this.hooks.textoMarcado(pageIndex, c));
  }

  private async cargar(): Promise<void> {
    if (this.cargando) return;
    this.cargando = true;
    const gen = this.generacion;
    const total = this.hooks.totalPaginas();
    this.porPagina.clear();
    this.textos.clear();
    this.sucio = false;
    let desde = performance.now();
    for (let i = 0; i < total; i++) {
      if (gen !== this.generacion) return; // se invalidó a mitad: la carga nueva ya está en marcha
      this.leerYGuardar(i);
      if (i + 1 < total && ((i + 1) % PAGINAS_POR_TANDA === 0 || performance.now() - desde > TRAMO_MAX_MS)) {
        this.pintar(`Leyendo comentarios… ${i + 1} de ${total} páginas`);
        await new Promise<void>((r) => setTimeout(r, 0)); // cede el hilo
        desde = performance.now();
      }
    }
    if (gen !== this.generacion) return;
    this.cargando = false;
    this.pintar();
  }

  private todos(): Fila[] {
    const out: Fila[] = [];
    for (const [pageIndex, lista] of [...this.porPagina.entries()].sort((a, b) => a[0] - b[0])) {
      for (const c of lista) out.push({ ...c, pageIndex, marcado: this.textos.get(`${pageIndex}:${c.index}`) ?? '' });
    }
    return out;
  }

  /** `progreso`: texto de estado mientras la lectura por tandas sigue en curso. */
  private pintar(progreso?: string): void {
    const todos = this.todos();
    const vistos = todos.filter((c) => !this.filtro || `${c.text} ${c.marcado} ${c.author} ${ETIQUETA[c.kind]}`.toLowerCase().includes(this.filtro));
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
    const abrir = document.createElement('button');
    abrir.type = 'button';
    abrir.className = 'comentario-item';
    const marcado = esMarcado(c.kind);
    const extracto = recortar(c.text);
    const citado = marcado && c.marcado ? `«${recortar(c.marcado)}»` : '';
    const partes = [`${ETIQUETA[c.kind]} en la página ${pagina}${c.author ? ` de ${c.author}` : ''}`];
    if (marcado) partes.push(citado ? `texto marcado ${citado}` : 'sin texto marcado');
    partes.push(marcado ? (extracto ? `comentario: ${extracto}` : 'sin comentario') : (extracto || 'sin texto'));
    abrir.setAttribute('aria-label', partes.join('. '));
    const meta = document.createElement('span');
    meta.className = 'comentario-meta';
    meta.textContent = `${ETIQUETA[c.kind]} · Página ${pagina}${c.author ? ` · ${c.author}` : ''}`;
    abrir.append(meta);
    if (marcado) {
      const cita = document.createElement('span');
      cita.className = 'comentario-marcado';
      cita.textContent = citado || '(sin texto)';
      abrir.append(cita);
      if (extracto) {
        const com = document.createElement('span');
        com.className = 'comentario-texto';
        com.textContent = extracto; // el CSS conserva los saltos de línea del comentario (pre-line)
        abrir.append(com);
      }
    } else {
      const txt = document.createElement('span');
      txt.className = 'comentario-texto';
      txt.textContent = extracto || '(sin texto)';
      abrir.append(txt);
    }
    abrir.addEventListener('click', () => { this.hooks.irAPagina(c.pageIndex); this.hooks.resaltar(c.pageIndex, c.index); });
    const anadir = marcado && c.text === '';
    const editar = anadir
      ? this.btn('Añadir comentario', `Añadir comentario al marcado de la página ${pagina}`, () => this.hooks.editar(c.pageIndex, c.index, c.text))
      : this.btn(marcado ? 'Editar comentario' : 'Editar', `Editar comentario de la página ${pagina}`, () => this.hooks.editar(c.pageIndex, c.index, c.text));
    const borrar = this.btn('Borrar', `Borrar comentario de la página ${pagina}`, () => this.hooks.borrar(c.pageIndex, c.index));
    li.append(abrir, editar, borrar);
    return li;
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

import { outlineTieneAccionesNoSoportadas, type OutlineItem } from '../engine/PdfEngine';
import {
  borrar, cambiarDestino, contarNodos, desangrar, insertarHermano, insertarHijo, mover, obtener, renombrar, sangrar,
  type Resultado, type Ruta
} from '../outline/arbol';

/**
 * Panel de marcadores editable, al estilo Acrobat. Árbol accesible
 * (`role="tree"`/`treeitem`, `aria-expanded`, `aria-level`, tabindex "roving")
 * con teclado, edición inline del título y barra de acciones. Es solo vista:
 * nunca escribe en el motor; cada cambio se entrega a `aplicar(antes, después,
 * etiqueta)` (la App lo ejecuta como `SetOutlineCmd`, con deshacer) y el panel
 * se repinta cuando la App vuelve a llamar a `render()`.
 *
 * Todo el texto del documento (títulos) entra al DOM con `textContent`/
 * `setAttribute`, nunca con innerHTML (AGENTS.md 2.2).
 */
export interface OpcionesPanelMarcadores {
  contenedor: HTMLElement;
  barra: HTMLElement;
  /** Árbol real del documento (se relee en cada render). */
  obtenerArbol(): OutlineItem[];
  /** Página visible, base 0: destino de un marcador nuevo o reasignado. */
  paginaActual(): number;
  ir(pageIndex: number): void;
  aplicar(antes: OutlineItem[], despues: OutlineItem[], etiqueta: string): Promise<void>;
  estado(mensaje: string): void;
}

const clave = (r: Ruta): string => r.join('.');
const mismaRuta = (a: Ruta | null, b: Ruta | null): boolean => !!a && !!b && clave(a) === clave(b);

export class PanelMarcadores {
  private sel: Ruta | null = null;
  private readonly expandidos = new Set<string>();
  /** Marcador nuevo aún sin confirmar: árbol con el nodo provisional y su ruta. Nada se escribe en el documento hasta confirmar el título. */
  private borrador: { arbol: OutlineItem[]; ruta: Ruta } | null = null;
  /** Ruta del título en edición inline (renombrar o borrador), o null. */
  private editando: Ruta | null = null;
  private pendienteFoco: Ruta | null = null;
  private readonly botones = new Map<string, HTMLButtonElement>();

  constructor(private readonly o: OpcionesPanelMarcadores) {
    this.construirBarra();
  }

  // ---------------------------------------------------------------- barra

  private construirBarra(): void {
    const b = this.o.barra;
    b.textContent = '';
    b.setAttribute('role', 'toolbar');
    b.setAttribute('aria-label', 'Acciones de marcadores');
    const def: Array<[string, string, string, string, () => void]> = [
      ['nuevo', 'btn-outline-nuevo', '+ Nuevo', 'Nuevo marcador en la página actual (a continuación del seleccionado)', () => this.nuevo(false)],
      ['hijo', 'btn-outline-hijo', '+ Hijo', 'Nuevo marcador hijo del seleccionado, en la página actual', () => this.nuevo(true)],
      ['renombrar', 'btn-outline-renombrar', 'Renombrar', 'Renombrar el marcador seleccionado (F2)', () => this.renombrarSel()],
      ['destino', 'btn-outline-destino', 'Destino', 'Apuntar el marcador seleccionado a la página actual', () => this.destinoActual()],
      ['subir', 'btn-outline-subir', 'Subir', 'Mover arriba (Alt+Flecha arriba)', () => this.moverSel(-1)],
      ['bajar', 'btn-outline-bajar', 'Bajar', 'Mover abajo (Alt+Flecha abajo)', () => this.moverSel(1)],
      ['sangrar', 'btn-outline-sangrar', 'Sangrar', 'Hacerlo hijo del hermano anterior (Tab)', () => this.sangrarSel()],
      ['desangrar', 'btn-outline-desangrar', 'Desangrar', 'Subirlo un nivel (Mayús+Tab)', () => this.desangrarSel()],
      ['borrar', 'btn-outline-borrar', 'Borrar', 'Borrar el marcador y sus hijos (Supr)', () => this.borrarSel()]
    ];
    for (const [k, id, texto, ayuda, fn] of def) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.id = id;
      btn.className = 'outline-action';
      btn.textContent = texto;
      btn.title = ayuda;
      btn.setAttribute('aria-label', ayuda);
      btn.addEventListener('click', fn);
      this.botones.set(k, btn);
      b.appendChild(btn);
    }
    this.actualizarBarra();
  }

  /** true si el documento tiene marcadores con acciones que no se pueden conservar: la edición queda desactivada (nada se reescribe, nada se ejecuta). */
  private bloqueado(): boolean {
    return outlineTieneAccionesNoSoportadas(this.o.obtenerArbol());
  }

  private actualizarBarra(): void {
    const arbol = this.o.obtenerArbol();
    if (this.bloqueado()) {
      for (const btn of this.botones.values()) btn.disabled = true;
      return;
    }
    const r = this.sel;
    const existe = !!r && !!obtener(arbol, r);
    const set = (k: string, ok: boolean): void => { this.botones.get(k)!.disabled = !ok; };
    set('nuevo', true);
    set('hijo', existe && insertarHijo(arbol, r!, { title: '', pageIndex: 0, children: [] }) !== null);
    set('renombrar', existe);
    set('destino', existe);
    set('subir', existe && mover(arbol, r!, -1) !== null);
    set('bajar', existe && mover(arbol, r!, 1) !== null);
    set('sangrar', existe && sangrar(arbol, r!) !== null);
    set('desangrar', existe && desangrar(arbol, r!) !== null);
    set('borrar', existe);
  }

  // ------------------------------------------------------------- acciones

  private async ejecutar(despues: OutlineItem[] | null, etiqueta: string, nuevaSel: Ruta | null): Promise<void> {
    if (!despues || this.bloqueado()) return;
    const antes = this.o.obtenerArbol();
    this.borrador = null;
    this.editando = null;
    try {
      await this.o.aplicar(antes, despues, etiqueta);
    } catch (e) {
      this.o.estado(`No se pudo aplicar el cambio: ${e instanceof Error ? e.message : String(e)}`);
      this.render();
      return;
    }
    this.sel = nuevaSel;
    this.pendienteFoco = nuevaSel;
    if (nuevaSel) for (let i = 1; i < nuevaSel.length; i++) this.expandidos.add(clave(nuevaSel.slice(0, i)));
    this.render();
    this.o.estado(`${etiqueta}.`);
  }

  private async aplicarResultado(r: Resultado | null, etiqueta: string): Promise<void> {
    if (!r) return;
    await this.ejecutar(r.items, etiqueta, r.ruta);
  }

  /** Nuevo marcador: aparece un campo de título en su sitio; se escribe en el documento al confirmar (Intro). */
  nuevo(comoHijo: boolean): void {
    if (this.bloqueado()) return;
    const real = this.o.obtenerArbol();
    const sel = this.sel && obtener(real, this.sel) ? this.sel : null;
    const item: OutlineItem = { title: '', pageIndex: this.o.paginaActual(), children: [] };
    const r = sel && comoHijo ? insertarHijo(real, sel, item) : insertarHermano(real, sel, item);
    if (!r) { this.o.estado('No se puede crear el marcador aquí (límite de profundidad o de cantidad).'); return; }
    this.borrador = { arbol: r.items, ruta: r.ruta };
    this.editando = r.ruta;
    this.sel = r.ruta;
    for (let i = 1; i < r.ruta.length; i++) this.expandidos.add(clave(r.ruta.slice(0, i)));
    this.render();
  }

  private renombrarSel(): void {
    if (!this.sel || this.bloqueado()) return;
    this.editando = this.sel;
    this.render();
  }

  private destinoActual(): void {
    if (!this.sel || this.bloqueado()) return;
    void this.ejecutar(cambiarDestino(this.o.obtenerArbol(), this.sel, this.o.paginaActual()), 'Destino del marcador cambiado', this.sel);
  }

  private moverSel(delta: -1 | 1): void {
    if (!this.sel || this.bloqueado()) return;
    void this.aplicarResultado(mover(this.o.obtenerArbol(), this.sel, delta), delta < 0 ? 'Marcador movido arriba' : 'Marcador movido abajo');
  }

  private sangrarSel(): void {
    if (!this.sel || this.bloqueado()) return;
    void this.aplicarResultado(sangrar(this.o.obtenerArbol(), this.sel), 'Marcador sangrado');
  }

  private desangrarSel(): void {
    if (!this.sel || this.bloqueado()) return;
    void this.aplicarResultado(desangrar(this.o.obtenerArbol(), this.sel), 'Marcador desangrado');
  }

  private borrarSel(): void {
    const arbol = this.o.obtenerArbol();
    const ruta = this.sel;
    const item = ruta ? obtener(arbol, ruta) : null;
    if (!ruta || !item || this.bloqueado()) return;
    const hijos = contarNodos(item.children);
    if (hijos > 0) {
      const ok = window.confirm(`¿Borrar «${item.title}» y sus ${hijos} marcador(es) hijo(s)?`);
      if (!ok) return;
    }
    const despues = borrar(arbol, ruta);
    // Tras borrar, la selección pasa al hermano siguiente/anterior o al padre.
    const lista = ruta.length === 1 ? despues : obtener(despues ?? [], ruta.slice(0, -1))?.children;
    const idx = ruta[ruta.length - 1]!;
    let nueva: Ruta | null = null;
    if (lista && lista.length > 0) nueva = [...ruta.slice(0, -1), Math.min(idx, lista.length - 1)];
    else if (ruta.length > 1) nueva = ruta.slice(0, -1);
    void this.ejecutar(despues, 'Marcador borrado', nueva);
  }

  private confirmarTitulo(ruta: Ruta, titulo: string): void {
    const t = titulo.trim();
    if (this.borrador) {
      const arbol = this.borrador.arbol;
      this.borrador = null;
      this.editando = null;
      if (!t) { this.render(); return; }
      void this.ejecutar(renombrar(arbol, ruta, t), 'Marcador creado', ruta);
      return;
    }
    this.editando = null;
    const actual = obtener(this.o.obtenerArbol(), ruta);
    if (!t || !actual || actual.title === t) { this.pendienteFoco = ruta; this.render(); return; }
    void this.ejecutar(renombrar(this.o.obtenerArbol(), ruta, t), 'Marcador renombrado', ruta);
  }

  private cancelarEdicion(ruta: Ruta): void {
    this.borrador = null;
    this.editando = null;
    this.pendienteFoco = ruta;
    this.render();
  }

  // ---------------------------------------------------------------- vista

  render(): void {
    const c = this.o.contenedor;
    c.textContent = '';
    const items = this.borrador ? this.borrador.arbol : this.o.obtenerArbol();
    if (this.sel && !obtener(items, this.sel)) this.sel = null;
    if (items.length === 0) {
      const p = document.createElement('p');
      p.textContent = 'Este documento no tiene marcadores.';
      c.appendChild(p);
      this.actualizarBarra();
      return;
    }
    if (this.bloqueado()) {
      const aviso = document.createElement('p');
      aviso.id = 'outline-aviso-bloqueo';
      aviso.setAttribute('role', 'note');
      aviso.textContent = 'Este documento tiene marcadores con acciones que este editor aún no puede conservar; la edición está desactivada para no perderlas.';
      c.appendChild(aviso);
    }
    const tree = this.construirLista(items, [], true);
    tree.setAttribute('role', 'tree');
    tree.setAttribute('aria-label', 'Marcadores');
    tree.addEventListener('keydown', (e) => this.teclado(e));
    c.appendChild(tree);
    // tabindex roving: exactamente un treeitem tabulable.
    const todos = Array.from(tree.querySelectorAll<HTMLElement>('[role="treeitem"]'));
    const activo = (this.sel && todos.find((li) => li.dataset.ruta === clave(this.sel!))) || todos[0];
    for (const li of todos) li.tabIndex = li === activo ? 0 : -1;
    if (this.pendienteFoco) {
      const objetivo = todos.find((li) => li.dataset.ruta === clave(this.pendienteFoco!));
      this.pendienteFoco = null;
      if (this.editando === null) objetivo?.focus();
    }
    const inp = tree.querySelector<HTMLInputElement>('input.outline-edit');
    if (inp) { inp.focus(); inp.select(); }
    this.actualizarBarra();
  }

  private construirLista(items: OutlineItem[], base: Ruta, raiz: boolean): HTMLUListElement {
    const ul = document.createElement('ul');
    if (!raiz) ul.setAttribute('role', 'group');
    Object.assign(ul.style, { listStyle: 'none', margin: '0', padding: '0' });
    items.forEach((item, i) => {
      const ruta = [...base, i];
      const li = document.createElement('li');
      li.setAttribute('role', 'treeitem');
      li.setAttribute('aria-level', String(ruta.length));
      li.setAttribute('aria-posinset', String(i + 1));
      li.setAttribute('aria-setsize', String(items.length));
      li.setAttribute('aria-label', item.title);
      li.setAttribute('aria-selected', String(mismaRuta(this.sel, ruta)));
      li.dataset.ruta = clave(ruta);
      li.tabIndex = -1;
      const tieneHijos = item.children.length > 0;
      const abierto = tieneHijos && this.expandidos.has(clave(ruta));
      if (tieneHijos) li.setAttribute('aria-expanded', String(abierto));
      if (mismaRuta(this.sel, ruta)) li.classList.add('seleccionado');
      li.addEventListener('focus', (e) => { if (e.target === li) this.seleccionar(ruta); });

      const fila = document.createElement('div');
      Object.assign(fila.style, { display: 'flex', alignItems: 'center', paddingLeft: `${base.length * 14}px` });

      if (tieneHijos) {
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'outline-toggle';
        toggle.textContent = abierto ? '▾' : '▸';
        toggle.title = 'Desplegar/plegar';
        toggle.tabIndex = -1;
        toggle.setAttribute('aria-hidden', 'true'); // el estado lo expone el treeitem (aria-expanded)
        Object.assign(toggle.style, { border: 'none', background: 'none', cursor: 'pointer', width: '16px', flex: '0 0 16px', padding: '0' });
        toggle.addEventListener('click', () => this.alternar(ruta));
        fila.appendChild(toggle);
      } else {
        const sp = document.createElement('span');
        Object.assign(sp.style, { width: '16px', flex: '0 0 16px', display: 'inline-block' });
        fila.appendChild(sp);
      }

      if (this.editando && mismaRuta(this.editando, ruta)) {
        fila.appendChild(this.campoTitulo(ruta, item.title));
      } else {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'outline-item';
        btn.tabIndex = -1;
        btn.textContent = item.title;
        btn.title = item.pageIndex === null ? 'Sin destino' : `Página ${item.pageIndex + 1} — doble clic para renombrar`;
        Object.assign(btn.style, { border: 'none', background: 'none', textAlign: 'left', flex: '1', padding: '2px 0', cursor: item.pageIndex !== null ? 'pointer' : 'default' });
        btn.addEventListener('click', () => {
          this.seleccionar(ruta);
          li.focus();
          if (item.pageIndex !== null) this.o.ir(item.pageIndex);
        });
        btn.addEventListener('dblclick', () => { this.seleccionar(ruta); this.renombrarSel(); });
        fila.appendChild(btn);
      }
      li.appendChild(fila);

      if (tieneHijos) {
        const hijos = this.construirLista(item.children, ruta, false);
        hijos.style.display = abierto ? 'block' : 'none';
        li.appendChild(hijos);
      }
      ul.appendChild(li);
    });
    return ul;
  }

  private campoTitulo(ruta: Ruta, inicial: string): HTMLInputElement {
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'outline-edit';
    inp.value = inicial;
    inp.setAttribute('aria-label', 'Título del marcador');
    inp.maxLength = 500;
    Object.assign(inp.style, { flex: '1', minWidth: '0' });
    let cerrado = false;
    inp.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); cerrado = true; this.confirmarTitulo(ruta, inp.value); }
      else if (e.key === 'Escape') { e.preventDefault(); cerrado = true; this.cancelarEdicion(ruta); }
    });
    inp.addEventListener('blur', () => { if (!cerrado) { cerrado = true; this.confirmarTitulo(ruta, inp.value); } });
    return inp;
  }

  private seleccionar(ruta: Ruta): void {
    if (mismaRuta(this.sel, ruta)) return;
    this.sel = ruta;
    for (const li of Array.from(this.o.contenedor.querySelectorAll<HTMLElement>('[role="treeitem"]'))) {
      const es = li.dataset.ruta === clave(ruta);
      li.setAttribute('aria-selected', String(es));
      li.classList.toggle('seleccionado', es);
      li.tabIndex = es ? 0 : -1;
    }
    this.actualizarBarra();
  }

  private alternar(ruta: Ruta, forzar?: boolean): void {
    const k = clave(ruta);
    const abrir = forzar ?? !this.expandidos.has(k);
    if (abrir) this.expandidos.add(k); else this.expandidos.delete(k);
    this.pendienteFoco = ruta;
    this.render();
  }

  // -------------------------------------------------------------- teclado

  /** Los treeitem visibles en orden de pantalla (los de ramas plegadas no cuentan). */
  private visibles(): HTMLElement[] {
    return Array.from(this.o.contenedor.querySelectorAll<HTMLElement>('[role="treeitem"]'))
      .filter((li) => {
        let p = li.parentElement?.closest('[role="treeitem"]') ?? null;
        while (p) {
          if (p.getAttribute('aria-expanded') !== 'true') return false;
          p = p.parentElement?.closest('[role="treeitem"]') ?? null;
        }
        return true;
      });
  }

  private teclado(e: KeyboardEvent): void {
    const li = (e.target as HTMLElement).closest<HTMLElement>('[role="treeitem"]');
    if (!li || (e.target as HTMLElement).tagName === 'INPUT') return;
    const ruta = li.dataset.ruta!.split('.').map(Number);
    const arbol = this.o.obtenerArbol();
    const item = obtener(arbol, ruta);
    if (!item) return;
    const vis = this.visibles();
    const pos = vis.indexOf(li);
    const manejar = (): void => { e.preventDefault(); e.stopPropagation(); };
    const tieneHijos = item.children.length > 0;
    const abierto = li.getAttribute('aria-expanded') === 'true';

    const edicion = !this.bloqueado();
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      if (!edicion) return;
      manejar(); this.seleccionar(ruta); this.moverSel(e.key === 'ArrowUp' ? -1 : 1); return;
    }
    switch (e.key) {
      case 'ArrowDown': manejar(); vis[Math.min(vis.length - 1, pos + 1)]?.focus(); return;
      case 'ArrowUp': manejar(); vis[Math.max(0, pos - 1)]?.focus(); return;
      case 'Home': manejar(); vis[0]?.focus(); return;
      case 'End': manejar(); vis[vis.length - 1]?.focus(); return;
      case 'ArrowRight':
        manejar();
        if (tieneHijos && !abierto) this.alternar(ruta, true);
        else if (tieneHijos) vis[pos + 1]?.focus();
        return;
      case 'ArrowLeft':
        manejar();
        if (tieneHijos && abierto) this.alternar(ruta, false);
        else if (ruta.length > 1) li.parentElement?.closest<HTMLElement>('[role="treeitem"]')?.focus();
        return;
      case 'Enter':
      case ' ':
        manejar();
        if (item.pageIndex !== null) this.o.ir(item.pageIndex);
        return;
      case 'F2': if (!edicion) return; manejar(); this.seleccionar(ruta); this.renombrarSel(); return;
      case 'Delete': if (!edicion) return; manejar(); this.seleccionar(ruta); this.borrarSel(); return;
      case 'Insert': if (!edicion) return; manejar(); this.seleccionar(ruta); this.nuevo(e.ctrlKey); return;
      case 'Tab': {
        if (!edicion) return;
        // Tab/Mayús+Tab sangran/desangran (como Acrobat). Solo si la operación
        // es posible: si no, Tab sigue su camino normal y el foco no queda atrapado.
        const r = e.shiftKey ? desangrar(arbol, ruta) : sangrar(arbol, ruta);
        if (!r) return;
        manejar();
        void this.aplicarResultado(r, e.shiftKey ? 'Marcador desangrado' : 'Marcador sangrado');
        return;
      }
    }
  }
}

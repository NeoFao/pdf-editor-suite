/**
 * Piezas de la anatomía de diálogo del sistema de diseño (docs/ui/sistema-de-diseno.md §3):
 * `.dlg-cabecera` (título), `.dlg-cuerpo` y `.dlg-pie` (acciones a la derecha, la primaria la última).
 * Todo con nodos y `textContent` (AGENTS.md §2.2): los textos pueden venir de un documento.
 */

export type VarianteBoton = 'primario' | 'secundario' | 'fantasma' | 'peligro';

export function crearBoton(variante: VarianteBoton, texto: string, id?: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `btn btn--${variante}`;
  b.textContent = texto;
  if (id) b.id = id;
  return b;
}

/** Cabecera con el título (`h2.dlg-titulo`, que da el nombre accesible vía `mostrarModal`). */
export function crearCabecera(idTitulo: string, texto: string): { cabecera: HTMLElement; titulo: HTMLHeadingElement } {
  const cabecera = document.createElement('div');
  cabecera.className = 'dlg-cabecera';
  const titulo = document.createElement('h2');
  titulo.className = 'dlg-titulo';
  titulo.id = idTitulo;
  titulo.textContent = texto;
  cabecera.appendChild(titulo);
  return { cabecera, titulo };
}

export function crearCuerpo(...hijos: Node[]): HTMLElement {
  const c = document.createElement('div');
  c.className = 'dlg-cuerpo';
  c.append(...hijos);
  return c;
}

export function crearPie(...hijos: Node[]): HTMLElement {
  const p = document.createElement('div');
  p.className = 'dlg-pie';
  p.append(...hijos);
  return p;
}

/** Fila `.campo` de la rejilla `.campos` (etiqueta visible + control). */
export function crearCampo(etiqueta: string, control: HTMLElement, idControl: string): HTMLElement {
  const l = document.createElement('label');
  l.className = 'campo-etiqueta';
  l.htmlFor = idControl;
  l.textContent = etiqueta;
  const c = document.createElement('div');
  c.className = 'campo-control';
  c.appendChild(control);
  const f = document.createElement('div');
  f.className = 'campo';
  f.append(l, c);
  return f;
}

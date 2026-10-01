import type { OutlineItem } from '../engine/PdfEngine';
import { OUTLINE_MAX_DEPTH, OUTLINE_MAX_NODES } from '../engine/cotasOutline';

/**
 * Operaciones PURAS sobre el árbol de marcadores. Una `Ruta` son los índices
 * desde la raíz: [2, 0] = primer hijo del tercer marcador raíz. Ninguna
 * función muta su entrada: devuelven un árbol nuevo (o `null` si la operación
 * no es posible), lo que permite guardar el árbol anterior como "deshacer".
 */
export type Ruta = number[];

export function clonar(items: OutlineItem[]): OutlineItem[] {
  return items.map((i) => ({ title: i.title, pageIndex: i.pageIndex, children: clonar(i.children) }));
}

export function contarNodos(items: OutlineItem[]): number {
  let n = 0;
  for (const i of items) n += 1 + contarNodos(i.children);
  return n;
}

/** Profundidad (0 = una sola capa) del subárbol: 0 si no tiene hijos más hondos. */
function alturaSubarbol(item: OutlineItem): number {
  let max = 0;
  for (const h of item.children) max = Math.max(max, 1 + alturaSubarbol(h));
  return max;
}

export function obtener(items: OutlineItem[], ruta: Ruta): OutlineItem | null {
  let nivel = items;
  let item: OutlineItem | null = null;
  for (const idx of ruta) {
    item = nivel[idx] ?? null;
    if (!item) return null;
    nivel = item.children;
  }
  return item;
}

/** Lista que contiene al nodo de `ruta` (su hermandad) y su índice, sobre un árbol YA clonado. */
function hermandad(items: OutlineItem[], ruta: Ruta): { lista: OutlineItem[]; indice: number } | null {
  if (ruta.length === 0) return null;
  let lista = items;
  for (let i = 0; i < ruta.length - 1; i++) {
    const n = lista[ruta[i]!];
    if (!n) return null;
    lista = n.children;
  }
  const indice = ruta[ruta.length - 1]!;
  if (indice < 0 || indice >= lista.length) return null;
  return { lista, indice };
}

export interface Resultado { items: OutlineItem[]; ruta: Ruta }

/** Inserta `nuevo` como hermano justo DESPUÉS de `ruta` (o al final de la raíz si `ruta` es null). */
export function insertarHermano(items: OutlineItem[], ruta: Ruta | null, nuevo: OutlineItem): Resultado | null {
  if (contarNodos(items) + 1 > OUTLINE_MAX_NODES) return null;
  const copia = clonar(items);
  if (!ruta) { copia.push(nuevo); return { items: copia, ruta: [copia.length - 1] }; }
  const h = hermandad(copia, ruta);
  if (!h) return null;
  h.lista.splice(h.indice + 1, 0, nuevo);
  return { items: copia, ruta: [...ruta.slice(0, -1), h.indice + 1] };
}

/** Inserta `nuevo` como ÚLTIMO hijo de `ruta`. */
export function insertarHijo(items: OutlineItem[], ruta: Ruta, nuevo: OutlineItem): Resultado | null {
  if (contarNodos(items) + 1 > OUTLINE_MAX_NODES) return null;
  if (ruta.length + 1 > OUTLINE_MAX_DEPTH) return null;
  const copia = clonar(items);
  const padre = obtener(copia, ruta);
  if (!padre) return null;
  padre.children.push(nuevo);
  return { items: copia, ruta: [...ruta, padre.children.length - 1] };
}

/** Borra el nodo y todos sus hijos. */
export function borrar(items: OutlineItem[], ruta: Ruta): OutlineItem[] | null {
  const copia = clonar(items);
  const h = hermandad(copia, ruta);
  if (!h) return null;
  h.lista.splice(h.indice, 1);
  return copia;
}

export function renombrar(items: OutlineItem[], ruta: Ruta, titulo: string): OutlineItem[] | null {
  const copia = clonar(items);
  const n = obtener(copia, ruta);
  if (!n) return null;
  n.title = titulo;
  return copia;
}

export function cambiarDestino(items: OutlineItem[], ruta: Ruta, pageIndex: number): OutlineItem[] | null {
  const copia = clonar(items);
  const n = obtener(copia, ruta);
  if (!n) return null;
  n.pageIndex = pageIndex;
  return copia;
}

/** Intercambia con el hermano anterior (`-1`) o siguiente (`+1`). */
export function mover(items: OutlineItem[], ruta: Ruta, delta: -1 | 1): Resultado | null {
  const copia = clonar(items);
  const h = hermandad(copia, ruta);
  if (!h) return null;
  const destino = h.indice + delta;
  if (destino < 0 || destino >= h.lista.length) return null;
  const [n] = h.lista.splice(h.indice, 1);
  h.lista.splice(destino, 0, n!);
  return { items: copia, ruta: [...ruta.slice(0, -1), destino] };
}

/** Sangrar: pasa a ser último hijo de su hermano anterior. Imposible sin hermano anterior o si rebasa la profundidad máxima. */
export function sangrar(items: OutlineItem[], ruta: Ruta): Resultado | null {
  const copia = clonar(items);
  const h = hermandad(copia, ruta);
  if (!h || h.indice === 0) return null;
  const n = h.lista[h.indice]!;
  // Tras sangrar, el nodo está a profundidad ruta.length y su hoja más honda a ruta.length + altura.
  if (ruta.length + alturaSubarbol(n) > OUTLINE_MAX_DEPTH) return null;
  h.lista.splice(h.indice, 1);
  const anterior = h.lista[h.indice - 1]!;
  anterior.children.push(n);
  return { items: copia, ruta: [...ruta.slice(0, -1), h.indice - 1, anterior.children.length - 1] };
}

/** Desangrar: pasa a ser hermano siguiente de su padre; los hermanos posteriores pasan a ser sus hijos (como Acrobat/Word, no se pierde el orden). */
export function desangrar(items: OutlineItem[], ruta: Ruta): Resultado | null {
  if (ruta.length < 2) return null;
  const copia = clonar(items);
  const h = hermandad(copia, ruta);
  const rutaPadre = ruta.slice(0, -1);
  const hp = hermandad(copia, rutaPadre);
  if (!h || !hp) return null;
  const n = h.lista[h.indice]!;
  const posteriores = h.lista.splice(h.indice + 1);
  h.lista.splice(h.indice, 1);
  // Los hermanos posteriores quedan como hijos del nodo desangrado: así el orden global (preorden) no cambia.
  if (ruta.length - 1 + alturaSubarbol({ ...n, children: [...n.children, ...posteriores] }) > OUTLINE_MAX_DEPTH) return null;
  n.children.push(...posteriores);
  hp.lista.splice(hp.indice + 1, 0, n);
  return { items: copia, ruta: [...rutaPadre.slice(0, -1), hp.indice + 1] };
}

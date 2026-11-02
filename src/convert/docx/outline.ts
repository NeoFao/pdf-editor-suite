import type { OutlineItem } from '../../engine/PdfEngine';
import { OUTLINE_MAX_NODES } from '../../engine/cotasOutline';
import type { PosMarcador } from '../flujo/layout';
import { esParrafo, type ModeloDocx } from './modelo';

/**
 * Árbol de marcadores (outline) del PDF a partir de los títulos del cuerpo del documento Word (E-114), como el «Crear marcadores a
 * partir de títulos» de Word al exportar a PDF.
 *
 * Entrada: los párrafos del cuerpo con `titulo` (ya filtrados por `w:outlineLvl` efectivo 0-8, sin encabezados, pies, notas ni
 * celdas) y el registro de posiciones de `paginar` (`marcadores`: página 0-based + `yPt` del borde superior de la línea, pt PDF
 * con origen abajo, el mismo de los enlaces internos de E-106). Un título cuya marca no esté registrada se omite.
 *
 * Jerarquía: sigue el nivel. Si se salta un nivel (1 -> 3) el título cuelga del último de nivel inferior (no se inventan
 * marcadores intermedios). Un título sin ningún antecesor de nivel inferior (p. ej. un H2 al principio) es raíz.
 *
 * Sin títulos: `[]` (el conversor no escribe un outline vacío). Se acota a `OUTLINE_MAX_NODES` (el motor rechaza más).
 */
export function outlineDeTitulos(modelo: ModeloDocx, marcadores: ReadonlyMap<string, PosMarcador>): OutlineItem[] {
  const raiz: OutlineItem[] = [];
  const pila: { nivel: number; item: OutlineItem }[] = [];
  let total = 0;
  for (const bloque of modelo.bloques) {
    if (!esParrafo(bloque) || !bloque.titulo) continue;
    const pos = marcadores.get(bloque.titulo.marca);
    if (!pos) continue;
    if (total >= OUTLINE_MAX_NODES) break;
    total++;
    const item: OutlineItem = { title: bloque.titulo.texto, pageIndex: pos.page, yPt: pos.yPt, children: [] };
    while (pila.length > 0 && pila[pila.length - 1]!.nivel >= bloque.titulo.nivel) pila.pop();
    (pila.length > 0 ? pila[pila.length - 1]!.item.children : raiz).push(item);
    pila.push({ nivel: bloque.titulo.nivel, item });
  }
  return raiz;
}

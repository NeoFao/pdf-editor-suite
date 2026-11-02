import type { Inline } from './ast';

/**
 * Texto plano de una secuencia de inlines (sin marcas de formato): lo que se ve, no lo que se escribió. Una imagen
 * aporta su `alt`; un salto duro, un espacio; una referencia de nota, nada.
 */
export function textoPlano(nodos: Inline[]): string {
  let out = '';
  for (const n of nodos) {
    switch (n.type) {
      case 'text': case 'code': out += n.text; break;
      case 'strong': case 'em': case 'del': out += textoPlano(n.children); break;
      case 'link': out += n.children ? textoPlano(n.children) : n.text; break;
      case 'image': out += n.alt; break;
      case 'br': out += ' '; break;
      case 'footnote': break;
    }
  }
  return out;
}

/** Identificador de un título al estilo GitHub: minúsculas, sin puntuación (se conservan letras, números, `_` y `-`), espacios a `-`. */
export function slugTitulo(texto: string): string {
  return texto.toLowerCase().trim().replace(/[^\p{L}\p{N}\p{M} _-]/gu, '').replace(/ /g, '-');
}

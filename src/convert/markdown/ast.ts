/**
 * AST del subconjunto de Markdown que entiende este parser (§9 fila #32).
 * Módulo de solo TIPOS: sin lógica, para que `parse.ts` y `layout.ts` compartan
 * exactamente la misma forma de árbol sin importar uno del otro en círculo.
 */

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'strong'; children: Inline[] }
  | { type: 'em'; children: Inline[] }
  /** Tachado GFM `~~x~~` (E-119). */
  | { type: 'del'; children: Inline[] }
  | { type: 'code'; text: string }
  /** `children` solo está si el texto del enlace lleva formato (negrita, código, imagen...); `text` es siempre su versión plana. */
  | { type: 'link'; text: string; url: string; children?: Inline[] }
  /** Imagen `![alt](src)` (E-119). `src` es lo escrito: data:, ruta relativa o URL. */
  | { type: 'image'; alt: string; src: string }
  /** Salto de línea duro (dos espacios o `\` al final de línea). */
  | { type: 'br' }
  /** Referencia a una nota al pie GFM `[^id]` cuya definición existe. */
  | { type: 'footnote'; id: string };

export interface ListItem {
  /** Contenido en línea del propio ítem (las líneas de continuación se unen a él; sin párrafos múltiples dentro del ítem en esta fase). */
  children: Inline[];
  /** Lista anidada bajo este ítem, si la hay (hasta 3 niveles en total: 0, 1, 2). */
  sublist?: ListBlock;
  /** Lista de tareas GFM: `false` = `[ ]`, `true` = `[x]`; ausente = ítem normal. */
  task?: boolean;
}

export interface ListBlock {
  type: 'list';
  ordered: boolean;
  /** Número inicial si `ordered`; por defecto 1 si no se indica en el primer ítem. */
  start?: number;
  items: ListItem[];
  /** Lista "suelta": hay líneas en blanco entre sus ítems (más aire al maquetar). */
  loose?: boolean;
}

export type TablaAlineacion = 'left' | 'center' | 'right' | null;

export type Block =
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; children: Inline[] }
  | { type: 'paragraph'; children: Inline[] }
  | ListBlock
  | { type: 'blockquote'; children: Block[] }
  | { type: 'code'; text: string; lang?: string }
  | { type: 'hr' }
  /** Tabla GFM (E-119): `align` tiene una entrada por columna; `header` y cada fila tienen exactamente esa cantidad de celdas. */
  | { type: 'table'; align: TablaAlineacion[]; header: Inline[][]; rows: Inline[][][] }
  /** Notas al pie referenciadas, en orden de primera referencia (se añade al final del documento). */
  | { type: 'footnotes'; items: { id: string; children: Inline[] }[] };

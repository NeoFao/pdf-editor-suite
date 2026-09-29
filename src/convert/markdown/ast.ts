/**
 * AST del subconjunto de Markdown que entiende este parser (§9 fila #32).
 * Módulo de solo TIPOS: sin lógica, para que `parse.ts` y `layout.ts` compartan
 * exactamente la misma forma de árbol sin importar uno del otro en círculo.
 */

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'strong'; children: Inline[] }
  | { type: 'em'; children: Inline[] }
  | { type: 'code'; text: string }
  | { type: 'link'; text: string; url: string };

export interface ListItem {
  /** Contenido en línea del propio ítem (una sola línea lógica; sin párrafos múltiples dentro del ítem en esta fase). */
  children: Inline[];
  /** Lista anidada bajo este ítem, si la hay (hasta 3 niveles en total: 0, 1, 2). */
  sublist?: ListBlock;
}

export interface ListBlock {
  type: 'list';
  ordered: boolean;
  /** Número inicial si `ordered`; por defecto 1 si no se indica en el primer ítem. */
  start?: number;
  items: ListItem[];
}

export type Block =
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; children: Inline[] }
  | { type: 'paragraph'; children: Inline[] }
  | ListBlock
  | { type: 'blockquote'; children: Block[] }
  | { type: 'code'; text: string; lang?: string }
  | { type: 'hr' };

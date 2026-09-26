/** Tipos "branded": el compilador no deja mezclar unidades distintas por accidente. */
export type Pt = number & { readonly __unit: 'pdf-pt' };      // espacio PDF, origen abajo-izq, Y arriba
export type CssPx = number & { readonly __unit: 'css-px' };   // maquetación, origen arriba-izq, Y abajo

export const pt = (n: number): Pt => n as Pt;
export const css = (n: number): CssPx => n as CssPx;

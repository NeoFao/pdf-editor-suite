// Cotas del outline (E-031, docs/ERRORES-CONOCIDOS.md). Compartidas por el
// motor (lectura `getOutline` y escritura `setOutline`) y por la UI, que las
// usa para no ofrecer una operación (sangrar, crear) que el motor rechazaría.

/** Profundidad máxima: los marcadores raíz están en profundidad 0. */
export const OUTLINE_MAX_DEPTH = 32;
/** Total máximo de nodos del árbol. */
export const OUTLINE_MAX_NODES = 10000;

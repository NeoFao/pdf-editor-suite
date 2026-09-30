import { parseXml, hijosElemento } from './xml';

/**
 * Lector de `word/_rels/document.xml.rels` (§9 fila #4, fase 2a: imágenes y
 * enlaces). Formato mínimo de OPC (Open Packaging Conventions): un
 * `<Relationship Id="rIdN" Type="..." Target="..." TargetMode="External"?/>`
 * por relación. Solo interesan `Id`/`Target`/`TargetMode` — el `Type` no se
 * valida (basta con distinguir imagen de hipervínculo por CÓMO se usa el id
 * en `document.xml`: `r:embed` para imágenes, `r:id` de `w:hyperlink` para
 * enlaces).
 *
 * `Target` de una relación de IMAGEN es una ruta relativa a `word/` (p. ej.
 * `media/image1.png` → `word/media/image1.png`); `Target` de un
 * HIPERVÍNCULO externo (`TargetMode="External"`) es la URL completa tal
 * cual, sin resolver como ruta.
 */
export interface Relacion { target: string; targetMode: 'External' | 'Internal' | null }

export function leerRelaciones(relsXml: string): Map<string, Relacion> {
  const map = new Map<string, Relacion>();
  const root = parseXml(relsXml);
  for (const rel of hijosElemento(root, 'Relationship')) {
    const id = rel.atributos['Id'];
    const target = rel.atributos['Target'];
    if (!id || target === undefined) continue;
    const modo = rel.atributos['TargetMode'];
    map.set(id, { target, targetMode: modo === 'External' ? 'External' : modo === 'Internal' ? 'Internal' : null });
  }
  return map;
}

/** Ruta de un objetivo de imagen (relativo a `word/`) a la ruta completa dentro del ZIP del .docx. */
export function rutaMediaDesdeWord(target: string): string {
  if (target.startsWith('/')) return target.slice(1); // ruta absoluta dentro del paquete (raro, pero válida en OPC)
  return `word/${target}`;
}

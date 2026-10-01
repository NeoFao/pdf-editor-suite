/**
 * Validación de esquema para enlaces clicables (`addLink`, PR fase 2a).
 * PURA: sin FPDF_*, sin DOM — usada tanto por el motor (`PdfiumEngine.addLink`,
 * que la aplica como última línea de defensa) como por los conversores
 * (DOCX/Markdown), que así pueden avisar ANTES de intentar crear la anotación.
 *
 * Solo `http:`, `https:` y `mailto:` se consideran seguros. `javascript:`
 * ejecutaría código en el visor; `file:` expondría el sistema de ficheros
 * local; `data:` podría incrustar contenido arbitrario (incluido HTML/JS en
 * algunos visores) — un PDF es entrada no confiable (AGENTS.md §2, mismo
 * principio que E-003/E-027), así que la lista es de PERMITIDOS, no de
 * prohibidos: cualquier esquema no reconocido (incluido uno inventado) se
 * rechaza por igual.
 */

const ESQUEMAS_PERMITIDOS = new Set(['http:', 'https:', 'mailto:']);

/**
 * `url` si su esquema es uno de los permitidos, `null` en cualquier otro caso
 * (esquema no permitido, o `url` que ni siquiera es una URL absoluta válida
 * según `URL` — una ruta relativa como `"pagina.html"` tampoco produce un
 * destino resoluble para un enlace de PDF, así que también se rechaza).
 */
export function validarUrlEnlace(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!ESQUEMAS_PERMITIDOS.has(parsed.protocol)) return null;
  return url;
}

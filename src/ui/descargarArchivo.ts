/**
 * Único punto de descarga de la app nueva: crea una blob: URL, dispara el
 * clic en un `<a download>` y la revoca. `App.download` (PDF) y `TextPanel`
 * (.txt) comparten esta misma función en vez de duplicar cada uno su propio
 * `URL.createObjectURL`/`<a>` — un solo sitio que mantener si cambia el
 * mecanismo de descarga.
 */
export function descargarArchivo(data: BlobPart, filename: string, mimeType: string): void {
  const url = URL.createObjectURL(new Blob([data], { type: mimeType }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

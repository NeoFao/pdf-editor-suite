/**
 * Texto para anunciar con un lector de pantalla (región `aria-live` de `#status`): una sola línea, con
 * los espacios y saltos colapsados y truncado a `max` caracteres (no se lee una página entera).
 */
export function resumirParaAnunciar(texto: string, max = 80): string {
  const t = texto.replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

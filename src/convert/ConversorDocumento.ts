/**
 * Puerto de conversión "otro formato → PDF" (§9 fila #32). La UI (`App.ts`)
 * solo conoce esta interfaz y el registro de abajo: qué extensiones acepta
 * cada conversor y cómo convertir sus bytes. No sabe nada de Markdown, de
 * `.docx` ni de qué motor hace la conversión por dentro.
 *
 * Hoy solo hay una implementación registrada,
 * `ConversorMarkdownNavegador` (Markdown puro, 100% en el navegador, con el
 * motor PDFium — texto vectorial real, nunca rasteriza). El propio
 * dueño del proyecto pidió esto como un PUERTO explícito porque más
 * adelante una app de escritorio (Tauri) podrá registrar OTRA
 * implementación para el mismo puerto: un conversor de `.docx`/`.doc`/`.odt`
 * apoyado en LibreOffice o Word instalados localmente, con la misma forma
 * (`acepta`, `convertir`). Esa implementación futura se añade con
 * `registrarConversor()` en el arranque de la app de escritorio — `App.ts`
 * no cambia una línea: sigue preguntando a `conversorPara(extension)`.
 */
/**
 * Resultado de `convertir()`. `advertencias` amplía el puerto (§9 fila #4,
 * conversor DOCX -> PDF): advertencias tipadas (`{ tipo: 'omitido' | 'aproximado', mensaje }`, T13) con
 * mensajes en español, listos para mostrar TAL CUAL en la UI: `omitido` = contenido
 * del original que NO aparece en el PDF; `aproximado` = aparece pero distinto — la
 * honestidad de "no se pierde en silencio" (AGENTS.md, spec del lote) exige
 * que el conversor las DEVUELVA, no que las registre en consola. Se eligió
 * ampliar el tipo de retorno (en vez de un método opcional aparte,
 * `advertencias?()`) porque así el llamador (`App.ts`) no puede olvidarse de
 * mirarlas: vienen en el mismo resultado que el PDF, no en una llamada
 * adicional fácil de omitir. `ConversorMarkdownNavegador` devuelve siempre
 * `advertencias: []` (fase 1 de Markdown -> PDF ya avisaba de sus
 * limitaciones por comentario, no por UI; no hace falta que empiece a
 * generar advertencias ahora).
 */
import type { Advertencia } from './advertencia';

export interface ResultadoConversion {
  pdf: Uint8Array<ArrayBuffer>;
  advertencias: Advertencia[];
}

export interface ConversorDocumento {
  /** Extensiones que sabe convertir, sin punto y en minúsculas (p. ej. `['md', 'markdown']`). */
  readonly acepta: readonly string[];
  /** Nombre del formato de origen, para mensajes de la UI (p. ej. "Markdown", "Word"). */
  readonly nombreFuente: string;
  /** Convierte `bytes` (el fichero tal cual, con nombre `nombre` solo a efectos de mensajes/errores) a un PDF nuevo. */
  convertir(nombre: string, bytes: Uint8Array): Promise<ResultadoConversion>;
}

const registro: ConversorDocumento[] = [];

/** Añade un conversor al registro global. Pensado para llamarse una vez, al arrancar la app (ver `main.ts`). */
export function registrarConversor(c: ConversorDocumento): void {
  registro.push(c);
}

/** Todos los conversores registrados, en el orden en que se registraron. */
export function conversoresDisponibles(): readonly ConversorDocumento[] {
  return registro;
}

/** El primer conversor registrado que acepta `extension` (sin punto; no distingue mayúsculas). `null` si ninguno la acepta. */
export function conversorPara(extension: string): ConversorDocumento | null {
  const ext = extension.toLowerCase();
  return registro.find((c) => c.acepta.includes(ext)) ?? null;
}

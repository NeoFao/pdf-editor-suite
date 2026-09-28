import type { OcrLine } from './OcrProvider';

/**
 * Forma mínima de lo que devuelve `worker.recognize(..., { blocks: true }).data`
 * de tesseract.js. Solo declaramos los campos que leemos (texto y caja de cada
 * línea), no el tipo completo de la librería.
 */
interface TesseractBbox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface TesseractLine {
  text?: string;
  bbox?: TesseractBbox;
}

interface TesseractParagraph {
  lines?: TesseractLine[];
}

interface TesseractBlock {
  paragraphs?: TesseractParagraph[];
}

export interface TesseractData {
  blocks?: TesseractBlock[] | null;
  lines?: TesseractLine[];
}

/**
 * Convierte el resultado crudo de tesseract.js en `OcrLine[]`, imitando el
 * recorrido que ya usaba `convertScannedPageToLiveText` en la app vieja
 * (js/app.js): bloques → párrafos → líneas, con `data.lines` como respaldo
 * cuando ese recorrido no produce nada. Pura: no toca el DOM ni la red.
 */
export function tesseractDataToLines(data: TesseractData): OcrLine[] {
  const lines: OcrLine[] = [];

  for (const block of data.blocks ?? []) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const line of paragraph.lines ?? []) {
        pushLine(lines, line);
      }
    }
  }

  if (lines.length === 0) {
    for (const line of data.lines ?? []) {
      pushLine(lines, line);
    }
  }

  return lines;
}

function pushLine(out: OcrLine[], line: TesseractLine): void {
  const text = (line.text ?? '').trim();
  if (!text || !line.bbox) return;
  out.push({ text, bbox: line.bbox });
}

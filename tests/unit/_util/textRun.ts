import type { TextRun } from '../../../src/engine/PdfEngine';

/** Campos que un test indica; el resto se deriva (matriz identidad, tamaño efectivo = nominal, texto real = texto). */
export interface TextRunParcial {
  text: string;
  xPt: number;
  yPt: number;
  sizePt: number;
  runId?: number;
  fontName?: string;
  wPt?: number;
  color?: [number, number, number, number];
  /** Escala de la matriz (CTM de Chrome: 0,75). El tamaño efectivo sale de `sizePt × escala`. */
  escala?: number;
  /** Rotación del texto en grados antihorarios. */
  anguloDeg?: number;
  /** Avance natural; por defecto `text.length × efectivo × 0,5`. */
  avancePt?: number;
  renderMode?: number;
  espacioVirtualAntes?: boolean;
  textoReal?: string;
}

/** `TextRun` de prueba completo (para tests unitarios sin motor). Geometría en pt de usuario. */
export function crearTextRun(p: TextRunParcial): TextRun {
  const escala = p.escala ?? 1;
  const ang = ((p.anguloDeg ?? 0) * Math.PI) / 180;
  const efectivo = p.sizePt * escala;
  const avancePt = p.avancePt ?? p.text.length * efectivo * 0.5;
  const wPt = p.wPt ?? avancePt;
  return {
    runId: p.runId ?? 0,
    text: p.text,
    textoReal: p.textoReal ?? p.text,
    espacioVirtualAntes: p.espacioVirtualAntes ?? false,
    boxPt: { xPt: p.xPt, yPt: p.yPt, wPt, hPt: efectivo },
    fontName: p.fontName ?? 'Helvetica',
    sizePt: p.sizePt,
    sizeEfectivoPt: efectivo,
    matriz: [escala * Math.cos(ang), escala * Math.sin(ang), -escala * Math.sin(ang), escala * Math.cos(ang), p.xPt, p.yPt],
    avancePt,
    renderMode: p.renderMode ?? 0,
    fuenteSubconjunto: false,
    color: p.color ?? [0, 0, 0, 255],
    originPt: { xPt: p.xPt, yPt: p.yPt },
    anguloDeg: ((p.anguloDeg ?? 0) + 360) % 360
  };
}

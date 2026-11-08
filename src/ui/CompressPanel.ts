/**
 * Panel pequeño (modal, sin innerHTML — mismo patrón que `SignaturePad`) para
 * elegir calidad y DPI máximo antes de comprimir el documento (#29 de la
 * tabla de paridad, §9). `onConfirm` es async: el botón se deshabilita y el
 * panel se cierra solo al terminar, para que `App.runCompress` pueda mostrar
 * "Comprimiendo…" mientras corre sin que el usuario pueda lanzarlo dos veces.
 */
export interface OpcionesPanelCompresion { calidad: number; dpiMax: number }

/** Lo que el panel ofrece a quien comprime: avance visible y señal de cancelación (botón Cancelar o Escape). */
export interface ControlCompresion {
  /** Texto + fracción 0..1 en la barra de progreso (`role="progressbar"`). */
  progreso(texto: string, fraccion: number): void;
  signal: AbortSignal;
}

import { mostrarModal } from './dialogo';

const DPI_OPCIONES = [72, 150, 300];

export class CompressPanel {
  static open(onConfirm: (opciones: OpcionesPanelCompresion, control: ControlCompresion) => Promise<void>): void {
    // `<dialog>` modal (A-05): role implícito dialog, ::backdrop en lugar del overlay a mano.
    // Anatomía del sistema de diseño (E-130): cabecera, cuerpo con rejilla `.campos` y pie con la primaria la última.
    const panel = document.createElement('dialog');
    panel.id = 'compress-panel';
    panel.classList.add('compress-panel');

    const title = document.createElement('h2');
    title.id = 'compress-panel-titulo';
    title.className = 'dlg-titulo';
    title.textContent = 'Comprimir documento';
    const cabecera = document.createElement('div');
    cabecera.className = 'dlg-cabecera';
    cabecera.appendChild(title);

    /** Fila de `.campos`: etiqueta visible a la izquierda, control a la derecha. */
    const fila = (etiqueta: string, id: string, control: HTMLElement, extra?: HTMLElement): HTMLElement => {
      const label = document.createElement('label');
      label.className = 'campo-etiqueta';
      label.htmlFor = id;
      label.textContent = etiqueta;
      const ctl = document.createElement('div');
      ctl.className = 'campo-control';
      ctl.append(control);
      if (extra) ctl.append(extra);
      const f = document.createElement('div');
      f.className = 'campo';
      f.append(label, ctl);
      return f;
    };

    const quality = document.createElement('input');
    quality.type = 'range'; quality.id = 'compress-quality';
    quality.min = '10'; quality.max = '95'; quality.value = '70';
    quality.autofocus = true; // foco inicial en el primer campo
    const qualityValue = document.createElement('span');
    qualityValue.className = 'campo-extra';
    qualityValue.textContent = quality.value;
    quality.addEventListener('input', () => { qualityValue.textContent = quality.value; });

    const dpi = document.createElement('select');
    dpi.id = 'compress-dpi';
    for (const v of DPI_OPCIONES) {
      const opt = document.createElement('option');
      opt.value = String(v); opt.textContent = String(v);
      if (v === 150) opt.selected = true;
      dpi.appendChild(opt);
    }

    const campos = document.createElement('div');
    campos.className = 'campos';
    campos.append(fila('Calidad', 'compress-quality', quality, qualityValue), fila('DPI máximo', 'compress-dpi', dpi));

    // Progreso accesible: oculto hasta que empieza a comprimir.
    const progresoCaja = document.createElement('div');
    progresoCaja.className = 'progreso';
    progresoCaja.hidden = true;
    const progresoTexto = document.createElement('div');
    progresoTexto.id = 'compress-progress-text';
    progresoTexto.className = 'progreso-texto';
    progresoTexto.setAttribute('aria-live', 'polite');
    const progresoBarra = document.createElement('div');
    progresoBarra.id = 'compress-progress';
    progresoBarra.className = 'progreso-barra';
    progresoBarra.setAttribute('role', 'progressbar');
    progresoBarra.setAttribute('aria-label', 'Progreso de la compresión');
    progresoBarra.setAttribute('aria-valuemin', '0');
    progresoBarra.setAttribute('aria-valuemax', '100');
    progresoBarra.setAttribute('aria-valuenow', '0');
    const progresoRelleno = document.createElement('div');
    progresoRelleno.className = 'progreso-relleno';
    progresoRelleno.style.width = '0%'; // geometría calculada (fracción del avance)
    progresoBarra.appendChild(progresoRelleno);
    progresoCaja.append(progresoTexto, progresoBarra);

    const cuerpo = document.createElement('div');
    cuerpo.className = 'dlg-cuerpo';
    cuerpo.append(campos, progresoCaja);

    const barra = document.createElement('div');
    barra.className = 'dlg-pie';
    const btnCancel = document.createElement('button');
    btnCancel.id = 'compress-cancel'; btnCancel.type = 'button'; btnCancel.className = 'btn btn--secundario'; btnCancel.textContent = 'Cancelar';
    const btnRun = document.createElement('button');
    btnRun.id = 'btn-compress-run'; btnRun.type = 'button'; btnRun.className = 'btn btn--primario'; btnRun.textContent = 'Comprimir';

    let ocupado = false;
    const ctl = new AbortController();
    const close = (): void => panel.close();
    /** Mientras comprime, Cancelar y Escape abortan (no cierran: el panel se cierra cuando el comando ya restauró el documento). */
    const cancelarCompresion = (): void => {
      if (ctl.signal.aborted) return;
      ctl.abort();
      btnCancel.disabled = true;
      progresoTexto.textContent = 'Cancelando…';
    };
    btnCancel.addEventListener('click', () => { if (ocupado) cancelarCompresion(); else close(); });
    btnRun.addEventListener('click', () => {
      const calidad = Number(quality.value) / 100;
      const dpiMax = Number(dpi.value);
      ocupado = true;
      btnRun.disabled = true;
      progresoCaja.hidden = false;
      btnCancel.focus();
      const control: ControlCompresion = {
        signal: ctl.signal,
        progreso(texto, fraccion) {
          if (ctl.signal.aborted) return;
          progresoTexto.textContent = texto;
          const pct = Math.max(0, Math.min(100, Math.round(fraccion * 100)));
          progresoBarra.setAttribute('aria-valuenow', String(pct));
          progresoRelleno.style.width = pct + '%';
        }
      };
      void onConfirm({ calidad, dpiMax }, control).finally(close);
    });

    barra.append(btnCancel, btnRun);
    panel.append(cabecera, cuerpo, barra);
    mostrarModal(panel, {
      tituloId: 'compress-panel-titulo',
      // Escape durante la compresión cancela de forma explícita (y sigue vetando el cierre inmediato).
      puedeCerrar: () => { if (ocupado) cancelarCompresion(); return !ocupado; }
    });
  }
}

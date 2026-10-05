/**
 * Panel pequeño (modal, sin innerHTML — mismo patrón que `SignaturePad`) para
 * elegir calidad y DPI máximo antes de comprimir el documento (#29 de la
 * tabla de paridad, §9). `onConfirm` es async: el botón se deshabilita y el
 * panel se cierra solo al terminar, para que `App.runCompress` pueda mostrar
 * "Comprimiendo…" mientras corre sin que el usuario pueda lanzarlo dos veces.
 */
export interface OpcionesPanelCompresion { calidad: number; dpiMax: number }

import { mostrarModal } from './dialogo';

const DPI_OPCIONES = [72, 150, 300];

export class CompressPanel {
  static open(onConfirm: (opciones: OpcionesPanelCompresion) => Promise<void>): void {
    // `<dialog>` modal (A-05): role implícito dialog, ::backdrop en lugar del overlay a mano.
    const panel = document.createElement('dialog');
    panel.id = 'compress-panel';
    Object.assign(panel.style, {
      background: '#fff', color: '#000', padding: '16px', borderRadius: '8px', font: '14px sans-serif',
      flexDirection: 'column', gap: '10px', minWidth: '240px', border: 'none'
    });
    // `display:flex` solo con el diálogo abierto: ver `dialog.compress-panel[open]` en estilos.css.
    panel.classList.add('compress-panel');

    const title = document.createElement('div');
    title.id = 'compress-panel-titulo';
    title.textContent = 'Comprimir documento';
    title.style.fontWeight = 'bold';

    const qualityRow = document.createElement('div');
    Object.assign(qualityRow.style, { display: 'flex', alignItems: 'center', gap: '8px' });
    const qualityLabel = document.createElement('label');
    qualityLabel.textContent = 'Calidad:';
    qualityLabel.htmlFor = 'compress-quality';
    const quality = document.createElement('input');
    quality.type = 'range'; quality.id = 'compress-quality';
    quality.min = '10'; quality.max = '95'; quality.value = '70';
    const qualityValue = document.createElement('span');
    qualityValue.textContent = quality.value;
    quality.addEventListener('input', () => { qualityValue.textContent = quality.value; });
    qualityRow.append(qualityLabel, quality, qualityValue);

    const dpiRow = document.createElement('div');
    Object.assign(dpiRow.style, { display: 'flex', alignItems: 'center', gap: '8px' });
    const dpiLabel = document.createElement('label');
    dpiLabel.textContent = 'DPI máximo:';
    dpiLabel.htmlFor = 'compress-dpi';
    const dpi = document.createElement('select');
    dpi.id = 'compress-dpi';
    for (const v of DPI_OPCIONES) {
      const opt = document.createElement('option');
      opt.value = String(v); opt.textContent = String(v);
      if (v === 150) opt.selected = true;
      dpi.appendChild(opt);
    }
    dpiRow.append(dpiLabel, dpi);

    const barra = document.createElement('div');
    Object.assign(barra.style, { display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '4px' });
    const btnCancel = document.createElement('button');
    btnCancel.id = 'compress-cancel'; btnCancel.textContent = 'Cancelar';
    const btnRun = document.createElement('button');
    btnRun.id = 'btn-compress-run'; btnRun.textContent = 'Comprimir';

    let ocupado = false;
    const close = (): void => panel.close();
    btnCancel.addEventListener('click', close);
    btnRun.addEventListener('click', () => {
      const calidad = Number(quality.value) / 100;
      const dpiMax = Number(dpi.value);
      ocupado = true;
      btnRun.disabled = true;
      btnCancel.disabled = true;
      void onConfirm({ calidad, dpiMax }).finally(close);
    });

    barra.append(btnCancel, btnRun);
    panel.append(title, qualityRow, dpiRow, barra);
    mostrarModal(panel, { tituloId: 'compress-panel-titulo', puedeCerrar: () => !ocupado });
  }
}

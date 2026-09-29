/**
 * Panel pequeño (modal, sin innerHTML — mismo patrón que `SignaturePad`) para
 * elegir calidad y DPI máximo antes de comprimir el documento (#29 de la
 * tabla de paridad, §9). `onConfirm` es async: el botón se deshabilita y el
 * panel se cierra solo al terminar, para que `App.runCompress` pueda mostrar
 * "Comprimiendo…" mientras corre sin que el usuario pueda lanzarlo dos veces.
 */
export interface OpcionesPanelCompresion { calidad: number; dpiMax: number }

const DPI_OPCIONES = [72, 150, 300];

export class CompressPanel {
  static open(onConfirm: (opciones: OpcionesPanelCompresion) => Promise<void>): void {
    const overlay = document.createElement('div');
    overlay.id = 'compress-panel';
    Object.assign(overlay.style, {
      position: 'fixed', inset: '0', background: 'rgba(0,0,0,.45)', display: 'flex',
      alignItems: 'center', justifyContent: 'center', zIndex: '1000'
    });

    const panel = document.createElement('div');
    Object.assign(panel.style, {
      background: '#fff', padding: '16px', borderRadius: '8px', font: '14px sans-serif',
      display: 'flex', flexDirection: 'column', gap: '10px', minWidth: '240px'
    });

    const title = document.createElement('div');
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

    const close = (): void => overlay.remove();
    btnCancel.addEventListener('click', close);
    btnRun.addEventListener('click', () => {
      const calidad = Number(quality.value) / 100;
      const dpiMax = Number(dpi.value);
      btnRun.disabled = true;
      btnCancel.disabled = true;
      void onConfirm({ calidad, dpiMax }).finally(close);
    });

    barra.append(btnCancel, btnRun);
    panel.append(title, qualityRow, dpiRow, barra);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
  }
}

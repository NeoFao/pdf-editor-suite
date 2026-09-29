import type { Page } from '@playwright/test';

/**
 * Rediseño de interfaz: los controles de edición ahora viven agrupados en
 * pestañas (`role="tablist"`, ver `src/ui/App.ts`) con su propia barra
 * contextual — solo la pestaña activa se ve en escritorio (≥1024px, el
 * viewport por defecto del proyecto `next`, 1440×900). "Editar" es la
 * pestaña activa por defecto; un test que ejercite un control de otra
 * pestaña (Comentar/Organizar/Rellenar y firmar/Convertir) necesita
 * activarla primero — con normalidad, como haría alguien usando la app, no
 * como un atajo de test.
 *
 * Cambio puramente de navegación visual (qué pestaña está abierta), no de
 * comportamiento: los `id` y el cableado de cada control no cambian.
 */
export type Pestana = 'editar' | 'comentar' | 'organizar' | 'firmar' | 'convertir';

export async function abrirPestana(page: Page, pestana: Pestana): Promise<void> {
  await page.locator(`#tab-${pestana}`).click();
}

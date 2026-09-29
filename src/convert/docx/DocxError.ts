/** Error tipado del conversor DOCX -> PDF, con mensaje en español listo para mostrar en la UI. */
export class DocxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DocxError';
  }
}

import { createHash } from 'crypto';
import sharp from 'sharp';
import { PDFDocument, PDFRef, rgb } from 'pdf-lib';
import { Stage1RedactionMask } from '@shared/types';

export interface DecodedStage1File {
  mimeType: string;
  bytes: Buffer;
  sha256: string;
}

export function decodeStage1DataUrl(value: string | undefined): DecodedStage1File | null {
  if (!value || !value.startsWith('data:')) return null;
  const match = value.match(/^data:([^;]+);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return null;
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length === 0) return null;
  return { mimeType: match[1], bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
}

export function validateStage1Masks(value: unknown, pageCount: number): Stage1RedactionMask[] {
  if (!Array.isArray(value)) throw new Error('Redaction masks must be an array.');
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`Mask ${index + 1} is invalid.`);
    const mask = item as Record<string, unknown>;
    const page = Number(mask.page);
    const x = Number(mask.x);
    const y = Number(mask.y);
    const width = Number(mask.width);
    const height = Number(mask.height);
    if (!Number.isInteger(page) || page < 1 || page > pageCount || ![x, y, width, height].every(Number.isFinite)
      || x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1 || y + height > 1) {
      throw new Error(`Mask ${index + 1} is outside the page bounds.`);
    }
    const categories = new Set(['government_id', 'contact', 'address', 'signature', 'payment', 'qr_or_barcode', 'personal_identifier', 'other']);
    const category = typeof mask.category === 'string' && categories.has(mask.category) ? mask.category : 'other';
    const source = mask.source === 'admin' ? 'admin' : 'minimax';
    return { page, x, y, width, height, category: category as Stage1RedactionMask['category'], source };
  });
}

export async function renderBlackRedaction(file: DecodedStage1File, masks: Stage1RedactionMask[]): Promise<{ dataUrl: string; pageCount: number }> {
  if (file.mimeType === 'application/pdf') {
    const pdf = await PDFDocument.load(file.bytes, { ignoreEncryption: false, updateMetadata: true });
    pdf.setTitle('');
    pdf.setAuthor('');
    pdf.setSubject('');
    pdf.setKeywords([]);
    const pages = pdf.getPages();
    // Flatten form fields and remove page annotations before writing the
    // public copy. This prevents interactive fields, links and annotation
    // payloads from surviving alongside the irreversible black overlays.
    try {
      pdf.getForm().flatten();
    } catch {
      // A file without a form is valid; continue with annotation cleanup.
    }
    pages.forEach((page) => {
      const annotations = page.node.Annots();
      if (!annotations) return;
      for (let index = annotations.size() - 1; index >= 0; index -= 1) {
        const annotation = annotations.get(index);
        if (annotation instanceof PDFRef) page.node.removeAnnot(annotation);
      }
    });
    pages.forEach((page, index) => {
      const { width, height } = page.getSize();
      masks.filter((mask) => mask.page === index + 1).forEach((mask) => page.drawRectangle({
        x: mask.x * width,
        y: height - (mask.y + mask.height) * height,
        width: mask.width * width,
        height: mask.height * height,
        color: rgb(0, 0, 0),
        opacity: 1,
      }));
    });
    const bytes = Buffer.from(await pdf.save({ useObjectStreams: false }));
    return { dataUrl: `data:application/pdf;base64,${bytes.toString('base64')}`, pageCount: pages.length };
  }
  if (!['image/jpeg', 'image/png'].includes(file.mimeType)) throw new Error('Only PDF, JPEG and PNG Stage 1 files can be redacted.');
  const image = sharp(file.bytes);
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height) throw new Error('Image dimensions are unavailable.');
  const imageWidth = metadata.width;
  const imageHeight = metadata.height;
  const pageMasks = masks.filter((mask) => mask.page === 1);
  const overlay = Buffer.from(`<svg width="${imageWidth}" height="${imageHeight}" xmlns="http://www.w3.org/2000/svg">${pageMasks.map((mask) => `<rect x="${mask.x * imageWidth}" y="${mask.y * imageHeight}" width="${mask.width * imageWidth}" height="${mask.height * imageHeight}" fill="black"/>`).join('')}</svg>`);
  const output = await image.composite([{ input: overlay, blend: 'over' }]).toBuffer();
  return { dataUrl: `data:${file.mimeType};base64,${output.toString('base64')}`, pageCount: 1 };
}

export function sourceHashForDeclaration(eventId: string, versionId: string, controlId: string, docId: string, revision: number): string {
  return createHash('sha256').update(`${eventId}:${versionId}:${controlId}:${docId}:${revision}:use_previous`).digest('hex');
}

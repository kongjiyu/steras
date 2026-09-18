import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import {
  decodeStage1DataUrl,
  renderBlackRedaction,
  sourceHashForDeclaration,
  validateStage1Masks,
} from './stage1Redaction';

describe('Stage 1 redaction helpers', () => {
  it('decodes data URLs and produces a stable declaration source hash', () => {
    const decoded = decodeStage1DataUrl('data:text/plain;base64,SGVsbG8=');
    expect(decoded?.mimeType).toBe('text/plain');
    expect(decoded?.bytes.toString()).toBe('Hello');
    expect(decoded?.sha256).toHaveLength(64);
    expect(sourceHashForDeclaration('event-1', 'v1', 'control-1', 'doc-1', 2))
      .toBe(sourceHashForDeclaration('event-1', 'v1', 'control-1', 'doc-1', 2));
    expect(sourceHashForDeclaration('event-1', 'v1', 'control-1', 'doc-1', 2))
      .not.toBe(sourceHashForDeclaration('event-1', 'v1', 'control-1', 'doc-1', 3));
  });

  it('rejects masks outside a page and normalises unknown categories to other', () => {
    expect(validateStage1Masks([{ page: 1, x: 0.1, y: 0.2, width: 0.3, height: 0.4, category: 'not-a-category' }], 1))
      .toMatchObject([{ category: 'other', source: 'minimax' }]);
    expect(() => validateStage1Masks([{ page: 1, x: 0.8, y: 0, width: 0.3, height: 0.2 }], 1))
      .toThrow('outside the page bounds');
    expect(() => validateStage1Masks([{ page: 2, x: 0, y: 0, width: 0.2, height: 0.2 }], 1))
      .toThrow('outside the page bounds');
  });

  it('burns an irreversible black rectangle into an image', async () => {
    const source = await sharp({
      create: { width: 10, height: 10, channels: 3, background: { r: 255, g: 255, b: 255 } },
    }).png().toBuffer();
    const result = await renderBlackRedaction(
      decodeStage1DataUrl(`data:image/png;base64,${source.toString('base64')}`)!,
      [{ page: 1, x: 0.4, y: 0.4, width: 0.2, height: 0.2, category: 'contact', source: 'admin' }],
    );
    const redacted = decodeStage1DataUrl(result.dataUrl)!;
    const { data: pixels, info } = await sharp(redacted.bytes).raw().toBuffer({ resolveWithObject: true });
    const center = (5 * info.width + 5) * info.channels;
    expect([...pixels.subarray(center, center + 3)]).toEqual([0, 0, 0]);
    expect([...pixels.subarray(0, 3)]).toEqual([255, 255, 255]);
    expect(result.pageCount).toBe(1);
  });
});

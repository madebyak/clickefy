import { describe, expect, it } from 'vitest';

import {
  danglingReferenceTokens,
  findReferenceTokens,
  mapReferenceTokens,
  referenceCounts,
  referenceNumbers,
  referenceToken,
  translateReferenceTokens,
} from './reference-tokens';

describe('findReferenceTokens', () => {
  it('finds canonical, lower-case and underscore spellings', () => {
    const found = findReferenceTokens('Put @Image2 on @image1, with @video_1 and @AUDIO3.');
    expect(found.map((t) => [t.kind, t.n])).toEqual([
      ['image', 2],
      ['image', 1],
      ['video', 1],
      ['audio', 3],
    ]);
  });

  it('ignores lookalikes', () => {
    expect(findReferenceTokens('mail me@images1.com, @image, @image0, @imagex1, @image12b')).toEqual([]);
  });

  it('works inside Arabic text', () => {
    const found = findReferenceTokens('ضع السترة من @Image2 على الرجل في @Image1');
    expect(found.map((t) => t.n)).toEqual([2, 1]);
  });
});

describe('numbering', () => {
  it('numbers per kind in tray order', () => {
    expect(referenceNumbers(['image', 'video', 'image', 'audio', 'video'])).toEqual([1, 1, 2, 1, 2]);
    expect(referenceCounts(['image', 'video', 'image'])).toEqual({ image: 2, video: 1, audio: 0 });
    expect(referenceToken('video', 2)).toBe('@Video2');
  });
});

describe('mapReferenceTokens', () => {
  it('renumbers after a reorder', () => {
    // Images swapped: old 1 → 2, old 2 → 1.
    const swapped = mapReferenceTokens('the jacket from @Image2 on the man in @Image1', (t) =>
      t.kind === 'image' ? referenceToken('image', t.n === 1 ? 2 : 1) : undefined,
    );
    expect(swapped).toBe('the jacket from @Image1 on the man in @Image2');
  });

  it('deletes a removed attachment’s token without leaving a double space', () => {
    expect(mapReferenceTokens('style of @Image1 with @Image2 lighting', (t) => (t.n === 1 ? null : '@Image1'))).toBe(
      'style of with @Image1 lighting',
    );
    expect(mapReferenceTokens('ends with @Image1', () => null)).toBe('ends with');
    expect(mapReferenceTokens('@Image1 at start', () => null)).toBe('at start');
  });

  it('leaves tokens alone when told to', () => {
    expect(mapReferenceTokens('keep @image_3 as typed', () => undefined)).toBe('keep @image_3 as typed');
  });
});

describe('danglingReferenceTokens', () => {
  it('flags tokens beyond what is attached', () => {
    const d = danglingReferenceTokens('@Image1 @Image3 @Video1', { image: 2, video: 0, audio: 0 });
    expect(d.map((t) => t.text)).toEqual(['@Image3', '@Video1']);
  });
});

describe('translateReferenceTokens', () => {
  const counts = { image: 2, video: 1, audio: 1 };
  const prompt = 'Put the jacket from @image2 on @Image1, motion from @Video1, music @audio_1';

  it('Seedance: canonical per-kind tokens', () => {
    expect(translateReferenceTokens(prompt, 'seedance', counts)).toBe(
      'Put the jacket from @Image2 on @Image1, motion from @Video1, music @Audio1',
    );
  });

  it('Kling: @image_N ids', () => {
    expect(translateReferenceTokens('jacket @Image2 on @Image1', 'kling', counts)).toBe(
      'jacket @image_2 on @image_1',
    );
  });

  it('prose for image models', () => {
    expect(translateReferenceTokens('jacket from @Image2 on @Image1', 'prose', counts)).toBe(
      'jacket from image 2 on image 1',
    );
  });

  it('leaves out-of-range tokens as typed', () => {
    expect(translateReferenceTokens('@Image5', 'kling', counts)).toBe('@Image5');
  });
});

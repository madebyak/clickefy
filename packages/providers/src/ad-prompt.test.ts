import { describe, expect, it } from 'vitest';

import { AD_MAX_BRIEF_CHARS, buildAdBrief, extractAdPrompt } from './ad-prompt';

describe('buildAdBrief', () => {
  it('speaks of one image or several, and appends the note only when given', () => {
    const one = buildAdBrief({ imageCount: 1 });
    expect(one).toContain('I will give you one product image.');
    expect(one).toContain('From the image, determine');
    expect(one).not.toContain('Important Note');
    const many = buildAdBrief({ imageCount: 3, notes: ' show it by the pool ' });
    expect(many).toContain('3 images of the same product');
    expect(many).toContain('attached images are the product reference');
    expect(many.endsWith('Important Note: "show it by the pool"')).toBe(true);
    expect(many).toContain('15-second');
    expect(many.length).toBeLessThanOrEqual(AD_MAX_BRIEF_CHARS);
  });
});

const GOOD = `REFERENCE: The attached image is the product reference. The bottle stays identical in every shot: same shape, proportions, colors, materials and label layout; label text and logo are never redrawn.
CONCEPT: A single drop of citrus oil falls through morning light and awakens a glass bottle of cold-pressed juice on a marble counter.
LOOK: Shot on ARRI Alexa 35 with Cooke S7/i primes: shallow depth of field, smooth focus falloff, gentle highlight roll-off, fine film grain, warm contrast. Low morning key light from camera left, amber and ivory palette drawn from the juice.
TIMELINE:
0-4s HOOK: extreme close-up, eye level, macro slide along a wet marble edge as a single orange drop quivers and falls; soft backlight.
4-8s REVEAL: medium shot, low angle, slow push-in as the drop lands on the bottle cap and the bottle rises into frame, label clearly readable.
8-12s PAYOFF: close-up, high angle, orbit as the juice pours into a glass, pulp catching the light.
12-15s HERO: wide packshot, straight on, crane up settles; bottle centered, label facing camera, motion holds still for the last second.
SPEED: slow motion at the drop's impact in the reveal, snapping back to real time as the bottle rises; a second ramp at the pour's peak.
AUDIO: a soft drip, marble resonance, a cold pour with pulp, glass settling; a warm string pad that builds and resolves on the hero frame. No voiceover.
AVOID: on-screen text, subtitles, watermarks, extra logos, other brands, warped label, duplicated bottles, distorted hands, flicker, morphing.`;

describe('extractAdPrompt', () => {
  it('takes the fenced block and keeps a well-formed prompt', () => {
    const out = extractAdPrompt('Here you go:\n```text\n' + GOOD + '\n```\nHope this helps!');
    expect(out).toBe(GOOD);
    expect(extractAdPrompt(GOOD)).toBe(GOOD);
  });
  it('rejects chatter, fragments and prompts missing the structure', () => {
    expect(extractAdPrompt('Sure! What product is it?')).toBeNull();
    expect(extractAdPrompt(GOOD.replace('TIMELINE:', 'SHOTS:'))).toBeNull();
    expect(extractAdPrompt(GOOD.slice(0, 200))).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';

import {
  MAX_SEARCH_TOKENS,
  SEARCH_FOLD_FROM,
  SEARCH_FOLD_TO,
  matchesSearch,
  normalizeSearchText,
  searchNeedles,
  searchTokens,
} from './search-text';

describe('searchTokens', () => {
  it('splits into lowercase words and collapses whitespace', () => {
    expect(searchTokens('  Retro   SET ')).toEqual(['retro', 'set']);
  });

  it('trims punctuation from word edges and drops punctuation-only words', () => {
    expect(searchTokens('set, «ريترو» — !')).toEqual(['set', 'ريترو']);
  });

  it('de-duplicates and caps the word count', () => {
    expect(searchTokens('a a b')).toEqual(['a', 'b']);
    const many = Array.from({ length: 20 }, (_, i) => `w${i}`).join(' ');
    expect(searchTokens(many)).toHaveLength(MAX_SEARCH_TOKENS);
  });

  it('is empty for a blank query', () => {
    expect(searchTokens('   ')).toEqual([]);
  });
});

describe('normalizeSearchText — Arabic folding', () => {
  it('folds alef, teh marbuta, alef maksura, hamza carriers', () => {
    expect(normalizeSearchText('أحمد')).toBe(normalizeSearchText('احمد'));
    expect(normalizeSearchText('إعلان')).toBe(normalizeSearchText('اعلان'));
    expect(normalizeSearchText('صورة')).toBe(normalizeSearchText('صوره'));
    expect(normalizeSearchText('مستشفى')).toBe(normalizeSearchText('مستشفي'));
  });

  it('removes diacritics and tatweel', () => {
    expect(normalizeSearchText('مَجُوهَرَات')).toBe('مجوهرات');
    expect(normalizeSearchText('قـــالب')).toBe('قالب');
  });

  it('keeps the SQL translate() mapping aligned with the JS fold', () => {
    // 8 letters map one-to-one; everything after them in FROM is deleted.
    expect(SEARCH_FOLD_TO).toHaveLength(8);
    expect(SEARCH_FOLD_FROM.length).toBeGreaterThan(SEARCH_FOLD_TO.length);
    for (const ch of SEARCH_FOLD_FROM.slice(SEARCH_FOLD_TO.length)) {
      expect(normalizeSearchText(`a${ch}b`)).toBe('ab');
    }
  });
});

describe('matchesSearch', () => {
  it('matches every word in any order, not the exact phrase', () => {
    expect(matchesSearch('Retro Menswear Lounge Set', searchTokens('retro set'))).toBe(true);
    expect(matchesSearch('Museum Food Display Ad', searchTokens('food ad'))).toBe(true);
    expect(matchesSearch('Museum Food Display Ad', searchTokens('food retro'))).toBe(false);
  });

  it('matches Arabic regardless of spelling variants', () => {
    expect(matchesSearch('طقم رجالي بطابع ريترو', searchTokens('ريترو'))).toBe(true);
    expect(matchesSearch('إعلان للمجوهرات', searchTokens('اعلان مجوهرات'))).toBe(true);
  });

  it('matches Latin words at word starts only', () => {
    expect(matchesSearch('Jewelry Editorial Shoot', searchTokens('jewel'))).toBe(true);
    expect(matchesSearch('Handmade shadow study', searchTokens('ad'))).toBe(false);
    expect(matchesSearch('Summer ads (retro)', searchTokens('ad retro'))).toBe(true);
  });

  it('matches Arabic words inside prefixed words', () => {
    expect(matchesSearch('مجموعة صور تحريرية للمجوهرات', searchTokens('مجوهرات'))).toBe(true);
    expect(searchNeedles(searchTokens('retro مجوهرات'))).toEqual([' retro', 'مجوهرات']);
  });

  it('matches everything when there are no tokens', () => {
    expect(matchesSearch('anything', [])).toBe(true);
  });
});

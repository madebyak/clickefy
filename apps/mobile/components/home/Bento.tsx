import type { CatalogTemplate } from '@clickfy/sdk';
import { Stack } from '@clickfy/ui';
import { View } from 'react-native';

import { TemplateCard } from './TemplateCard';

export interface BentoProps {
  templates: CatalogTemplate[];
  /**
   * Optional callback fired on card tap. When omitted, the card falls
   * back to its built-in `router.push('/template/{id}')` behaviour —
   * which is what the home screen wants 95% of the time.
   */
  onTemplatePress?: (id: string) => void;
}

/**
 * Bento layout — 1 hero (16/10) + 2 paired below.
 * Used for "Trending now" rail on home.
 */
export function Bento({ templates, onTemplatePress }: BentoProps) {
  if (templates.length === 0) return null;
  const [hero, ...rest] = templates;
  if (!hero) return null;
  const pair = rest.slice(0, 2);
  const trio = rest.slice(2, 4);

  // Only forward `onPress` when the parent actually provided a handler.
  // Otherwise we'd be replacing the card's default router-push with a
  // no-op, which is why "Trending" cards were silently unclickable.
  const press = (id: string) =>
    onTemplatePress ? () => onTemplatePress(id) : undefined;

  return (
    <Stack px="lg" gap="md">
      <TemplateCard template={hero} aspect="16/10" onPress={press(hero.id)} />
      {pair.length > 0 ? (
        <View style={{ flexDirection: 'row', gap: 14 }}>
          {pair.map((tpl) => (
            <View key={tpl.id} style={{ flex: 1 }}>
              <TemplateCard template={tpl} onPress={press(tpl.id)} />
            </View>
          ))}
        </View>
      ) : null}
      {trio.length === 2 ? (
        <View style={{ flexDirection: 'row', gap: 14 }}>
          {trio.map((tpl) => (
            <View key={tpl.id} style={{ flex: 1 }}>
              <TemplateCard template={tpl} onPress={press(tpl.id)} />
            </View>
          ))}
        </View>
      ) : null}
    </Stack>
  );
}

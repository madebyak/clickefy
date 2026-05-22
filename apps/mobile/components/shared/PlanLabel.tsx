/**
 * PlanLabel — the small text+badge cluster shown next to credits.
 *
 * Free  → uppercase "FREE" text only, muted ink. No badge icon.
 * Pro / paid plans → "PRO" text in accent.deep + filled SealCheck
 *                    "verified" mark colored by tier:
 *                      - "Pro Max" / "Ultra" / "Premium" / "Gold" → gold (#F0B33A)
 *                      - everything else paid → accent.solid (theme accent)
 *
 * Rationale: the verified-style seal reads instantly as "this user has a
 * paid badge" — same affordance Twitter/X uses for blue/gold checks. Free
 * accounts deliberately get no icon so the visual reward of upgrading is
 * obvious. Tier-driven colour keeps it future-proof: add a new tier name
 * to `GOLD_TIER_KEYS` and it picks up gold automatically.
 */

import { HStack, Text, useTheme } from '@clickfy/ui';

import { Icon } from '@/components/ui/Icon';

const GOLD_TIER_KEYS = new Set(['pro max', 'ultra', 'premium', 'gold']);

function isFreeTier(plan: string): boolean {
  return plan.trim().toLowerCase() === 'free';
}

function isGoldTier(plan: string): boolean {
  return GOLD_TIER_KEYS.has(plan.trim().toLowerCase());
}

export interface PlanLabelProps {
  /** Plan tier label as it should appear (e.g. "Free", "Pro", "Pro Max"). */
  plan: string;
  /** Display size. Default 'sm' matches the TopBar pill. */
  size?: 'sm' | 'md';
}

export function PlanLabel({ plan, size = 'sm' }: PlanLabelProps) {
  const { colors, accent } = useTheme();

  const free = isFreeTier(plan);
  const gold = isGoldTier(plan);

  const fontSize = size === 'sm' ? 10.5 : 12;
  const iconSize = size === 'sm' ? 12 : 14;

  const sealColor = gold ? '#F0B33A' : accent.solid;
  const textColor = free ? colors.inkMuted : colors.ink;

  return (
    <HStack align="center" gap="xs">
      <Text
        weight="700"
        transform="uppercase"
        style={{ color: textColor, fontSize, letterSpacing: 0.6, lineHeight: fontSize * 1.15 }}
      >
        {plan}
      </Text>
      {!free ? (
        <Icon name="planVerified" size={iconSize} color={sealColor} weight="fill" />
      ) : null}
    </HStack>
  );
}

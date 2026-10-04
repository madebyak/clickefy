import type { LucideIcon } from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';

interface Props {
  label: string;
  value: string;
  hint?: string;
  icon: LucideIcon;
  tone?: string;
}

export function Kpi({ label, value, hint, icon: Icon, tone = 'text-foreground' }: Props) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardDescription className="text-sm font-medium">{label}</CardDescription>
        <Icon className={`h-4 w-4 ${tone}`} />
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-bold tabular-nums ${tone}`}>{value}</div>
        {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}

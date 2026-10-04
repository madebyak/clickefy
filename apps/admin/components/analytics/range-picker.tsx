'use client';

import { useState } from 'react';
import { CalendarDays } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RANGE_PRESET_LABELS, presetOf, presetRange, type RangePreset } from '@/lib/analytics-format';

interface Props {
  from: string;
  to: string;
  onChange: (range: { from: string; to: string }) => void;
}

/** Preset dropdown plus two date inputs; every date is a Dubai calendar day. */
export function RangePicker({ from, to, onChange }: Props) {
  const preset = presetOf(from, to);
  const [custom, setCustom] = useState(preset === 'custom');
  const showInputs = custom || preset === 'custom';

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={preset}
        onValueChange={(v) => {
          const p = v as RangePreset;
          if (p === 'custom') { setCustom(true); return; }
          setCustom(false);
          onChange(presetRange(p));
        }}
      >
        <SelectTrigger className="w-40">
          <CalendarDays className="mr-2 h-4 w-4 text-muted-foreground" />
          <SelectValue placeholder="Range">{(val) => RANGE_PRESET_LABELS[val as RangePreset] ?? 'Range'}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(RANGE_PRESET_LABELS) as RangePreset[]).map((p) => (
            <SelectItem key={p} value={p}>{RANGE_PRESET_LABELS[p]}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {showInputs && (
        <div className="flex items-center gap-1.5">
          <Input type="date" value={from} max={to} onChange={(e) => e.target.value && onChange({ from: e.target.value, to })} className="w-36" />
          <span className="text-xs text-muted-foreground">to</span>
          <Input type="date" value={to} min={from} onChange={(e) => e.target.value && onChange({ from, to: e.target.value })} className="w-36" />
        </div>
      )}
    </div>
  );
}

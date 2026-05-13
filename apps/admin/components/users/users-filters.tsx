'use client';

import { Input } from '@/components/ui/input';
import { Search } from 'lucide-react';

interface UsersFiltersProps {
  search: string;
  creditsMin: string;
  creditsMax: string;
  onSearchChange: (value: string) => void;
  onCreditsMinChange: (value: string) => void;
  onCreditsMaxChange: (value: string) => void;
}

export function UsersFilters({
  search,
  creditsMin,
  creditsMax,
  onSearchChange,
  onCreditsMinChange,
  onCreditsMaxChange,
}: UsersFiltersProps) {
  return (
    <div className="flex flex-col sm:flex-row gap-3">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by email, name, or Clerk id…"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-9"
        />
      </div>

      <div className="flex items-center gap-2">
        <Input
          type="number"
          inputMode="numeric"
          placeholder="Credits min"
          value={creditsMin}
          onChange={(e) => onCreditsMinChange(e.target.value)}
          className="w-32"
        />
        <span className="text-muted-foreground text-sm">–</span>
        <Input
          type="number"
          inputMode="numeric"
          placeholder="Credits max"
          value={creditsMax}
          onChange={(e) => onCreditsMaxChange(e.target.value)}
          className="w-32"
        />
      </div>
    </div>
  );
}

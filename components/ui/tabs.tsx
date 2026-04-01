'use client';

import { cn } from '@/lib/utils/cn';

interface Tab {
  id: string;
  label: string;
  icon?: React.ReactNode;
}

interface TabsProps {
  tabs: Tab[];
  activeTab: string;
  onChange: (tabId: string) => void;
}

/**
 * Tabs component
 * Clean horizontal tab navigation
 */
export function Tabs({ tabs, activeTab, onChange }: TabsProps) {
  return (
    <div className="border-b border-[#27272a]">
      <div className="flex gap-1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className={cn(
              'flex items-center gap-2 px-4 h-12 font-medium transition-colors relative',
              activeTab === tab.id
                ? 'text-[#8b5cf6]'
                : 'text-[#a1a1aa] hover:text-white'
            )}
          >
            {tab.icon && <span className="flex-shrink-0">{tab.icon}</span>}
            {tab.label}
            {activeTab === tab.id && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#8b5cf6]" />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

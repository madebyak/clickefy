"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

export interface SwitchProps {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}

export function Switch({
  checked,
  defaultChecked,
  onCheckedChange,
  disabled,
  className,
  ...rest
}: SwitchProps) {
  const [internal, setInternal] = useState(defaultChecked ?? false);
  const isOn = checked ?? internal;

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isOn}
      disabled={disabled}
      onClick={() => {
        const next = !isOn;
        if (checked === undefined) setInternal(next);
        onCheckedChange?.(next);
      }}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
        isOn ? "bg-primary" : "bg-surface-3",
        className,
      )}
      {...rest}
    >
      {/* Thumb sits at the logical start; on = move toward the logical end (flips in RTL). */}
      <span
        className={cn(
          "pointer-events-none absolute start-0.5 size-5 rounded-full bg-white shadow-sm transition-transform",
          isOn ? "ltr:translate-x-5 rtl:-translate-x-5" : "translate-x-0",
        )}
      />
    </button>
  );
}

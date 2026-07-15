"use client";

import { useState } from "react";
import { Check } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

export interface CheckboxProps {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}

export function Checkbox({
  checked,
  defaultChecked,
  onCheckedChange,
  disabled,
  className,
  ...rest
}: CheckboxProps) {
  const [internal, setInternal] = useState(defaultChecked ?? false);
  const isOn = checked ?? internal;

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={isOn}
      disabled={disabled}
      onClick={() => {
        const next = !isOn;
        if (checked === undefined) setInternal(next);
        onCheckedChange?.(next);
      }}
      className={cn(
        "grid size-5 shrink-0 place-items-center rounded-md border transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
        isOn ? "border-primary bg-primary text-black" : "border-border bg-surface-1",
        className,
      )}
      {...rest}
    >
      <Check weight="bold" className={cn("size-3.5 transition-opacity", isOn ? "opacity-100" : "opacity-0")} />
    </button>
  );
}

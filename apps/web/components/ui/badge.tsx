import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium",
  {
    variants: {
      variant: {
        default: "border border-border bg-surface-2 text-foreground",
        yellow: "bg-brand-yellow text-black",
        purple: "bg-brand-purple text-white",
        turquoise: "bg-accent-turquoise text-black",
        pink: "bg-accent-pink text-white",
        outline: "border border-border text-muted-foreground",
        success: "border border-status-green/30 bg-status-green/15 text-status-green",
        danger: "border border-status-red/30 bg-status-red/15 text-status-red",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export function Badge({
  className,
  variant,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { badgeVariants };

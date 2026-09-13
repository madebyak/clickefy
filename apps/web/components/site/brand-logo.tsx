import Image from "next/image";

/** The wordmark's own proportions — its viewBox is 808.07 × 178.65. */
const RATIO = 808.07 / 178.65;

/**
 * The Clickefy wordmark. One component, so the next brand change is one
 * edit — it used to be a hard-coded <img> in five files.
 *
 * `next/image` serves a `.svg` source unoptimized on its own, which is the
 * docs' recommended handling for vector files, and the explicit width and
 * height reserve its box before the file arrives, so a header never shifts.
 *
 * `surface` names what the logo sits ON: dark surfaces get the light
 * wordmark. The green mark is the same in both.
 */
export function BrandLogo({
  height = 28,
  surface = "dark",
  eager = false,
  className,
}: {
  /** Rendered height in px; the width follows the wordmark's proportions. */
  height?: number;
  surface?: "dark" | "light";
  /** Headers and other above-the-fold placements load immediately. */
  eager?: boolean;
  className?: string;
}) {
  return (
    <Image
      src={surface === "dark" ? "/brand/logo-white.svg" : "/brand/logo-black.svg"}
      alt="Clickefy"
      width={Math.round(height * RATIO)}
      height={height}
      loading={eager ? "eager" : "lazy"}
      className={className}
    />
  );
}

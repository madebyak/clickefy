import { useTranslations } from "next-intl";

/**
 * The models strip under the hero: one headline and the brand marks of
 * the model families we run.
 *
 * Deliberately NOT interactive. It previously rendered selectable model
 * cards with a checkmark and a "View all models" link — which implied a
 * choice that did nothing (the link pointed at `#`) and read as a broken
 * control on a marketing page. Choosing a model is a studio action; here
 * the job is only to say which models we have.
 *
 * A Server Component: nothing here hydrates, so the section ships zero
 * JavaScript.
 *
 * Every entry is a full wordmark (symbol AND brand text) in one SVG, so
 * no text label is rendered beside them — the asset already says the
 * name. They are a separate asset set from the square marks in
 * `lib/model-logos.ts`, which the studio's model picker renders inside a
 * 16px badge where a wordmark would be illegible.
 */

/**
 * `height` is tuned per logo rather than shared, because these wordmarks
 * range from 2.7:1 (Gemini) to 5.8:1 (ByteDance). At one uniform height
 * the wider marks swamp the row; sizing each to equal optical weight is
 * what keeps the strip balanced.
 *
 * Gemini / OpenAI / Kling ship as pure white, which is what makes the row
 * read as one set — and the site is dark-only, so no light-theme variant
 * is needed.
 *
 * ByteDance needed a middle path. Its supplied asset draws BOTH the four
 * symbol bars and the lettering in brand colour, and its lettering colour
 * (`#3259b4`) against the `#131317` card is only ~2.9:1 — under the 4.5:1
 * readable threshold. Flattening the whole mark to white fixed that but
 * turned four distinct brand-coloured bars into anonymous white slivers,
 * which read as a rendering fault at this size. So only the LETTERING is
 * whitened; the symbol keeps its brand colours. The untouched original is
 * kept as `bytedance-wordmark-color.svg` for any light surface.
 */
const MODELS: Array<{ name: string; wordmark: string; height: string }> = [
  { name: "Google Gemini", wordmark: "/models/gemini-wordmark.svg", height: "h-7" },
  { name: "OpenAI", wordmark: "/models/openai-wordmark.svg", height: "h-6" },
  { name: "Kling AI", wordmark: "/models/kling-wordmark.svg", height: "h-6" },
  { name: "ByteDance", wordmark: "/models/bytedance-wordmark.svg", height: "h-5" },
];

export function ModelRow() {
  const t = useTranslations("home");

  return (
    <section className="mx-auto w-full max-w-site site-px">
      <div className="mt-4 rounded-2xl bg-surface-2 px-6 py-10 sm:py-14">
        <h2 className="text-center text-2xl font-semibold tracking-tight sm:text-3xl">
          {t("modelsHeadline")}
        </h2>

        <ul className="mx-auto mt-9 flex max-w-4xl flex-wrap items-center justify-center gap-x-12 gap-y-8 sm:gap-x-16">
          {MODELS.map((m) => (
            <li key={m.name} className="flex items-center">
              {/* The wordmark IS the content here — so it carries the
                  brand name as alt text rather than being hidden. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={m.wordmark}
                alt={m.name}
                className={`${m.height} w-auto object-contain opacity-80`}
              />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

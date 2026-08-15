"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Check, ArrowRight } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { modelLogo } from "@/lib/model-logos";

/** `provider`/`modelKey` feed the shared logo map (see lib/model-logos). */
type Model = {
  id: string;
  name: string;
  company: string;
  tagKey: string;
  provider: string;
  modelKey?: string;
};

const MODELS: Model[] = [
  { id: "gpt-image", name: "GPT Image", company: "OpenAI", tagKey: "tagBestText", provider: "openai", modelKey: "gpt-image" },
  { id: "nano-banana-pro", name: "Nano Banana Pro", company: "Google", tagKey: "tagQuality", provider: "gemini" },
  { id: "nano-banana-2", name: "Nano Banana 2", company: "Google", tagKey: "tagFast", provider: "gemini" },
  { id: "seedream", name: "Seedream 5", company: "ByteDance", tagKey: "tag4k", provider: "seedance", modelKey: "seedream" },
  { id: "imagen", name: "Imagen 4", company: "Google", tagKey: "tagDetail", provider: "gemini" },
];

function ModelLogo({ model }: { model: Model }) {
  const logo = modelLogo({ provider: model.provider, modelKey: model.modelKey });
  const [ok, setOk] = useState(true);
  return (
    <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-lg bg-surface-3 text-sm font-bold text-foreground">
      {logo && ok ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logo}
          alt=""
          aria-hidden
          className="size-5 object-contain"
          onError={() => setOk(false)}
        />
      ) : (
        model.name[0]
      )}
    </span>
  );
}

function ModelCard({
  model,
  selected,
  onSelect,
}: {
  model: Model;
  selected: boolean;
  onSelect: () => void;
}) {
  const t = useTranslations("models");
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "relative rounded-xl p-4 text-start outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-2",
        selected ? "bg-surface-3" : "bg-surface-1 hover:bg-surface-3/60",
      )}
    >
      {selected && <Check weight="bold" className="absolute end-3 top-3 size-4 text-brand-purple" />}
      <div className="flex items-center gap-3">
        <ModelLogo model={model} />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{model.name}</p>
          <p className="truncate text-xs text-muted-foreground">{model.company}</p>
        </div>
      </div>
      <p className="mt-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {t(model.tagKey)}
      </p>
    </button>
  );
}

export function ModelRow() {
  const t = useTranslations("home");
  const [selected, setSelected] = useState(0);
  return (
    <section className="mx-auto max-w-[90rem] px-4 sm:px-6">
      <div className="mt-4 rounded-2xl bg-surface-2 p-5 sm:p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="size-2 rounded-[3px] bg-brand-purple" />
            <h3 className="text-sm font-medium">{t("chooseModel")}</h3>
          </div>
          <Link
            href="#"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            {t("viewAllModels")} <ArrowRight className="size-4 rtl:-scale-x-100" />
          </Link>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {MODELS.map((m, i) => (
            <ModelCard key={m.id} model={m} selected={i === selected} onSelect={() => setSelected(i)} />
          ))}
        </div>
      </div>
    </section>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

type Model = { id: string; name: string; company: string; tag: string };

const MODELS: Model[] = [
  { id: "gpt-image", name: "GPT Image", company: "OpenAI", tag: "Best text" },
  { id: "nano-banana-pro", name: "Nano Banana Pro", company: "Google", tag: "Quality" },
  { id: "nano-banana-2", name: "Nano Banana 2", company: "Google", tag: "Fast" },
  { id: "seedream", name: "Seedream 5", company: "ByteDance", tag: "4K" },
  { id: "imagen", name: "Imagen 4", company: "Google", tag: "Detail" },
];

/** Model logo from /media/models/<id>.svg, falling back to a monogram tile. */
function ModelLogo({ model }: { model: Model }) {
  const [ok, setOk] = useState(true);
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => {
    if (ref.current?.complete && ref.current.naturalWidth === 0) setOk(false);
  }, []);
  return (
    <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-lg bg-surface-3 text-sm font-bold text-foreground">
      {ok ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          ref={ref}
          src={`/models/${model.id}.svg`}
          alt=""
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
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "relative rounded-xl p-4 text-start outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-2",
        selected ? "bg-surface-3" : "bg-surface-1 hover:bg-surface-3/60",
      )}
    >
      {selected && (
        <Check weight="bold" className="absolute end-3 top-3 size-4 text-brand-purple" />
      )}
      <div className="flex items-center gap-3">
        <ModelLogo model={model} />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{model.name}</p>
          <p className="truncate text-xs text-muted-foreground">{model.company}</p>
        </div>
      </div>
      <p className="mt-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {model.tag}
      </p>
    </button>
  );
}

export function ModelRow() {
  const [selected, setSelected] = useState(0);
  return (
    <section className="mx-auto max-w-[90rem] px-4 sm:px-6">
      <div className="mt-4 rounded-2xl bg-surface-2 p-5 sm:p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="size-2 rounded-[3px] bg-brand-purple" />
            <h3 className="text-sm font-medium">Choose your model</h3>
          </div>
          <Link
            href="#"
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            View all models →
          </Link>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {MODELS.map((m, i) => (
            <ModelCard
              key={m.id}
              model={m}
              selected={i === selected}
              onSelect={() => setSelected(i)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

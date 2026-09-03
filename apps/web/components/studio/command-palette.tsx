"use client";

/**
 * ⌘K command palette — one search box over everything the studio can
 * do or hold: the TOOLS first (Create Image/Video, Camera Angle,
 * Storyboard, Templates, …), then the user's projects by name, then
 * past generations by their prompt.
 *
 * Generations come from `GET /v1/jobs` (the same call the studio's
 * reload-rehydration uses) because the per-project asset rows carry no
 * prompt text — the jobs list is the only client-reachable index of
 * "what did I type". Fetched lazily on first open and kept for a
 * minute, so reopening the palette is instant.
 *
 * The anatomy mirrors ToolModal (backdrop, surface-1 panel, border
 * scale) so it reads as part of the app.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "@/i18n/navigation";
import {
  MagnifyingGlass,
  ImageSquare,
  FilmSlate,
  VideoCamera,
  SquaresFour,
  FolderSimple,
  Heart,
  GearSix,
  Sparkle,
} from "@phosphor-icons/react";

import { cn } from "@/lib/utils";
import { getSDK } from "@/lib/api";
import { useStudio } from "@/components/studio/studio-context";
import { useToolsMaybe } from "@/components/tools/tools-context";

type Row = {
  id: string;
  section: "tools" | "projects" | "generations";
  label: string;
  sub?: string;
  icon?: ReactNode;
  thumb?: string;
  /** Extra text the filter matches beyond the label (synonyms, model). */
  keywords?: string;
  run: () => void;
};

/** Every query token must appear somewhere in the row's text. */
function matches(row: Row, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  const hay = `${row.label} ${row.sub ?? ""} ${row.keywords ?? ""}`.toLowerCase();
  return tokens.every((tok) => hay.includes(tok));
}

const SECTION_ORDER = ["tools", "projects", "generations"] as const;

/** How many rows a section shows before a query narrows things down. */
const IDLE_LIMIT: Record<Row["section"], number> = {
  tools: 8,
  projects: 5,
  generations: 5,
};

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const t = useTranslations("search");
  const tNav = useTranslations("nav");
  const router = useRouter();
  const studio = useStudio();
  const tools = useToolsMaybe();

  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  // Past generations, lazily: ready jobs filed into a studio project.
  const jobsQuery = useQuery({
    queryKey: ["palette-jobs"],
    queryFn: () => getSDK().library.listProjects({ limit: 50 }),
    staleTime: 60_000,
  });

  const go = useCallback(
    (fn: () => void) => {
      fn();
      onClose();
    },
    [onClose],
  );

  const rows = useMemo<Row[]>(() => {
    const iconChip = (node: ReactNode, tint: string) => (
      <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg", tint)}>
        {node}
      </span>
    );

    const toolRows: Row[] = [
      {
        id: "tool-create-image",
        section: "tools",
        label: tNav("createImage"),
        keywords: "create image generate photo picture",
        icon: iconChip(<ImageSquare weight="fill" className="size-4 text-primary" />, "bg-primary/15"),
        run: () => {
          studio.setActiveProject(null);
          router.push("/create");
        },
      },
      {
        id: "tool-create-video",
        section: "tools",
        label: tNav("createVideo"),
        keywords: "create video generate clip animate",
        icon: iconChip(<FilmSlate weight="fill" className="size-4 text-[#b98aff]" />, "bg-brand-purple/20"),
        run: () => {
          studio.setActiveProject(null);
          router.push("/create-video");
        },
      },
      {
        id: "tool-camera",
        section: "tools",
        label: tNav("cameraAngles"),
        keywords: "camera angle orbit reshoot rotate photo",
        icon: iconChip(<VideoCamera weight="fill" className="size-4 text-[#00dcae]" />, "bg-[#00dcae]/15"),
        run: () => tools?.openCameraAngle(),
      },
      {
        id: "tool-storyboard",
        section: "tools",
        label: tNav("storyboard"),
        keywords: "storyboard script shots grid scenes",
        icon: iconChip(<SquaresFour weight="fill" className="size-4 text-[#b98aff]" />, "bg-brand-purple/20"),
        run: () => tools?.openStoryboard(),
      },
      {
        id: "tool-templates",
        section: "tools",
        label: tNav("templates"),
        keywords: "templates library presets",
        icon: iconChip(<Sparkle weight="fill" className="size-4 text-[#f5c542]" />, "bg-[#f5c542]/15"),
        run: () => router.push("/templates"),
      },
      {
        id: "tool-favorites",
        section: "tools",
        label: t("favorites"),
        keywords: "favorites hearted liked saved",
        icon: iconChip(<Heart weight="fill" className="size-4 text-[#ef0744]" />, "bg-[#ef0744]/15"),
        run: () => router.push("/favorites"),
      },
      {
        id: "tool-projects",
        section: "tools",
        label: t("allProjects"),
        keywords: "projects folders browse",
        icon: iconChip(<FolderSimple weight="fill" className="size-4 text-muted-foreground" />, "bg-surface-3"),
        run: () => router.push("/projects"),
      },
      {
        id: "tool-settings",
        section: "tools",
        label: t("settings"),
        keywords: "settings account billing profile",
        icon: iconChip(<GearSix weight="fill" className="size-4 text-muted-foreground" />, "bg-surface-3"),
        run: () => router.push("/settings"),
      },
    ];

    const projectRows: Row[] = studio.projects.map((p) => {
      const thumb =
        (p.cover?.kind === "video" ? p.cover.posterUrl : p.cover?.url) ?? undefined;
      return {
        id: `project-${p.id}`,
        section: "projects" as const,
        label: p.name,
        thumb,
        icon: thumb
          ? undefined
          : iconChip(
              <FolderSimple weight="fill" className="size-4 text-muted-foreground" />,
              "bg-surface-3",
            ),
        run: () => {
          studio.setActiveProject(p.id);
          router.push("/create");
        },
      };
    });

    const generationRows: Row[] = (jobsQuery.data?.items ?? [])
      .filter((j) => j.status === "ready" && j.projectId && j.title)
      .map((j) => {
        // JobOutput carries no poster, so a video generation falls back
        // to its template cover (or the folder icon) rather than an
        // <img> pointed at a video URL.
        const out = j.outputs[0];
        const thumb =
          (out?.kind === "image" ? out.url : undefined) ??
          (j.templateCoverImage || undefined);
        return {
          id: `job-${j.id}`,
          section: "generations" as const,
          label: j.title,
          sub: j.whenLabel,
          thumb,
          icon: thumb
            ? undefined
            : iconChip(<ImageSquare className="size-4 text-muted-foreground" />, "bg-surface-3"),
          run: () => {
            studio.setActiveProject(j.projectId);
            router.push("/create");
          },
        };
      });

    return [...toolRows, ...projectRows, ...generationRows];
  }, [t, tNav, router, studio, tools, jobsQuery.data]);

  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const filtered = useMemo(() => {
    const hit = rows.filter((r) => matches(r, tokens));
    if (tokens.length > 0) return hit;
    // Idle view: a taste of each section, tools in full.
    return SECTION_ORDER.flatMap((s) =>
      hit.filter((r) => r.section === s).slice(0, IDLE_LIMIT[s]),
    );
  }, [rows, tokens]);

  // Clamp the cursor whenever the result set shrinks under it.
  const cursor = Math.min(active, Math.max(filtered.length - 1, 0));

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive(Math.min(cursor + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(Math.max(cursor - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const row = filtered[cursor];
      if (row) go(row.run);
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  // Keep the active row in view while arrowing through a long list.
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${cursor}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  let lastSection: Row["section"] | null = null;

  return (
    <div className="fixed inset-0 z-50 flex justify-center p-4 pt-[12vh]">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-label={t("title")}
        className="relative flex h-fit max-h-[70vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-surface-1 shadow-2xl shadow-black/50"
      >
        <div className="flex shrink-0 items-center gap-2.5 border-b border-border px-4">
          <MagnifyingGlass className="size-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            placeholder={t("placeholder")}
            className="h-12 w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
          <kbd className="shrink-0 rounded-md bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            esc
          </kbd>
        </div>

        <div ref={listRef} className="nice-scroll overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">
              {t("noResults")}
            </p>
          ) : (
            filtered.map((row, i) => {
              const heading = row.section !== lastSection && (
                <p
                  key={`h-${row.section}`}
                  className="px-3 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground first:pt-1"
                >
                  {t(row.section)}
                </p>
              );
              lastSection = row.section;
              return (
                <div key={row.id}>
                  {heading}
                  <button
                    type="button"
                    data-index={i}
                    onClick={() => go(row.run)}
                    onMouseMove={() => setActive(i)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-xl px-3 py-2 text-start text-sm transition-colors",
                      i === cursor ? "bg-surface-2 text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {row.thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={row.thumb}
                        alt=""
                        className="size-8 shrink-0 rounded-lg object-cover"
                      />
                    ) : (
                      row.icon
                    )}
                    <span className="min-w-0 flex-1 truncate">{row.label}</span>
                    {row.sub && (
                      <span className="shrink-0 text-xs text-muted-foreground/70">
                        {row.sub}
                      </span>
                    )}
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

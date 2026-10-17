/**
 * Which studio route shows the composer a piece of work belongs to. The
 * three routes are entry points that preset the composer's mode; a
 * project opens on the mode of its latest asset so an audio project lands
 * on the Audio surface, not the image one.
 */
export type ComposerKind = "image" | "video" | "audio";

export const COMPOSER_ROUTES: Record<ComposerKind, string> = {
  image: "/create",
  video: "/create-video",
  audio: "/audio",
};

export function composerRouteFor(kind: ComposerKind | string | null | undefined): string {
  return kind === "video" ? COMPOSER_ROUTES.video : kind === "audio" ? COMPOSER_ROUTES.audio : COMPOSER_ROUTES.image;
}

/** True when `pathname` is one of the composer routes (so "new project" can stay put). */
export function isComposerRoute(pathname: string): boolean {
  return Object.values(COMPOSER_ROUTES).includes(pathname);
}

import type { StudioFolder } from "@clickfy/sdk";

/**
 * Folders in tree order: every folder immediately followed by its
 * children, depth-first.
 *
 * The API returns folders newest-first — a flat list with no regard for
 * parentage, which is the right shape for a tree that builds its own
 * hierarchy, and the wrong one for any list that renders them in a row.
 * The "move to folder" menu is exactly that: indenting by `depth` over
 * the raw order would draw children above their parents.
 *
 * Orphans — a folder whose parent is missing from the list, which the
 * paginated projects endpoint can produce — are appended at the end
 * rather than dropped. A folder you cannot see is a folder you cannot
 * move a project out of.
 */
export function foldersInTreeOrder(folders: StudioFolder[]): StudioFolder[] {
  const childrenOf = new Map<string | null, StudioFolder[]>();
  for (const f of folders) {
    const key = f.parentId ?? null;
    const list = childrenOf.get(key);
    if (list) list.push(f);
    else childrenOf.set(key, [f]);
  }

  const out: StudioFolder[] = [];
  const seen = new Set<string>();
  const walk = (parentId: string | null) => {
    for (const f of childrenOf.get(parentId) ?? []) {
      if (seen.has(f.id)) continue; // defensive; the schema forbids cycles
      seen.add(f.id);
      out.push(f);
      walk(f.id);
    }
  };
  walk(null);

  for (const f of folders) if (!seen.has(f.id)) out.push(f);
  return out;
}

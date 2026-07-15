import { createNavigation } from "next-intl/navigation";
import { routing } from "./routing";

// Locale-aware replacements for next/link + next/navigation.
// Use these everywhere for internal navigation so the active locale is preserved.
export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);

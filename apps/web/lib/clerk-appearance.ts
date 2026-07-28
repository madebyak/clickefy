/**
 * Clerk appearance — maps the Clickefy design tokens (globals.css) onto
 * Clerk's prebuilt components so <SignIn/>/<SignUp/> read as native to
 * the studio. Clerk's theming engine prefers literal color values over
 * CSS variables, so the token hexes are repeated here; keep in sync
 * with `app/globals.css`.
 */

import { dark } from "@clerk/themes";
import type { ClerkProvider } from "@clerk/nextjs";

type Appearance = React.ComponentProps<typeof ClerkProvider>["appearance"];

export const clerkAppearance: Appearance = {
  // Start from Clerk's official dark theme so every internal element
  // (menus, modals, account screens) gets legible dark defaults, then
  // overlay the Clickefy tokens.
  baseTheme: dark,
  variables: {
    colorPrimary: "#ebf81a",
    colorPrimaryForeground: "#000000",
    colorBackground: "#0a0a0c", // surface-1 — card body
    colorForeground: "#fafafa",
    colorMuted: "#131317", // surface-2
    colorMutedForeground: "#9b9ba4",
    colorInput: "#131317",
    colorInputForeground: "#fafafa",
    colorBorder: "#26262d",
    colorRing: "#ebf81a",
    colorDanger: "#ef0744",
    colorSuccess: "#07dd44",
    colorModalBackdrop: "rgba(0, 0, 0, 0.7)",
    fontFamily: "var(--app-font-sans)",
    borderRadius: "0.75rem",
  },
  elements: {
    cardBox: "shadow-none border border-border",
    card: "bg-surface-1",
    headerTitle: "text-foreground",
    headerSubtitle: "text-muted-foreground",
    socialButtonsBlockButton:
      "bg-surface-2 border border-border text-foreground hover:bg-surface-3",
    socialButtonsBlockButtonText: "text-foreground",
    dividerLine: "bg-border",
    dividerText: "text-muted-foreground",
    formFieldLabel: "text-foreground",
    formFieldInput: "bg-surface-2 border-border text-foreground",
    formButtonPrimary:
      "bg-primary text-primary-foreground hover:bg-primary/90 shadow-none",
    footer: "bg-none bg-surface-1 border-t border-border",
    footerActionText: "text-muted-foreground",
    footerActionLink: "text-primary hover:text-primary/80",
    identityPreview: "bg-surface-2 border-border",
    otpCodeFieldInput: "bg-surface-2 border-border text-foreground",
  },
};

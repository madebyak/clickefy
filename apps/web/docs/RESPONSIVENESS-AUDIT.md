# Web responsiveness inspection

Date: 14 September 2026  
Scope: `apps/web` only. Inspection and baseline checks; no application fixes.

## Main assessment

The highest-impact problems sit in shared studio components: navigation, the header, the composer dock, menus, and asset controls. Fixing these centrally should improve several routes together. The sampled public pages generally contain their content at phone widths; that does not establish that every loaded state or interaction is correct.

Eight findings below distinguish browser reproductions from source findings. Additional cases that need real devices or populated data are listed separately.

## Current code structure

The route inventory contains **25 page definitions**, including authentication catch-alls, the unknown-route handler, and the internal design-system page. Locale routing serves English without a prefix and Arabic under `/ar`.

- **Document and application providers:** `app/layout.tsx` passes through to `app/[locale]/layout.tsx`, which owns document language/direction, fonts, Clerk, next-intl, React Query, and notifications.
- **Public site:** homepage, templates, pricing, models, about, blog/index and article, contact, and legal/account-deletion pages. These typically mount `Navbar` and `Footer` in the individual page or shared legal renderer.
- **Authentication:** sign-in and sign-up share `AuthShell`; the large brand panel hides below `lg`.
- **Studio:** `(studio)/layout.tsx` performs the server auth check and profile prefetch, then renders `StudioShell`. The shell owns `StudioProvider`, `ToolsProvider`, `StudioTopbar`, and `StudioSidebar`.
- **Creation:** `/create` and `/create-video` are small wrappers around the same `Workspace` and `PromptBar`.
- **Project/library surfaces:** projects, favorites, template execution, settings, masonry/lightbox, asset details, and My Assets.
- **Tools:** Storyboard and Camera Angle are dialogs, not independent routes. Public links open them through `/create?tool=...`.
- **Data:** `lib/use-*.ts` hooks and the SDK bridge own queries; `StudioProvider` coordinates project, generation, selection, and attachment state.
- **Styling:** Tailwind v4 and tokens in `globals.css`; logical direction utilities are used extensively. Shell breakpoints and many panel rules still depend on viewport width. The masonry grid already measures its actual container with ResizeObserver.

The installed framework is Next.js 16.2.2. Its bundled layout and viewport guides were read during this inspection. The viewport meta tag is supplied by Next; this is not a missing-viewport-meta problem.

## Findings

### 1. P1 — Studio navigation loses destinations on phones and tablets

**Evidence: browser and source.** Below 1024px, the center navigation is hidden. Opening the mobile sidebar exposes projects, folders, favorites, My Assets, and profile/settings, but not Storyboard, Camera Angle, or Templates. Search disappears below 768px without a replacement in the drawer.

The composer still has an image/video mode switch, so those modes are not completely unavailable. However, the studio loses navigation parity and users must return to the public site or know a deep link to find several tools.

Sources: [studio-topbar.tsx](/Users/ahmedkamal/dev/clickfy/my-next-app/apps/web/components/studio/studio-topbar.tsx:62), [search breakpoint](/Users/ahmedkamal/dev/clickfy/my-next-app/apps/web/components/studio/studio-topbar.tsx:101), [studio-sidebar.tsx](/Users/ahmedkamal/dev/clickfy/my-next-app/apps/web/components/studio/studio-sidebar.tsx:76).

**Direction:** Define the destinations once and render an appropriate desktop navigation and mobile menu, including a touch-accessible search entry.

### 2. P1 — The studio header overlaps at common widths

**Evidence: browser and source.** The centered navigation is absolutely positioned and does not reserve space for the controls on the other side.

Measured English header bounds:
- At **1024px**, navigation occupies approximately x=256–768; the account/search controls begin at x=623. Their areas overlap by about **145px**, and some navigation labels wrap into two lines.
- At **1280px**, navigation occupies approximately x=371–909; controls begin at x=879, leaving about **30px of overlap**.
- At **1440px**, the measured English header groups separate.
- At **320px**, the logo/menu group compresses while its logo remains fixed-size, visibly colliding with the language control.

The 1024px collision also reproduces in Arabic.

Sources: [header layout](/Users/ahmedkamal/dev/clickfy/my-next-app/apps/web/components/studio/studio-topbar.tsx:43), [absolute center navigation](/Users/ahmedkamal/dev/clickfy/my-next-app/apps/web/components/studio/studio-topbar.tsx:62), [search/account controls](/Users/ahmedkamal/dev/clickfy/my-next-app/apps/web/components/studio/studio-topbar.tsx:97).

**Direction:** Let header sections participate in layout. Collapse navigation/search based on the space they actually need, and provide a compact logo/account treatment for narrow phones.

### 3. P1 — The composer grows over content without matching scroll clearance

**Evidence: browser and source.** Workspace content reserves `pb-44`, or **176px**, while the composer and selection bar sit in an absolutely positioned bottom dock.

At **390 × 844**, a long prompt expanded the dock to **454px** including its gradient/padding. The textarea alone reached 160px. The content still reserved only 176px, and the empty-state guidance was covered. At **320 × 568**, even the smaller empty composer covered part of the guidance.

Attachments, extra model options, multi-shot controls, and selection add further variable height. Their fully populated behavior was not reproduced in this session, but they share the same fixed-clearance design.

Sources: [fixed content clearance](/Users/ahmedkamal/dev/clickfy/my-next-app/apps/web/components/studio/workspace.tsx:374), [absolute dock](/Users/ahmedkamal/dev/clickfy/my-next-app/apps/web/components/studio/workspace.tsx:410), [wrapping attachments](/Users/ahmedkamal/dev/clickfy/my-next-app/apps/web/components/generate/prompt-bar.tsx:1375), [growing prompt field](/Users/ahmedkamal/dev/clickfy/my-next-app/apps/web/components/generate/prompt-bar.tsx:1626).

**Direction:** Put the composer in a layout track below the scroll area, or measure the dock and reserve its real height. Give expanded mobile controls a deliberate height/scroll strategy.

### 4. P1 — Asset actions rely on hover

**Evidence: source; populated touch behavior still needs testing.** The masonry selection checkbox, options, download, favorite, and reference/reuse controls begin at zero opacity and reveal on hover. Some have focus fallbacks, but no explicit touch-visible treatment. Tapping the main image opens the lightbox.

This makes important actions undiscoverable at rest on touch devices, and transparent controls can occupy tappable areas. The lightbox provides some alternatives, so this is not a claim that every asset action is impossible.

My Assets repeats the pattern for folder and file options. The project/sidebar rows already use `max-lg:opacity-100`, showing that touch visibility has been addressed in one area but not consistently elsewhere.

Sources: [selection checkbox](/Users/ahmedkamal/dev/clickfy/my-next-app/apps/web/components/studio/masonry.tsx:318), [asset options](/Users/ahmedkamal/dev/clickfy/my-next-app/apps/web/components/studio/masonry.tsx:371), [reference/reuse actions](/Users/ahmedkamal/dev/clickfy/my-next-app/apps/web/components/studio/masonry.tsx:511), [library folder options](/Users/ahmedkamal/dev/clickfy/my-next-app/apps/web/components/media/my-assets-modal.tsx:749), [library file options](/Users/ahmedkamal/dev/clickfy/my-next-app/apps/web/components/media/my-assets-modal.tsx:900).

**Direction:** Keep an obvious options/select affordance visible on touch interfaces. Use pointer capability as well as screen width, since large tablets can also lack hover.

### 5. P2 — Shared menus can leave the viewport

**Evidence: browser and source.** On the English studio at **320px**, the language menu measured **192px wide at x=-8**, clipping its left edge.

The menu helper checks vertical clipping, but horizontal collision handling runs only for portalled panels. Most menus default to `portal=false`; the language menu is one of them. The base `min-w-48` also makes its requested `w-40` wider than intended. Portalled panels have position clamping but no general maximum-width cap.

Sources: [horizontal handling is portal-only](/Users/ahmedkamal/dev/clickfy/my-next-app/apps/web/components/ui/menu.tsx:100), [base panel width](/Users/ahmedkamal/dev/clickfy/my-next-app/apps/web/components/ui/menu.tsx:203), [default portal setting](/Users/ahmedkamal/dev/clickfy/my-next-app/apps/web/components/ui/menu.tsx:234), [language menu width](/Users/ahmedkamal/dev/clickfy/my-next-app/apps/web/components/site/language-switcher.tsx:24).

**Direction:** Apply consistent horizontal collision handling and viewport-bounded width to shared menus, preserving RTL alignment.

### 6. P2 — Storyboard controls retain desktop column counts

**Evidence: browser and source.** The dialog always renders **five style columns** and **four shot-layout columns**.

At **320 × 568**, style buttons measured roughly **39px wide**. “Black and white” wrapped across three lines, and “Realistic” exceeded its button width. The four-column shot row measured approximately 51px per button; the 12-shot diagram had 57px of internal width. The dialog scrolls, so this is cramped content and overflow inside controls rather than proof that the entire dialog is unreachable.

Sources: [five style columns](/Users/ahmedkamal/dev/clickfy/my-next-app/apps/web/components/tools/storyboard-modal.tsx:143), [four shot columns](/Users/ahmedkamal/dev/clickfy/my-next-app/apps/web/components/tools/storyboard-modal.tsx:172), [fixed diagram geometry](/Users/ahmedkamal/dev/clickfy/my-next-app/apps/web/components/tools/storyboard-modal.tsx:189).

**Direction:** Use fewer columns on phones, with larger previews and readable labels. Adapt diagram geometry to the available button width.

### 7. P2 — My Assets hides density control without adapting density

**Evidence: source.** The library defaults to three columns and applies the chosen column count directly through inline grid styles. The density slider disappears below 640px, but the selected count is not constrained by the mobile width.

At 320px, the default three-column calculation leaves tiles roughly 75px wide after dialog padding/gaps. A six-column choice retained while resizing would produce roughly 32px tiles, while the user no longer has the density slider available. These are layout calculations from the source, not measurements of populated library tiles.

The empty library dialog itself was inspected at 390px and remained inside the viewport.

Sources: [density defaults](/Users/ahmedkamal/dev/clickfy/my-next-app/apps/web/components/media/my-assets-modal.tsx:55), [hidden mobile slider](/Users/ahmedkamal/dev/clickfy/my-next-app/apps/web/components/media/my-assets-modal.tsx:273), [unconditional column count](/Users/ahmedkamal/dev/clickfy/my-next-app/apps/web/components/media/my-assets-modal.tsx:403).

**Direction:** Cap effective columns by container width/minimum tile size. Keep the user's desktop preference separate from the number of columns that can fit on a phone.

### 8. P2 — Modal and drawer interaction behavior is inconsistent

**Evidence: browser and source.** Opening Storyboard leaves keyboard focus on the background Storyboard button. Pressing Tab then focuses the background Camera Angles button, not the dialog. The shared tool dialog has no focus trap or `aria-modal`.

The mobile sidebar is hidden using translation only. Its buttons remain in the accessibility tree and tab order when closed; the sampled empty sidebar contained six focusable controls. It also lacks an explicit close button and modal focus handling.

My Assets and Draw already use native modal dialogs, so the app has a stronger pattern available.

Sources: [tool dialog shell](/Users/ahmedkamal/dev/clickfy/my-next-app/apps/web/components/tools/tool-modal.tsx:31), [offscreen sidebar](/Users/ahmedkamal/dev/clickfy/my-next-app/apps/web/components/studio/studio-sidebar.tsx:67), [native library dialog](/Users/ahmedkamal/dev/clickfy/my-next-app/apps/web/components/media/my-assets-modal.tsx:160).

**Direction:** Standardize modal behavior, move focus into opened dialogs, return it on close, and make closed drawers inert. Include an explicit accessible close control.

## Additional checks needed before fixing individual pages

- **Bulk selection:** `SelectionBar` is one non-wrapping row containing count, copy, move, favorite, download, and delete. Source indicates crowding risk at narrow widths; reproduce with selected assets before deciding the exact layout. [selection-bar.tsx](/Users/ahmedkamal/dev/clickfy/my-next-app/apps/web/components/studio/selection-bar.tsx:114)
- **Populated workspace toolbar:** the title, filter group, and action buttons share one row. Re-test with mixed image/video assets, favorites, and a long project name. [workspace.tsx](/Users/ahmedkamal/dev/clickfy/my-next-app/apps/web/components/studio/workspace.tsx:326)
- **Phone keyboards and safe areas:** the studio uses `h-dvh`, but no safe-area inset or VisualViewport handling was found in the web UI. Prompt/search inputs generally use 14px text. Test focus, browser chrome changes, keyboard opening, zoom, and the home indicator on actual iOS/Android devices before prescribing a fix. Desktop viewport resizing does not simulate these.
- **Camera tool:** its empty upload area and footer fit the sampled phone viewport, although the upload hint wrapped into a narrow stack. Test an uploaded image, orbit dragging, and landscape height; the stage uses a fixed 400px height and fixed-size orbit geometry.
- **Templates:** search and filters wrap, the grid has responsive column counts, and the detail gallery supports horizontal snapping. Card previews are mouse-hover-driven, which needs a separate touch preview decision.
- **Settings and authentication:** shell/loading states were visible, but a fully populated profile and completed Clerk form were not verified.
- **Performance on phones:** several homepage and asset videos autoplay without a visibility-based pause policy. The hero slideshow already respects reduced motion and mounts images progressively. Measure actual network/decode cost on a mobile device before treating this as a quantified performance defect.

## What currently works

- The sampled public homepage, template layout, models, about, blog index, contact, and privacy page did not show page-level horizontal overflow at 390px.
- Arabic homepage/template/pricing layouts also contained the page width at 320px in the sampled states.
- Pricing deliberately keeps its wide comparison table inside an internal horizontal scroller. Its offscreen table cells are not page overflow.
- Public navigation includes a mobile menu with the main destinations.
- Logical CSS direction, Arabic font setup, responsive outer gutters, responsive template grids, and container-measured masonry are useful existing foundations.
- The sampled 1440px studio header has adequate separation.

## Structural issues that will affect maintenance

1. **Two navigation definitions:** public and studio navigation are maintained separately, contributing to feature parity gaps.
2. **Several overlay implementations:** native dialogs, custom fixed dialogs, drawers, and both portalled/non-portalled menus implement different behavior.
3. **Large central components:** `PromptBar` is approximately 2,019 lines; `StudioProvider` approximately 1,276. These mix many modes and state branches. Responsive work should separate presentation sections carefully while preserving generation behavior.
4. **Documentation drift:** architecture notes still describe planned routing/auth/integration, while these are implemented. Some grid comments still describe a fixed two-column masonry layout even though masonry now measures its container.
5. **No responsive regression suite located:** no web-specific test/spec, Playwright, or Storybook files were found. The current scripts cover build, lint, and type checking, not visual behavior.

## Verification scope and limitations

Browser testing used the local app at `http://localhost:3001`, with viewport samples at **320, 390, 768, 1024, 1280, and 1440px**. These were targeted samples, not a complete route-by-width matrix. Inspections included screenshots, rendered element bounds, menus, both tool dialogs, the empty media library, a long prompt, and keyboard focus behavior.

Visited page families included home, templates, pricing, models, about, blog index, contact, privacy, studio creation/projects/favorites/settings, and sign-in. Arabic sampling covered home/templates/pricing and studio pages. Locale cookies can redirect unprefixed URLs; the resolved URL was checked rather than assuming the requested locale.

Account/model data remained placeholders and catalog/library/project content did not provide representative populated records in this browser session. Therefore template execution, populated grids, bulk selection, real account forms, and generated media workflows have source-level coverage rather than full end-to-end validation. No account changes, uploads, paid generations, or checkout submissions were made.

**Baseline checks passed:**
- Web TypeScript check: `tsc --noEmit --incremental false`.
- Web lint: `eslint .`.

The installed local executables were used directly because the package-manager launcher tried to initialize a cache outside the writable workspace. No dependencies were changed. A production build and real-device testing were not performed.

## Suggested implementation order

1. Restore mobile studio navigation and fix the shared header across phone, tablet, and laptop widths.
2. Rework composer/content sizing, then validate long prompts, attachments, selection, short screens, and keyboards.
3. Make menus/dialogs viewport-safe and standardize focus/drawer behavior.
4. Add touch-visible asset actions and adapt storyboard/library grids.
5. Validate populated templates, projects, favorites, settings, and billing views in English and Arabic.
6. Add a small responsive regression suite for these shared components, then update architecture/design documentation.

Only this report was added during the original inspection. The implementation work below followed the user’s authorization to start fixing the findings.


## First implementation pass — 2026-09-14

Scope: `apps/web` presentation and shared UI behavior. No dependencies, API contracts, generation payloads, payment logic, or native mobile app files were changed in this pass.

Implemented:

- A single studio navigation component serves desktop and the mobile drawer. Tools and templates remain accessible below the desktop-header breakpoint. The header uses normal layout flow; the narrow-screen brand mark and compact search control leave room for account controls.
- The mobile sidebar uses a native modal dialog. Closing it removes its controls from keyboard navigation. Escape and a visible close control dismiss it, focus returns to the opener, and resizing to desktop closes the drawer without reopening it when returning to mobile.
- Tool dialogs and search share the native modal shell. Background interaction is blocked, keyboard navigation stays away from background controls, and focus is restored on close. Search has a visible mobile close button and an accessible input label.
- Workspace results and the composer occupy separate layout tracks. Long prompts reserve their actual height instead of relying on a fixed 176px spacer. On short viewports, the workspace scrolls so the composer remains reachable. Bottom spacing includes the device safe area. Filters and selection actions can wrap.
- Shared dropdowns respect horizontal viewport/clipping bounds as well as vertical bounds. Composer menus use portals to escape scrolling containers; a portal opened within a native dialog stays in that dialog’s top layer. Escape dismisses a nested menu before its parent dialog.
- Storyboard styles use two/three/five columns and shot choices use two/four columns as space permits. The footer stacks on narrow screens.
- The library observes its available content width and caps the saved column preference to retain roughly 120px tiles. Essential library and canvas controls are visible on narrow screens and coarse-pointer devices. Very narrow portrait canvas tiles separate the selection and options controls vertically.
- Mobile prompt inputs use 16px text, and previously unnamed credits and workspace icon controls now have accessible labels.

Verification performed in the local browser:

| Check | Result |
| --- | --- |
| Studio at 320, 390, 768, 1024, 1280, 1440px; English and Arabic | No page/main horizontal overflow or overlapping header groups |
| Mobile navigation → Storyboard, Camera Angles, My Assets | Destinations open; drawer closes |
| Drawer opened on mobile → desktop → mobile | Desktop sidebar appears; modal closes and stays closed |
| Search open/close and tool keyboard traversal | Focus restoration confirmed; background controls excluded |
| Language menu in English/Arabic 320px drawer | Panel remains inside the viewport, with an approximately 8px edge inset |
| Credits menu at 320px | 288px panel fully visible |
| Storyboard at 320px | Style and shot buttons approximately 112px wide; body scrolls |
| Long prompt at 320×740 and 390×420 | Content/composer tracks do not overlap; short workspace is scrollable |
| Composer picker on homepage and short studio viewport | Portalled menu remains visible and bounded |
| `/create-video`, `/projects`, `/favorites`, `/templates`, `/settings`, `/pricing`, `/` at 390px | No page horizontal overflow |
| Fresh server render | Stale development-server markup was resolved by restarting the preview; final studio/homepage hydration rechecked |
| Web TypeScript and ESLint | Passed |

Remaining validation: populated projects/favorites/library tiles, loaded model menus and generation flows need authenticated account data. Library column capping and touch-action visibility have been inspected in code, but a populated-library/device run is still required. Physical iOS/Android keyboards, safe-area behavior and touch gestures have not been certified by desktop viewport emulation. No production build or deployment was performed. The original audit above records the pre-fix state and its original line references.

## Production follow-up — clickefy.ai, 2026-09-14

The public site redirects to `https://www.clickefy.ai`. Checked the populated homepage, templates gallery, pricing page and sign-in form at 320, 390, 768, 1024 and 1280px. Also checked Arabic homepage, templates and pricing at 320, 390 and 768px, including the mobile navigation and video-template filter.

- Homepage, gallery and pricing: no document-level horizontal overflow at the checked widths. Arabic navigation and gallery filtering worked. The language dropdown stayed within the phone viewport.
- Sign-in: **19px horizontal overflow** at 320px and 390px. At a 390px viewport with a 379px document area, the form column measured 398px: Clerk's 350px card plus 48px shell padding. The form column's automatic flex minimum prevented it from shrinking.
- Prepared a minimal fix in `components/auth/auth-shell.tsx`: add `min-w-0` to the form column. This shared shell covers both sign-in and sign-up. No Clerk internals, authentication settings, or page clipping rules are changed.
- TypeScript and targeted ESLint checks passed during this fix. Local visual validation was limited: the existing localhost session redirects away from sign-in, and the isolated loopback-origin preview did not render the Clerk form. The fix therefore needs a production/preview recheck of both authentication forms after deployment; it has **not** been deployed by this task.
- Studio and individual template pages redirect to sign-in in the production browser session. Projects, media-library actions, tool dialogs and generation controls remain unverified on production pending user sign-in. No account content was changed and no generation was submitted.

These are desktop-browser viewport checks, not physical-device keyboard/touch certification.

## Signed-in production follow-up — 2026-09-14

After user sign-in, checked the loaded studio and real account data without submitting generations or changing stored assets/projects.

Passed observations:

- Image studio header/account controls at 320, 390, 768, 1024, 1280 and 1440px: no header overlap or horizontal overflow.
- Arabic video studio at the same widths: no page/main horizontal overflow.
- Loaded image-model picker fits at 320px. The video duration picker stays within the viewport, caps at 320px high and scrolls its longer list.
- A populated 12-asset project displays; selecting two assets exposes a wrapping action bar. Copy-to picker fits the viewport. Selection was cleared afterward.
- Storyboard and camera preset layouts fit at 320px; tool dialogs open from the mobile drawer and close normally. No upload or generation was submitted.
- Search displays real projects/generation results, filters a query and restores focus to the search opener on close.
- Existing library files render at responsive density and their options controls are visible without hover.

Confirmed remaining library bugs and prepared fix:

- At 390px, a 192px file menu starts at x=-20.5 inside a 147.9px tile with `overflow:hidden`. Its labels are visibly cut off.
- Escape while that custom file menu is open closes the entire library. Its menu state can remain open when the library is reopened.
- Replaced the library's custom file/folder menu wrappers with the existing shared `Menu` using a portal. The shared menu stays in the native dialog's top layer, bounds itself to the viewport, and handles Escape before the library. File move-submenu state resets when reopening the trigger. Rename/move/delete callbacks are preserved.
- TypeScript, targeted ESLint, and whitespace checks pass. The local preview lacks this production account's populated library, so the updated tile menus require a production/preview visual recheck after deployment. This task did not deploy the fix.

Returned production to the original English image-creation screen with no selection or test prompt. Physical phone keyboards/gestures, actual uploads, generation execution and destructive/billing actions remain outside this verification pass.

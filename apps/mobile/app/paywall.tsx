/**
 * Standalone paywall route — same UI as the first-run paywall, accessible
 * from Profile / Drawer / Out-of-credits CTAs anywhere in the authenticated
 * app. Mounted at root so it presents over the tabs as a modal.
 */
export { default } from './(auth)/paywall';

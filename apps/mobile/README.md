# Clickefy — mobile app

Expo SDK 57 · expo-router · Clerk · RevenueCat · Sentry. Part of this pnpm
monorepo: it talks to `apps/api` through `@clickfy/sdk` and shares UI from
`@clickfy/ui`.

## Run it on a phone

```bash
pnpm dev --tunnel
```

Scan the QR code with the phone's camera to open it in Expo Go.

- Expo CLI on the Mac and Expo Go on the phone must be signed in to the
  **same** expo.dev account. Otherwise Expo Go refuses the project, or the CLI
  stalls on a login prompt every time the phone connects.
- Keep `EXPO_TOKEN` commented out for development — an exported token signs
  the CLI in as the CI robot account, which Expo Go then refuses.
- Tunnel mode keeps working when the router hands the Mac a new IP; a LAN
  QR code does not.
- Metro watches the whole monorepo. Install `watchman` or the first cold
  bundle is very slow.

## Environment

`.env` (not committed): `EXPO_PUBLIC_API_URL` (required in builds),
`EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`, `EXPO_PUBLIC_SENTRY_DSN`. Only
`EXPO_PUBLIC_*` values are inlined into the app. Values for EAS builds are set
per profile in `eas.json`.

## Checks

```bash
pnpm preflight   # typecheck (regenerates router types first) + lint
```

## Builds

- `pnpm build:ios:preview` / `pnpm build:android:preview` — internal builds.
- `pnpm build:ios:prod`, then `pnpm submit:ios` — TestFlight.

The build scripts read `EXPO_TOKEN` from the commented `# export EXPO_TOKEN=`
line in `.env`. The production profile auto-increments `ios.buildNumber` and
`android.versionCode` in `app.json` — commit the bump. Move any local `ios/`
folder out of the way before a production build: EAS otherwise bumps the
number in the local Xcode project instead, and App Store Connect rejects the
upload as a duplicate.

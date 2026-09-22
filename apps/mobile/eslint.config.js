// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*'],
  },
  {
    // SDK 57's config enables the React Compiler lint rules. Two of them
    // don't fit this codebase yet:
    //   - `immutability` flags every Reanimated `sharedValue.value = x`
    //     write as a mutation — but that IS Reanimated's public API, so
    //     each hit is a false positive.
    //   - `set-state-in-effect` flags a hydrate-from-query pattern used
    //     across several screens; restructuring those is real work that
    //     doesn't belong in the SDK upgrade. Warn (not error) so new code
    //     still gets the nudge without failing `pnpm preflight`.
    rules: {
      'react-hooks/immutability': 'off',
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
]);

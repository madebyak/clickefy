// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', '.expo/*'],
  },
  {
    // SDK 57's config enables the React Compiler lint rules. Two are
    // relaxed here:
    //   - `immutability` flags every Reanimated `sharedValue.value = x`
    //     write as a mutation — but that IS Reanimated's public API, so
    //     each hit is a false positive.
    //   - `set-state-in-effect`: the hydrate-from-query screens it
    //     flagged now adjust state during render instead. Kept at warn
    //     (not error) so a new hit nudges without failing `pnpm preflight`.
    rules: {
      'react-hooks/immutability': 'off',
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
]);

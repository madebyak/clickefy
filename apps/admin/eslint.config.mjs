import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    // eslint-plugin-react-hooks v6 ships two new rules tied to the
    // React Compiler — `react-hooks/purity` and
    // `react-hooks/set-state-in-effect` — both still marked
    // experimental in the React docs. They fire on a number of
    // legitimate patterns we use intentionally (e.g. tagging an error
    // log with `Date.now()`, initialising client-only state inside an
    // effect on first mount). We downgrade them to off here rather
    // than rewriting code to satisfy advisory rules; revisit once the
    // rules graduate out of experimental + we adopt React Compiler.
    rules: {
      "react-hooks/purity": "off",
      "react-hooks/set-state-in-effect": "off",
      // Admin renders dynamic media straight from R2 / dev-time data
      // URLs where Next's `<Image />` loader configuration isn't worth
      // the per-host whitelist churn. The end-user impact (perf,
      // bandwidth) lives in the mobile app, not this internal tool.
      "@next/next/no-img-element": "off",
    },
  },
]);

export default eslintConfig;

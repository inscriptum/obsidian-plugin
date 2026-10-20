// Mirrors the Obsidian community-review CSS lint so `npm run lint:css`
// shows locally the same warnings the review bot reports.
export default {
  extends: [],
  plugins: ["stylelint-no-unsupported-browser-features"],
  // The review reports CSS findings as warnings; keep the same severity so
  // `npm run lint:css -- --max-warnings 0` gates the way the eslint gate does.
  defaultSeverity: "warning",
  rules: {
    "declaration-no-important": true,
    "declaration-block-no-duplicate-properties": true,
    "plugin/no-unsupported-browser-features": [
      true,
      {
        browsers: ["Chrome >= 124"],
        // The review reports these as per-entry warnings; keep the default
        // "severity" behavior so each unsupported feature usage is reported.
        ignore: [],
        ignorePartialSupport: false,
      },
    ],
  },
  ignoreFiles: ["node_modules/**", "dist/**", "dist-harness/**", ".harness/**"],
};

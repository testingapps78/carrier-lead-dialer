import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

// Next.js 16 removed `next lint`; this runs ESLint directly with Next's recommended rules.
// The newer React-compiler-style rules below flag a pattern used throughout the existing app
// (resetting state inside effects). They are reported as warnings so they stay visible without
// blocking unrelated work; every other rule keeps its default severity.
const config = [
  ...nextCoreWebVitals,
  {
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/refs": "warn",
    },
  },
  { ignores: [".next/**", "node_modules/**", "supabase/**", "next-env.d.ts"] },
];
export default config;

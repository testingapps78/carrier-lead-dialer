/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,ts,jsx,tsx}", "./components/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        base: "#0B0E14",
        surface: "#131822",
        surface2: "#1A2130",
        border: "#232B3A",
        ink: "#E8ECF2",
        muted: "#8B96A8",
        accent: "#F5A623",
        accentDim: "#8A6321",
        good: "#3FB27F",
        bad: "#E2544B",
        info: "#4F8FE8",
        slate: "#566277",
      },
      fontFamily: {
        display: ["var(--font-display)", "sans-serif"],
        body: ["var(--font-body)", "sans-serif"],
        mono: ["var(--font-mono)", "monospace"],
      },
    },
  },
  plugins: [],
};

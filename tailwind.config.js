/** @type {import('tailwindcss').Config} */
const c = (name) => `rgb(var(--${name}) / <alpha-value>)`;

module.exports = {
  darkMode: ["selector", '[data-theme="dark"]'],
  content: ["./app/**/*.{js,ts,jsx,tsx}", "./components/**/*.{js,ts,jsx,tsx}"],
  theme: {
    // Type scale: 12 / 14 / 16 / 20 / 28
    fontSize: {
      xs: ["12px", "16px"],
      sm: ["14px", "20px"],
      base: ["16px", "24px"],
      lg: ["20px", "28px"],
      xl: ["20px", "28px"],
      "2xl": ["28px", "34px"],
      "3xl": ["28px", "34px"],
      "4xl": ["28px", "34px"],
    },
    extend: {
      colors: {
        bg: c("bg"),
        card: c("card"),
        inset: c("inset"),
        border: c("border"),
        text: c("text"),
        "text-muted": c("text-muted"),
        accent: c("accent"),
        "accent-ink": c("accent-ink"),
        "accent-text": c("accent-text"),
        success: c("success"),
        warning: c("warning"),
        danger: c("danger"),
        info: c("info"),
        slate: c("slate"),
        scrim: c("scrim"),
        // Older names, kept as aliases so existing components keep working while screens are migrated
        canvas: c("bg"),
        surface: c("card"),
        surface2: c("inset"),
        ink: c("text"),
        muted: c("text-muted"),
        oncolor: c("accent-text"),
        good: c("success"),
        bad: c("danger"),
        accentDim: c("accent"),
      },
      borderRadius: { tile: "18px" },
      boxShadow: { tile: "var(--tile-shadow)" },
      fontFamily: {
        body: ["var(--font-inter)", "system-ui", "sans-serif"],
        display: ["var(--font-inter)", "system-ui", "sans-serif"],
        mono: ["var(--font-inter)", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

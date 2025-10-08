import type { Config } from "tailwindcss";
import defaultTheme from "tailwindcss/defaultTheme";

const config: Config = {
  content: ["./src/app/**/*.{ts,tsx}", "./src/components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "#E8F5F0",
        surface: "#FFFFFF",
        brand: {
          50: "#E8F9F5",
          100: "#D1F3EB",
          200: "#A3E7D7",
          300: "#75DBC3",
          400: "#5DD4C3",
          500: "#3FBFAA",
          600: "#2A9D8F",
        },
        accent: {
          50: "#FFF0F3",
          100: "#FFE1E7",
          200: "#FFC3CF",
          300: "#FFB8C8",
          400: "#FF9999",
          500: "#FF7B7B",
          600: "#E65C5C",
        },
        muted: "#64748B",
        border: "#D1E7DD",
      },
      boxShadow: {
        card: "0 18px 40px -24px rgba(37, 99, 235, 0.35)",
        soft: "0 12px 32px -20px rgba(15, 23, 42, 0.25)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", ...defaultTheme.fontFamily.sans],
      },
    },
  },
  plugins: [],
};

export default config;

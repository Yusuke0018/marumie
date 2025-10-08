import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/app/**/*.{ts,tsx}", "./src/components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        midnight: {
          50: "#f5f7fa",
          100: "#eaeef4",
          200: "#cdd6e4",
          300: "#afbcd4",
          400: "#7484b4",
          500: "#395c94",
          600: "#2f4c7a",
          700: "#253b5f",
          800: "#1b2a45",
          900: "#121c30",
          950: "#0b111f",
        },
      },
    },
  },
  plugins: [],
};

export default config;

import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: "#000000",
        surface: "#0F1A24",
        surfaceDeep: "#0A1018",
        amber: "#FFAB00",
        amberLight: "#FFD54F",
        orange: "#FF6D00",
        orangeDeep: "#E65100",
        paper: "#FFFFFF",
        muted: "#A7A7A7",
        success: "#34D399",
        danger: "#FF6D00",
      },
      fontFamily: {
        display: ["var(--font-display)", "Arial Narrow", "sans-serif"],
        finance: ["var(--font-finance)", "Segoe UI", "sans-serif"],
        panel: ["var(--font-panel)", "Arial Narrow", "sans-serif"],
        ui: ["var(--font-ui)", "Arial Narrow", "sans-serif"],
        brand: ["var(--font-brand)", "Segoe UI", "sans-serif"],
        mono: ["var(--font-ui)", "JetBrains Mono", "monospace"],
        body: ["Poppins", "Plus Jakarta Sans", "Segoe UI", "sans-serif"],
      },
      boxShadow: {
        panel: "0 0 30px rgba(0,0,0,0.8), inset 0 0 20px rgba(255,171,0,0.05)",
        amber: "0 0 18px rgba(255,171,0,0.24)",
        glass: "0 24px 60px -24px rgba(0,0,0,0.9), inset 0 1px 0 rgba(255,255,255,0.10)",
      },
      keyframes: {
        reveal: {
          "0%": { opacity: "0", transform: "translateY(12px)", filter: "blur(4px)" },
          "100%": { opacity: "1", transform: "translateY(0)", filter: "blur(0)" },
        },
      },
      animation: {
        reveal: "reveal 400ms cubic-bezier(0.16, 1, 0.3, 1) both",
      },
    },
  },
  plugins: [],
};
export default config;

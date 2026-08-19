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
        muted: "#FFF7ED",
        success: "#86EFAC",
        danger: "#FF6D00",
      },
      fontFamily: {
        display: ["var(--font-jakarta)", "Plus Jakarta Sans", "sans-serif"],
        body: ["var(--font-geist)", "Geist", "sans-serif"],
        mono: ["var(--font-mono)", "JetBrains Mono", "monospace"],
      },
      boxShadow: {
        panel: "0 0 30px rgba(0,0,0,0.8), inset 0 0 20px rgba(255,171,0,0.05)",
        amber: "0 0 18px rgba(255,171,0,0.24)",
      },
      keyframes: {
        reveal: { "0%": { opacity: "0", transform: "translateY(16px)", filter: "blur(4px)" }, "100%": { opacity: "1", transform: "translateY(0)", filter: "blur(0)" } },
      },
      animation: { reveal: "reveal 500ms cubic-bezier(0.2,0.8,0.2,1) both" },
    },
  },
  plugins: [],
};
export default config;

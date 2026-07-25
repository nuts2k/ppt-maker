import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/renderer/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: "#181d26",
        "primary-active": "#0d1218",
        ink: "#181d26",
        body: "#333840",
        muted: "#41454d",
        hairline: "#dddddd",
        "border-strong": "#9297a0",
        canvas: "#ffffff",
        "surface-soft": "#f8fafc",
        "surface-strong": "#e0e2e6",
        "surface-dark": "#181d26",
        "surface-dark-elevated": "#1d1f25",
        link: "#1b61c9",
        "link-active": "#1a3866",
        info: "#254fad",
        "info-border": "#458fff",
        success: "#006400",
        "success-border": "#39bf45",
        "on-primary": "#ffffff",
        "on-dark": "#ffffff",
        // DESIGN.md 签名色面（品牌电压），同时充当状态语义色：
        // failed/interrupted → coral；stale → mustard；待验收强调 → cream
        "signature-coral": "#aa2d00",
        "signature-forest": "#0a2e0e",
        "signature-cream": "#f5e9d4",
        "signature-peach": "#fcab79",
        "signature-mint": "#a8d8c4",
        "signature-yellow": "#f4d35e",
        "signature-mustard": "#d9a441",
        error: "#8b1a1a",
        "error-light": "#fef2f2",
        "error-border": "#dc4545",
        warning: "#7c4a00",
        "warning-light": "#fefce8",
        "warning-border": "#d97706",
        "block-layout": "#16a34a",
        "block-object": "#9ca3af",
        "block-uncertain": "#f59e0b",
      },
      borderRadius: {
        xs: "2px",
        sm: "6px",
        md: "10px",
        lg: "12px",
      },
      fontFamily: {
        sans: [
          "Inter",
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
      },
    },
  },
  plugins: [],
};

export default config;

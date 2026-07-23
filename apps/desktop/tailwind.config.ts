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
        link: "#1b61c9",
        "link-active": "#1a3866",
        info: "#254fad",
        "info-border": "#458fff",
        success: "#006400",
        "success-border": "#39bf45",
        "on-primary": "#ffffff",
        "on-dark": "#ffffff",
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

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Segoe UI", "system-ui", "-apple-system", "Roboto", "Helvetica Neue", "Arial", "Noto Sans Oriya", "sans-serif"],
        mono: ["ui-monospace", "SF Mono", "Fira Code", "monospace"]
      }
    }
  },
  plugins: []
};

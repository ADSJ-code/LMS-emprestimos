/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: '#0f172a', 
        secondary: '#facc15',
        danger: '#ef4444',
        success: '#22c55e',
        background: '#f3f4f6' 
      }
    },
  },
  plugins: [],
}
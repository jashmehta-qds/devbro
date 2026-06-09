/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './src/renderer/**/*.{js,ts,jsx,tsx,html}',
    './src/renderer/index.html'
  ],
  theme: {
    extend: {
      colors: {
        gray: {
          850: '#1a1f2e',
          900: '#0f1117',
          950: '#080b10'
        }
      }
    }
  },
  plugins: []
}

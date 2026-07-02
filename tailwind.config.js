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
          50:  '#f5f5f7',
          100: '#e8e8ea',
          200: '#c9c9cf',
          300: '#a1a1a8',
          400: '#8a8a91',
          500: '#6b6b73',
          600: '#4a4a52',
          700: '#33333a',
          800: '#26262b',
          850: '#1c1c1f',
          900: '#141416',
          950: '#0d0d0f'
        }
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace']
      },
      borderRadius: {
        DEFAULT: '10px',
        lg: '12px',
        xl: '14px',
        '2xl': '16px'
      },
      boxShadow: {
        soft: '0 1px 2px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.03)',
        elev: '0 8px 24px -8px rgba(0,0,0,0.6), 0 2px 6px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.04)',
        pop: '0 24px 48px -12px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.06)'
      },
      transitionTimingFunction: {
        'out-quart': 'cubic-bezier(0.25, 1, 0.5, 1)'
      },
      keyframes: {
        'fade-in': { '0%': { opacity: '0', transform: 'translateY(4px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
        'scale-in': { '0%': { opacity: '0', transform: 'scale(0.96)' }, '100%': { opacity: '1', transform: 'scale(1)' } },
        shimmer: { '0%': { backgroundPosition: '-200% 0' }, '100%': { backgroundPosition: '200% 0' } }
      },
      animation: {
        'fade-in': 'fade-in 180ms cubic-bezier(0.25, 1, 0.5, 1)',
        'scale-in': 'scale-in 160ms cubic-bezier(0.25, 1, 0.5, 1)',
        shimmer: 'shimmer 2.4s linear infinite'
      }
    }
  },
  plugins: []
}

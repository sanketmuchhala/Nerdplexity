/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Pure dark neutrals — no green tint
        neutral: {
          950: '#09090b',  // void black
          900: '#0f0f13',  // surface
          850: '#141419',  // card
          800: '#1a1a22',  // elevated / hover
          750: '#1e1e28',  // border hover
          700: '#27272a',  // border
          600: '#3f3f46',  // disabled
          500: '#52525b',  // very muted text
          400: '#71717a',  // muted text
          300: '#a1a1aa',  // secondary text
          200: '#d4d4d8',  // body text
          100: '#f4f4f5',  // emphasized
          50:  '#fafafa',  // near white
        },
        // Rose — primary accent
        nerdplexity: {
          50:  '#fff1f2',
          100: '#ffe4e6',
          200: '#fecdd3',
          300: '#fda4af',
          400: '#fb7185',
          500: '#f43f5e',
          600: '#e11d48',
          700: '#be123c',
          800: '#9f1239',
          900: '#881337',
          950: '#4c0519',
        },
        glow: {
          300: '#fda4af',
          400: '#fb7185',
          500: '#f43f5e',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
      },
      fontSize: {
        'xs':   ['11px', { lineHeight: '16px' }],
        'sm':   ['13px', { lineHeight: '20px' }],
        'base': ['14px', { lineHeight: '22px' }],
        'lg':   ['15px', { lineHeight: '24px' }],
        'xl':   ['17px', { lineHeight: '26px' }],
        '2xl':  ['19px', { lineHeight: '28px' }],
        '3xl':  ['24px', { lineHeight: '32px' }],
      },
      borderRadius: {
        'xl':  '10px',
        '2xl': '14px',
        '3xl': '20px',
      },
      spacing: {
        '18': '4.5rem',
      },
      animation: {
        'spin-slow':   'spin 3s linear infinite',
        'fade-in':     'fadeIn 0.3s ease-out',
        'message-in':  'messageIn 0.25s ease-out',
        'slideDown':   'slideDown 0.25s ease-out',
        'pulse-slow':  'pulse 2.5s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
      keyframes: {
        fadeIn: {
          '0%':   { opacity: '0', transform: 'translateY(3px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        messageIn: {
          '0%':   { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideDown: {
          '0%':   { opacity: '0', transform: 'translateY(-6px)', maxHeight: '0' },
          '100%': { opacity: '1', transform: 'translateY(0)', maxHeight: '300px' },
        },
      },
    },
  },
  plugins: [],
}

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
        // Nerdplexity themed color palette
        neutral: {
          950: '#0a0a0a', // deep space black - base background
          900: '#0d1b0d', // dark green-black - panel background
          850: '#1a2e1a', // forest green-black - card/input background
          800: '#2a4a2a', // darker forest green - hover states
          750: '#3a5a3a', // medium forest green - border states
          700: '#4a6a4a', // forest green - borders
          600: '#6a8a6a', // muted green-gray - disabled text
          400: '#8ab48a', // soft green-gray - muted text
          300: '#aed4ae', // light green-gray - secondary text
          200: '#d4ead4', // very light green - primary text
          100: '#eaf5ea', // pale green - bright text
          50: '#f5faf5'   // brightest green tint
        },
        // Nerdplexity signature colors
        nerdplexity: {
          50: '#f0fdf4',   // palest green
          100: '#dcfce7',  // very light green
          200: '#bbf7d0',  // light green
          300: '#86efac',  // medium-light green
          400: '#4ade80',  // bright green
          500: '#22c55e',  // core green
          600: '#16a34a',  // darker green
          700: '#15803d',  // forest green
          800: '#166534',  // dark forest green
          900: '#14532d',  // darkest green
          950: '#052e16'   // black-green
        },
        // Glowing effects
        glow: {
          50: '#f0fff4',
          100: '#dcfce7',
          200: '#bbf7d0',
          300: '#4ade80',  // primary glow
          400: '#22c55e',  // secondary glow
          500: '#16a34a'   // accent glow
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'sans-serif']
      },
      fontSize: {
        'xs': ['12px', { lineHeight: '16px' }],    // meta text
        'sm': ['14px', { lineHeight: '20px' }],    // body text  
        'base': ['15px', { lineHeight: '24px' }],  // default body
        'lg': ['16px', { lineHeight: '24px' }],    // inputs
        'xl': ['18px', { lineHeight: '28px' }],    // heading-sm
        '2xl': ['20px', { lineHeight: '32px' }],   // heading-md
        '3xl': ['24px', { lineHeight: '36px' }]    // heading-lg
      },
      borderRadius: {
        'xl': '12px',
        '2xl': '16px'
      },
      spacing: {
        '18': '4.5rem' // 72px for better spacing options
      },
      animation: {
        'spin-slow': 'spin 3s linear infinite',
        'fade-in': 'fadeIn 0.5s ease-in-out',
        'slideDown': 'slideDown 0.5s ease-in-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: 0 },
          '100%': { opacity: 1 },
        },
        slideDown: {
          '0%': { transform: 'translateY(-20px)', opacity: 0 },
          '100%': { transform: 'translateY(0)', opacity: 1 },
        },
      }
    },
  },
  plugins: [],
}
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // STERAS brand — olive/forest green primary (civic, safe, Malaysian-natural)
        brand: {
          50:  '#f4f7ed',   // very light cream-green tint
          100: '#e6edd6',
          200: '#cfdcb0',
          300: '#b3c781',
          400: '#94b257',
          500: '#759a37',
          600: '#627820',   // PRIMARY olive (logo shield)
          700: '#4f6120',
          800: '#3f4d1d',
          900: '#34411c',
          950: '#1a230d',
          accent: '#83C732', // bright "approved" green accent
        },
        // Mustard / gold accent (logo star)
        gold: {
          50:  '#fdf9eb',
          100: '#faf0c9',
          200: '#f6e892',   // cream-gold from palette
          300: '#f0c340',   // main mustard
          400: '#eab12a',
          500: '#d49813',
          600: '#a17932',   // muted mustard (logo fallback)
        },
        // Cream / sand background tones
        cream: {
          DEFAULT: '#F1E2C7', // main background tint
          50:  '#fbf7ee',
          100: '#f5edd9',
          200: '#f1e2c7',
          300: '#e8d3a7',
          400: '#dcc593',
          500: '#c4ae74',
        },
        // Ink — primary text dark
        ink: {
          DEFAULT: '#1F2937',
          50:  '#f6f7f9',
          100: '#e7eaef',
          200: '#cfd5df',
          300: '#aab3c2',
          400: '#7d8696',
          500: '#5b6473',
          600: '#3f4754',
          700: '#2c333d',
          800: '#1f2937',   // PRIMARY text dark
          900: '#141a23',
        },
        // Risk semantics — fills, accessible text on light surfaces, and text on dark surfaces
        'risk-low':            '#2DA44E',
        'risk-medium':         '#F0C340',
        'risk-high':           '#E63946',
        'risk-low-text':       '#287A45',
        'risk-medium-text':    '#876216',
        'risk-high-text':      '#C72E38',
        'risk-low-inverse':    '#8BD976',
        'risk-medium-inverse': '#F6D25B',
        'risk-high-inverse':   '#FF817B',
        'status-pending':  '#F0C340',
        'status-review':   '#F59E0B',
        'status-approved': '#2DA44E',
        'status-rejected': '#E63946',
        'status-amend':    '#A19432',
      },
      fontFamily: {
        display: ['Plus Jakarta Sans', 'system-ui', 'sans-serif'],
        sans: ['Source Sans 3', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        'card': '0 1px 2px 0 rgba(31, 41, 55, 0.04), 0 1px 3px 0 rgba(31, 41, 55, 0.06)',
        'card-hover': '0 4px 6px -1px rgba(98, 120, 32, 0.10), 0 2px 4px -1px rgba(98, 120, 32, 0.06)',
      },
      borderRadius: {
        'xl2': '0.875rem',
      },
    },
  },
  plugins: [],
};

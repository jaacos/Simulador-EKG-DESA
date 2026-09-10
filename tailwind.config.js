/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        slate: {
          850: '#151e2e',
        },
        ecg: {
          DEFAULT: '#22e07f',
          400: '#22e07f',
        },
        pleth: {
          DEFAULT: '#2dd4ee',
          400: '#2dd4ee',
        },
        resp: {
          DEFAULT: '#facc15',
          400: '#facc15',
        },
        desa: {
          DEFAULT: '#f59e0b',
          400: '#f59e0b',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"Chakra Petch"', 'ui-monospace', 'monospace'],
        lcd: ['"Share Tech Mono"', '"Chakra Petch"', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
};

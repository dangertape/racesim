/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts}'],
  theme: {
    extend: {
      colors: {
        track: {
          bg: '#0f1117',
          panel: '#1a1d27',
          border: '#2a2d3a',
          accent: '#e8c84a',
          muted: '#6b7280',
        },
      },
    },
  },
  plugins: [
    require('@tailwindcss/forms'),
  ],
}

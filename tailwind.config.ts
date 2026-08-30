import type { Config } from 'tailwindcss';

/**
 * Tailwind CSS configuration for Particle Diary.
 *
 * Custom design tokens:
 * - Deep warm background (#1b140f → #080605)
 * - Gold accent (rgba(212, 168, 83))
 * - Light warm white text (#E8DDD0)
 * - Fonts: Noto Serif SC (headings/diary), Inter (body/chat), monospace (buttons)
 */
const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Deep warm background palette
        'warm-bg': {
          DEFAULT: '#1b140f',
          dark: '#080605',
          light: '#2a1f17',
        },
        // Gold accent
        gold: {
          DEFAULT: 'rgba(212, 168, 83, 1)',
          soft: 'rgba(212, 168, 83, 0.07)',
          muted: 'rgba(212, 168, 83, 0.5)',
        },
        // Light warm white text
        'warm-white': {
          DEFAULT: '#E8DDD0',
          muted: 'rgba(232, 221, 208, 0.6)',
        },
        'glass-bg': 'rgba(255, 255, 255, 0.05)',
        'glass-border': 'rgba(255, 255, 255, 0.1)',
      },
      fontFamily: {
        serif: ['"Noto Serif SC"', 'serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'monospace'],
      },
      backdropBlur: {
        xs: '2px',
      },
      animation: {
        'fade-in': 'fadeIn 700ms ease-out forwards',
        'slide-up': 'slideUp 500ms ease-out forwards',
        'pulse-soft': 'pulseSoft 2s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        pulseSoft: {
          '0%, 100%': { opacity: '0.7' },
          '50%': { opacity: '1' },
        },
      },
    },
  },
  plugins: [],
};

export default config;

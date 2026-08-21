/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // —— ForgeMind 设计 token（补充设计 §1.2，映射为 Tailwind 主题）——
      colors: {
        // 背景主色（工业暗色）
        'fm-bg': '#0d1117',
        'fm-bg-2': '#161b22',
        // 面板玻璃
        'fm-panel': 'rgba(20, 26, 34, 0.72)',
        // 主强调色（青蓝）
        'fm-accent': '#4fc3f7',
        'fm-accent-2': '#29b6f6',
        // 次强调色（品红 / 黄）
        'fm-magenta': '#ec407a',
        'fm-amber': '#fbc02d',
        // 文字
        'fm-text': '#dbe4ee',
        'fm-text-dim': '#8b98a9',
        // 成功 / 危险
        'fm-ok': '#66bb6a',
        'fm-danger': '#ef5350',
        // 描边
        'fm-edge': 'rgba(120, 160, 200, 0.18)',
      },
      borderRadius: {
        fm: '2px',
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', 'Consolas', 'monospace'],
        sans: ['Inter', 'sans-serif'],
      },
    },
  },
  plugins: [],
}

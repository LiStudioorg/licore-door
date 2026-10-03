/**
 * 极简主题切换：系统偏好优先，点击后写入 localStorage 并切换 .dark 类。
 * 不引入额外依赖。
 */
export function useTheme() {
  const isDark = useState<boolean>('theme-dark', () => false)
  const ready = useState<boolean>('theme-ready', () => false)

  function apply(dark: boolean) {
    isDark.value = dark
    if (import.meta.client) {
      document.documentElement.classList.toggle('dark', dark)
      document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
    }
  }

  function init() {
    if (!import.meta.client || ready.value) return
    const saved = localStorage.getItem('licore-theme')
    const prefers = window.matchMedia('(prefers-color-scheme: dark)').matches
    apply(saved ? saved === 'dark' : prefers)
    ready.value = true

    // 未显式选择时跟随系统变化
    window
      .matchMedia('(prefers-color-scheme: dark)')
      .addEventListener('change', (e) => {
        if (!localStorage.getItem('licore-theme')) apply(e.matches)
      })
  }

  function toggle() {
    const next = !isDark.value
    apply(next)
    if (import.meta.client) {
      localStorage.setItem('licore-theme', next ? 'dark' : 'light')
    }
  }

  return { isDark, init, toggle, apply }
}

/** 供模板里直接调用的兜底切换函数 */
export function toggleTheme() {
  useTheme().toggle()
}

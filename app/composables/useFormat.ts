/**
 * 跨端可用的格式化工具（服务端与客户端都会用到）。
 */

/** 字节数转人类可读体积 */
export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return ''
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = bytes
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`
}

/** ISO 时间转中文日期 */
export function formatDate(iso: string, style: 'long' | 'short' = 'long'): string {
  if (!iso) return '日期未知'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '日期未知'
  return new Intl.DateTimeFormat('zh-CN',
    style === 'long'
      ? { year: 'numeric', month: 'long', day: 'numeric' }
      : { year: 'numeric', month: '2-digit', day: '2-digit' },
  ).format(d)
}

/** 相对时间：3 天前 */
export function formatRelative(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const diff = Date.now() - d.getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} 小时前`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day} 天前`
  const mon = Math.floor(day / 30)
  if (mon < 12) return `${mon} 个月前`
  return `${Math.floor(mon / 12)} 年前`
}

/** 数字千分位 */
export function formatNumber(n: number): string {
  return new Intl.NumberFormat('zh-CN').format(n)
}

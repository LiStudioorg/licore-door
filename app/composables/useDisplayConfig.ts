/**
 * 生效的展示配置（服务端下发）。
 *
 * ⚠️ 命名注意：**不要叫 `useSiteConfig`**。
 * `@nuxtjs/sitemap` 会带入 `nuxt-site-config` 模块，它自动导入了一个**同名**的
 * `useSiteConfig`（返回该模块自己的 siteConfig，一个 reactive 对象）。
 * 同名时自动导入会解析到模块那个，本 composable 根本不会被执行，
 * 调用方拿到的对象上 `display` 是 `undefined`，模板一读属性就抛
 * "Cannot read properties of undefined (reading 'showActivity')"。
 * 因此这里刻意用 `useDisplayConfig` 这个名字避开冲突。
 *
 * 为什么要有这层：`display.*` 这些开关是在**后台面板**里改的，改完要立即生效。
 * 页面不能直接 import `server/utils/config`（会把 node:fs 打进客户端 bundle，
 * 见 DEVELOPMENT.md §13.3），所以统一走 `/api/site-config`。
 *
 * 用 `useAsyncData` + `server: true` 的理由与页面取数一致：
 *   1. 值写进 SSR payload，客户端水合不再重新请求；
 *   2. 首屏渲染与服务端读到的是同一份值，不会出现"SSR 显示、客户端闪一下消失"。
 *
 * 取数失败一律回退到内置默认值 —— 展示开关不该让页面挂掉。
 */
export interface DisplayRuntimeConfig {
  display: {
    changelogMaxItems: number
    showActivity: boolean
  }
  site: {
    name: string
    url: string
    icp: string
  }
}

/** 与 server/utils/config.ts 的 DEFAULTS.display 保持一致 */
const FALLBACK: DisplayRuntimeConfig = {
  display: {
    changelogMaxItems: 0,
    showActivity: true,
  },
  site: {
    name: '',
    url: '',
    icp: '',
  },
}

export function useDisplayConfig() {
  const { data } = useAsyncData<DisplayRuntimeConfig>(
    'site-runtime-config',
    async () => {
      const res = await $fetch<DisplayRuntimeConfig & { ok: boolean }>('/api/site-config').catch(() => null)
      if (!res) return FALLBACK
      return {
        display: { ...FALLBACK.display, ...res.display },
        site: { ...FALLBACK.site, ...res.site },
      }
    },
    { server: true, default: () => FALLBACK },
  )

  /**
   * 返回 computed 而不是裸值，这样模板里是响应式的。
   *
   * ⚠️ 但要注意：`data.value` 在**同一次 setup 内、异步 loader 尚未 resolve 时**
   * 可能是 undefined（`default` 只在 resolve 之后兜底，不覆盖"还没开始取"的瞬间）。
   * 因此调用方如果在另一个 `useAsyncData` 的 loader 里读它，必须走
   * `fetchDisplayConfig()`（见下）而不是直接读 `.value`，否则会拿到 undefined
   * 并抛 "Cannot read properties of undefined"。
   */
  return computed<DisplayRuntimeConfig>(() => data.value ?? FALLBACK)
}

/**
 * 在**另一个 useAsyncData 的 loader 内部**安全地读取展示配置。
 *
 * 它直接发起（或复用）同一份请求，不依赖 useAsyncData 的 resolve 时序，
 * 因此不会出现"读的时候还没数据"的崩溃。key 相同，Nuxt 会自动去重。
 */
export async function fetchDisplayConfig(): Promise<DisplayRuntimeConfig> {
  const res = await $fetch<DisplayRuntimeConfig & { ok: boolean }>('/api/site-config').catch(() => null)
  if (!res) return FALLBACK
  return {
    display: { ...FALLBACK.display, ...res.display },
    site: { ...FALLBACK.site, ...res.site },
  }
}

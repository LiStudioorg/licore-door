/**
 * 页面级 SEO 的统一入口。
 *
 * 存在的意义：分享图的尺寸、类型与 alt 文本必须**每一页都带全**，
 * 否则抓取器拿不到宽高，部分平台会拒绝渲染大图卡片或延迟抓取。
 * 之前 5 个页面各自手写一遍 `ogImage`，既容易漏字段，也容易在换图时漏改。
 *
 * 用法与 `useSeoMeta` 一致，只是 og:image / twitter:image 相关字段
 * （含宽高、类型、alt）由这里统一补全，页面只传标题与描述。
 * `useSeoMeta` / `useHead` / `site` / `ogImageUrl` 均为 Nuxt 自动导入。
 */
export function usePageSeo(
  meta: Record<string, unknown>,
  options: { path?: string } = {},
) {
  useSeoMeta({
    ...meta,
    ogImage: ogImageUrl,
    ogImageWidth: site.ogImageWidth,
    ogImageHeight: site.ogImageHeight,
    ogImageAlt: site.ogImageAlt,
    ogImageType: 'image/png',
    twitterImage: ogImageUrl,
    twitterImageAlt: site.ogImageAlt,
    // twitter:card 已在 app.vue 统一设为 summary_large_image，不再重复声明
  })

  /**
   * 每页显式声明 canonical。app.vue 里已有一份基于 `route.path` 的
   * computed canonical，两者取值一致；页面级声明更明确，且后声明者生效，
   * 不会产生冲突。
   */
  if (options.path) {
    useHead({
      link: [{ rel: 'canonical', href: `${site.url}${options.path}` }],
    })
  }
}

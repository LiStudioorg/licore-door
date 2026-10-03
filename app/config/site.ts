/**
 * 站点级配置。所有 SEO / 外链相关的常量集中在此，改域名只需改这里。
 */
export const site = {
  /** 规范站点地址（canonical / og:url / sitemap 均以此为准） */
  url: 'http://licore.z321.cc.cd',
  name: 'LiCore',
  title: 'LiCore — 轻量级容器引擎',
  tagline: '10–20 MiB 常驻内存 · 单二进制分发 · 完全自研生态',
  description:
    'LiCore 是一个用 Go 编写的轻量级容器引擎：常驻内存 10–20 MiB，单二进制分发，覆盖 Linux / Android（有 Root）/ macOS，自研镜像格式 .licore，不依赖 Docker、containerd 或任何 OCI 组件。',
  keywords: [
    'LiCore',
    'licore',
    '轻量级容器引擎',
    '容器引擎',
    'Go 容器',
    'Docker 替代',
    '.licore 镜像',
    'Android 容器',
    '单二进制容器',
    'Boxli',
  ],
  author: 'LiStudioorg',
  license: 'AGPL-3.0-only',
  locale: 'zh_CN',
  lang: 'zh-CN',
  /** 主题色，用于 theme-color meta 与 PWA 场景 */
  themeColor: '#09090b',
} as const

/** 上游 GitHub 仓库坐标 —— 所有动态数据都来自这里 */
export const repo = {
  owner: 'LiStudioorg',
  name: 'licore',
  get slug() {
    return `${this.owner}/${this.name}`
  },
  get url() {
    return `https://github.com/${this.owner}/${this.name}`
  },
  /** 改名前的旧仓库地址，GitHub 会自动重定向 */
  formerNames: ['boxli'],
} as const

/** 页面级导航 */
export const navLinks = [
  { label: '首页', to: '/' },
  { label: '更新日志', to: '/changelog' },
  { label: '下载', to: '/download' },
  { label: '文档', to: '/docs' },
  { label: '关于', to: '/about' },
] as const

/** 构建矩阵：与上游 Makefile 的产物一一对应 */
export const buildMatrix = [
  {
    name: 'linux-amd64',
    os: 'Linux',
    arch: 'amd64',
    note: '服务器 / 桌面主力平台',
    recommended: true,
  },
  {
    name: 'linux-arm64',
    os: 'Linux',
    arch: 'arm64',
    note: 'ARM 服务器、树莓派等',
    recommended: false,
  },
  {
    name: 'android-arm64',
    os: 'Android',
    arch: 'arm64',
    note: '需 Root；带 cgo 时 licore exec 可用',
    recommended: false,
  },
] as const

<script setup lang="ts">
/**
 * 后台管理面板 —— /admin
 *
 * 两层结构，同一个页面：
 *   1. 未登录 → 登录表单（账号密码来自 licore-site.toml 的 [admin] 段）
 *   2. 已登录 → 状态监控 + 缓存管理
 *
 * 这是个「运维面板」而非内容后台：版本号与下载链接由 server/utils/changelog.ts
 * 运行时自动聚合，本来就不需要人工干预，所以这里只暴露真正需要人管的：
 * 上游可达性、缓存新鲜度、生效配置。
 *
 * 页面对搜索引擎完全关闭（noindex + robots.txt 屏蔽），并且不出现在导航栏里。
 */
import { Button, Card, Chip, Badge, Input } from 'fuxsto-design'
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Database,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  LogOut,
  RefreshCw,
  RotateCcw,
  Save,
  Server,
  Settings2,
  SlidersHorizontal,
  Trash2,
  XCircle,
} from 'lucide-vue-next'
import { site } from '~/config/site'

/* ---------------- SEO：后台绝不能被收录 ---------------- */
useSeoMeta({
  title: '后台管理',
  description: 'LiCore 官网后台管理面板。',
  robots: 'noindex, nofollow',
})

useHead({
  // 覆盖 app.vue 里的 canonical，避免后台页声明一个可收录的规范地址
  link: [{ rel: 'canonical', href: `${site.url}/admin` }],
  meta: [{ name: 'robots', content: 'noindex, nofollow, noarchive' }],
})

/* ---------------- 数据结构（与 /api/admin/status 对应） ---------------- */
interface CacheEntry {
  key: string
  ageSeconds: number
  ttlSeconds: number
  fresh: boolean
}

interface AdminStatus {
  ok: boolean
  upstream: {
    reachable: boolean
    repo: string
    pushedAt: string
    stars: number
    latencyMs: number
    error?: string
  }
  cache: { entries: CacheEntry[]; inflight: string[] }
  config: {
    path: string | null
    warnings: string[]
    site: { url: string; name: string; icp: string }
    admin: {
      enabled: boolean
      username: string
      sessionHours: number
      allowCacheClear: boolean
      allowConfigEdit: boolean
      usingDefaultPassword: boolean
    }
    github: {
      tokenConfigured: boolean
      tokenSource: 'env' | 'runtime' | 'toml' | 'none'
      releasesTtlSeconds: number
      repoTtlSeconds: number
      contributorsTtlSeconds: number
      effectiveReleaseTtlSeconds: number
    }
    display: { changelogMaxItems: number; showActivity: boolean }
  }
  /** 可视化编辑：字段清单由服务端下发 */
  editable: EditableSection[]
  lastConfigReloadAt: string | null
  now: string
}

interface EditableField {
  key: string
  section: string
  field: string
  label: string
  hint: string
  type: 'text' | 'url' | 'number' | 'boolean'
  min?: number
  max?: number
  value: string | number | boolean
  lockedByEnv?: string
}

interface EditableSection {
  key: string
  title: string
  description: string
  fields: EditableField[]
}

/* ---------------- 状态 ---------------- */
const authed = ref(false)
const checking = ref(true)
const status = ref<AdminStatus | null>(null)
const loadError = ref('')

/** 登录表单 */
const form = reactive({ username: '', password: '' })
const showPassword = ref(false)
const loggingIn = ref(false)
const loginError = ref('')

/** 操作反馈 */
const busy = ref('')
const toast = reactive({ text: '', kind: 'ok' as 'ok' | 'err' })

function flash(text: string, kind: 'ok' | 'err' = 'ok') {
  toast.text = text
  toast.kind = kind
  // 3 秒后自动消失；用户连续操作时后一次会覆盖前一次
  setTimeout(() => {
    if (toast.text === text) toast.text = ''
  }, 3000)
}

/** 拉取面板数据；401 表示会话失效，退回登录页 */
async function loadStatus() {
  loadError.value = ''
  try {
    const data = await $fetch<AdminStatus>('/api/admin/status')
    status.value = data
    authed.value = true
  } catch (err: any) {
    const code = err?.statusCode ?? err?.response?.status
    if (code === 401) {
      authed.value = false
      status.value = null
    } else if (code === 404) {
      // 后台被 admin.enabled = false 关掉了
      authed.value = false
      loadError.value = '后台面板已关闭（licore-site.toml 里 admin.enabled = false），/api/admin 全部不可访问。'
    } else {
      loadError.value = err?.data?.message || err?.message || '加载失败'
    }
  } finally {
    checking.value = false
  }
}

async function login() {
  if (loggingIn.value) return
  loggingIn.value = true
  loginError.value = ''
  try {
    await $fetch('/api/admin/login', {
      method: 'POST',
      body: { username: form.username, password: form.password },
    })
    // 登录成功后立刻清掉内存里的密码，减少泄露面
    form.password = ''
    await loadStatus()
  } catch (err: any) {
    loginError.value = err?.data?.message || '登录失败，请重试'
  } finally {
    loggingIn.value = false
  }
}

async function logout() {
  await $fetch('/api/admin/logout', { method: 'POST' }).catch(() => {})
  authed.value = false
  status.value = null
  form.password = ''
}

/** 清空缓存：key 为空表示全部 */
async function clearCache(key?: string) {
  if (busy.value) return
  busy.value = key ?? '__all__'
  try {
    const res = await $fetch<{ clearedCount: number }>('/api/admin/cache/clear', {
      method: 'POST',
      body: key ? { key } : {},
    })
    flash(res.clearedCount > 0 ? `已清理 ${res.clearedCount} 项缓存` : '没有可清理的缓存项')
    await loadStatus()
  } catch (err: any) {
    flash(err?.data?.message || '清理失败', 'err')
  } finally {
    busy.value = ''
  }
}

/** 缓存键的中文说明，让面板不用猜 key 是什么意思 */
const CACHE_LABELS: Record<string, string> = {
  repo: '仓库元信息',
  releases: 'GitHub Release 列表',
  tags: '版本 tag 列表',
  contributors: '贡献者列表',
}

function cacheLabel(key: string): string {
  if (CACHE_LABELS[key]) return CACHE_LABELS[key]
  if (key.startsWith('commits:')) return `提交记录（${key.slice(8)} 条）`
  if (key.startsWith('file:')) return `仓库文件 ${key.slice(5)}`
  return key
}

/** 把秒数渲染成人话 */
function humanDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} 秒`
  if (seconds < 3600) return `${Math.round(seconds / 60)} 分钟`
  return `${(seconds / 3600).toFixed(1)} 小时`
}

/* ---------------- Token 设置 ---------------- */
const tokenInput = ref('')
const tokenBusy = ref(false)
const tokenFlash = reactive({ text: '', kind: 'ok' as 'ok' | 'err' })

async function saveToken() {
  if (tokenBusy.value || !tokenInput.value.trim()) return
  tokenBusy.value = true
  tokenFlash.text = ''
  try {
    const res = await $fetch<{ ok: boolean; message: string }>('/api/admin/token.set', {
      method: 'POST',
      body: { token: tokenInput.value.trim() },
    })
    tokenFlash.text = res.message
    tokenFlash.kind = 'ok'
    tokenInput.value = ''
    await loadStatus()
  } catch (err: any) {
    tokenFlash.text = err?.data?.message || '保存失败'
    tokenFlash.kind = 'err'
  } finally {
    tokenBusy.value = false
  }
}

async function clearToken() {
  if (tokenBusy.value) return
  tokenBusy.value = true
  tokenFlash.text = ''
  try {
    const res = await $fetch<{ ok: boolean; message: string }>('/api/admin/token.set', {
      method: 'POST',
      body: { token: '' },
    })
    tokenFlash.text = res.message
    tokenFlash.kind = 'ok'
    await loadStatus()
  } catch (err: any) {
    tokenFlash.text = err?.data?.message || '清除失败'
    tokenFlash.kind = 'err'
  } finally {
    tokenBusy.value = false
  }
}

/** token 来源的中文标签 */
const TOKEN_SOURCE_LABEL: Record<string, string> = {
  env: '环境变量',
  runtime: '面板写入',
  toml: 'TOML 配置',
  none: '未配置',
}

/* ---------------- 配置可视化编辑 ---------------- */

/**
 * 草稿值：`{ 'site.url': '...' }`。
 * 只放**被用户改动过**的字段 —— 提交时只发差异，避免把没碰过的字段
 * 也按面板的格式化结果写回文件（那会平白改动用户手写的格式）。
 */
const draft = ref<Record<string, string | number | boolean>>({})
const configBusy = ref(false)
const configFlash = reactive({ text: '', kind: 'ok' as 'ok' | 'err' })
const fieldErrors = ref<Record<string, string>>({})

/** 字段当前值：草稿优先，否则用服务端下发的生效值 */
function fieldValue(f: EditableField): string | number | boolean {
  return f.key in draft.value ? draft.value[f.key]! : f.value
}

/** 与生效值比较，判断是否真的改了 */
function isDirty(f: EditableField): boolean {
  if (!(f.key in draft.value)) return false
  const cur = draft.value[f.key]
  if (f.type === 'boolean') return Boolean(cur) !== Boolean(f.value)
  if (f.type === 'number') return Number(cur) !== Number(f.value)
  return String(cur) !== String(f.value)
}

const dirtyKeys = computed(() =>
  (status.value?.editable ?? []).flatMap((s) => s.fields).filter(isDirty).map((f) => f.key),
)

const hasDirty = computed(() => dirtyKeys.value.length > 0)

function setField(f: EditableField, value: string | number | boolean) {
  draft.value = { ...draft.value, [f.key]: value }
  // 用户重新输入时清掉该字段上一次的错误提示
  if (fieldErrors.value[f.key]) {
    const next = { ...fieldErrors.value }
    delete next[f.key]
    fieldErrors.value = next
  }
}

function resetDraft() {
  draft.value = {}
  fieldErrors.value = {}
  configFlash.text = ''
}

/** 保存草稿：只提交差异字段 */
async function saveConfig() {
  if (configBusy.value || !hasDirty.value) return
  configBusy.value = true
  configFlash.text = ''
  fieldErrors.value = {}

  const patch: Record<string, string | number | boolean> = {}
  for (const key of dirtyKeys.value) patch[key] = draft.value[key]!

  try {
    const res = await $fetch<{ ok: boolean; message: string; sections: EditableSection[] }>(
      '/api/admin/config.set',
      { method: 'POST', body: { patch } },
    )
    draft.value = {}
    await loadStatus()
    // 展示类字段（display.*）已改变，让页面上的站点配置缓存失效，
    // 下次进入前台页面会重新取，不会残留旧开关。
    await clearNuxtData('site-runtime-config')
    configFlash.text = res.message
    configFlash.kind = 'ok'
  } catch (err: any) {
    const errs = err?.data?.data?.fieldErrors
    if (errs && typeof errs === 'object') fieldErrors.value = errs
    configFlash.text = err?.data?.message || '保存失败'
    configFlash.kind = 'err'
  } finally {
    configBusy.value = false
  }
}

/** 缓存项剩余新鲜时间 */
function remaining(entry: CacheEntry): string {
  const left = entry.ttlSeconds - entry.ageSeconds
  return left > 0 ? `剩余 ${humanDuration(left)}` : '已过期，下次访问将重新拉取'
}

const freshCount = computed(
  () => status.value?.cache.entries.filter((e) => e.fresh).length ?? 0,
)

/* ---------------- 首屏：先探一次会话 ---------------- */
onMounted(loadStatus)
</script>

<template>
  <div class="mx-auto w-full max-w-5xl px-4 py-12 sm:px-6 lg:px-8">
    <!-- ============ 会话探测中 ============ -->
    <div v-if="checking" class="flex items-center justify-center gap-2 py-24 text-muted-foreground">
      <Loader2 class="size-5 animate-spin" aria-hidden="true" />
      正在检查登录状态…
    </div>

    <!-- ============ 后台已关闭 ============ -->
    <Card v-else-if="loadError && !authed" class="mx-auto max-w-lg p-6">
      <div class="flex items-start gap-3">
        <XCircle class="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden="true" />
        <div>
          <h1 class="text-lg font-semibold">后台面板不可用</h1>
          <p class="mt-2 text-sm leading-6 text-muted-foreground">{{ loadError }}</p>
        </div>
      </div>
    </Card>

    <!-- ============ 登录表单 ============ -->
    <Card v-else-if="!authed" class="mx-auto max-w-md p-6 sm:p-8">
      <div class="flex items-center gap-3">
        <div class="flex size-10 items-center justify-center rounded-lg bg-primary/10">
          <KeyRound class="size-5 text-primary" aria-hidden="true" />
        </div>
        <div>
          <h1 class="text-lg font-semibold tracking-tight">后台管理</h1>
          <p class="text-xs text-muted-foreground">LiCore 官网 · 运维面板</p>
        </div>
      </div>

      <form class="mt-6 space-y-4" @submit.prevent="login">
        <div>
          <label for="admin-username" class="mb-1.5 block text-sm font-medium">用户名</label>
          <Input
            id="admin-username"
            v-model="form.username"
            placeholder="admin"
            autocomplete="username"
            :disabled="loggingIn"
          />
        </div>

        <div>
          <label for="admin-password" class="mb-1.5 block text-sm font-medium">密码</label>
          <div class="relative">
            <Input
              id="admin-password"
              v-model="form.password"
              :type="showPassword ? 'text' : 'password'"
              placeholder="••••••"
              autocomplete="current-password"
              :disabled="loggingIn"
            />
            <button
              type="button"
              class="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
              :aria-label="showPassword ? '隐藏密码' : '显示密码'"
              @click="showPassword = !showPassword"
            >
              <component :is="showPassword ? EyeOff : Eye" class="size-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        <p
          v-if="loginError"
          class="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          <AlertTriangle class="size-4 shrink-0" aria-hidden="true" />
          {{ loginError }}
        </p>

        <Button type="submit" class="w-full" :loading="loggingIn" :disabled="loggingIn">
          登录
        </Button>
      </form>

      <p class="mt-6 border-t border-border pt-4 text-xs leading-5 text-muted-foreground">
        账号密码配置在服务器上的
        <code class="rounded bg-muted px-1 py-0.5">licore-site.toml</code>
        的 <code class="rounded bg-muted px-1 py-0.5">[admin]</code> 段，
        修改后需重启服务才会生效。
      </p>
    </Card>

    <!-- ============ 面板主体 ============ -->
    <div v-else-if="status" class="space-y-6">
      <!-- 顶栏 -->
      <header class="flex flex-wrap items-center justify-between gap-4">
        <div class="flex items-center gap-3">
          <div class="flex size-10 items-center justify-center rounded-lg bg-primary/10">
            <Settings2 class="size-5 text-primary" aria-hidden="true" />
          </div>
          <div>
            <h1 class="text-xl font-bold tracking-tight">后台管理</h1>
            <p class="text-xs text-muted-foreground">
              以 <code class="rounded bg-muted px-1 py-0.5">{{ status.config.admin.username }}</code> 登录
            </p>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <Button variant="outline" size="sm" :icon="RefreshCw" @click="loadStatus">刷新</Button>
          <Button variant="ghost" size="sm" :icon="LogOut" @click="logout">退出</Button>
        </div>
      </header>

      <!-- 操作反馈 -->
      <p
        v-if="toast.text"
        class="flex items-center gap-2 rounded-md px-3 py-2 text-sm"
        :class="toast.kind === 'ok' ? 'bg-primary/10 text-primary' : 'bg-destructive/10 text-destructive'"
        role="status"
      >
        <component :is="toast.kind === 'ok' ? CheckCircle2 : AlertTriangle" class="size-4 shrink-0" aria-hidden="true" />
        {{ toast.text }}
      </p>

      <!-- 默认密码警告 -->
      <p
        v-if="status.config.admin.usingDefaultPassword"
        class="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-600 dark:text-amber-400"
        role="alert"
      >
        <AlertTriangle class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>
          当前仍在使用默认密码 <code class="rounded bg-black/10 px-1 py-0.5 dark:bg-white/10">admin</code>。
          公网部署请立即修改 <code class="rounded bg-black/10 px-1 py-0.5 dark:bg-white/10">licore-site.toml</code>
          里的 <code class="rounded bg-black/10 px-1 py-0.5 dark:bg-white/10">admin.password</code> 并重启服务。
        </span>
      </p>

      <!-- 配置告警 -->
      <div
        v-if="status.config.warnings.length"
        class="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2.5"
      >
        <p class="flex items-center gap-2 text-sm font-medium text-amber-600 dark:text-amber-400">
          <AlertTriangle class="size-4" aria-hidden="true" />
          配置加载告警（{{ status.config.warnings.length }} 条）
        </p>
        <ul class="mt-2 space-y-1 text-xs leading-5 text-amber-600/90 dark:text-amber-400/90">
          <li v-for="w in status.config.warnings" :key="w">· {{ w }}</li>
        </ul>
      </div>

      <!-- ---------------- 上游状态 ---------------- -->
      <Card class="p-6">
        <h2 class="flex items-center gap-2 text-base font-semibold">
          <Server class="size-4 text-primary" aria-hidden="true" />
          上游状态
        </h2>
        <dl class="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt class="text-xs text-muted-foreground">GitHub 可达性</dt>
            <dd class="mt-1 flex items-center gap-2 text-sm font-medium">
              <span
                class="size-2 shrink-0 rounded-full"
                :class="status.upstream.reachable ? 'bg-emerald-500' : 'bg-destructive'"
                aria-hidden="true"
              />
              {{ status.upstream.reachable ? '正常' : '不可达' }}
            </dd>
          </div>
          <div>
            <dt class="text-xs text-muted-foreground">仓库</dt>
            <dd class="mt-1 font-mono text-sm">{{ status.upstream.repo }}</dd>
          </div>
          <div>
            <dt class="text-xs text-muted-foreground">最近推送</dt>
            <dd class="mt-1 text-sm">{{ status.upstream.pushedAt ? formatDate(status.upstream.pushedAt) : '—' }}</dd>
          </div>
          <div>
            <dt class="text-xs text-muted-foreground">响应耗时</dt>
            <dd class="mt-1 text-sm">{{ status.upstream.latencyMs }} ms</dd>
          </div>
        </dl>
        <p
          v-if="status.upstream.error"
          class="mt-4 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          {{ status.upstream.error }}
        </p>

        <!-- Token 设置区 -->
        <div class="mt-4 rounded-lg border border-border p-4">
          <h3 class="flex items-center gap-2 text-sm font-semibold">
            <KeyRound class="size-4 text-primary" aria-hidden="true" />
            GitHub Token
            <Badge
              :variant="status.config.github.tokenSource === 'none' ? 'secondary' : 'primary'"
              size="sm"
            >
              {{ TOKEN_SOURCE_LABEL[status.config.github.tokenSource] ?? status.config.github.tokenSource }}
            </Badge>
          </h3>

          <p class="mt-2 text-xs leading-5 text-muted-foreground">
            优先级：环境变量 &gt; 面板写入（运行时文件）&gt; TOML 配置。
            面板写入立即生效，无需重启；重启后仍保留（文件不随进程消失）。
            <br />
            未配置时走匿名配额（60 次/小时/IP），高频访问容易耗尽。
          </p>

          <div class="mt-3 flex items-center gap-2">
            <Input
              v-model="tokenInput"
              :type="tokenInput ? 'text' : 'password'"
              placeholder="ghp_xxxx…"
              :disabled="tokenBusy"
              class="flex-1"
            />
            <Button
              variant="primary"
              size="sm"
              :icon="CheckCircle2"
              :loading="tokenBusy && tokenInput.trim().length > 0"
              :disabled="!tokenInput.trim()"
              @click="saveToken"
            >
              保存
            </Button>
            <Button
              v-if="status.config.github.tokenSource === 'runtime'"
              variant="ghost"
              size="sm"
              :icon="Trash2"
              :loading="tokenBusy && tokenInput.trim().length === 0"
              @click="clearToken"
            >
              清除
            </Button>
          </div>

          <p
            v-if="tokenFlash.text"
            class="mt-2 flex items-center gap-1.5 text-xs"
            :class="tokenFlash.kind === 'ok' ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'"
          >
            <component :is="tokenFlash.kind === 'ok' ? CheckCircle2 : AlertTriangle" class="size-3.5" />
            {{ tokenFlash.text }}
          </p>
        </div>
      </Card>

      <!-- ---------------- 缓存管理 ---------------- -->
      <Card class="p-6">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 class="flex items-center gap-2 text-base font-semibold">
              <Database class="size-4 text-primary" aria-hidden="true" />
              缓存管理
            </h2>
            <p class="mt-1 text-xs text-muted-foreground">
              {{ status.cache.entries.length }} 项，其中 {{ freshCount }} 项新鲜
              <template v-if="status.cache.inflight.length">
                · {{ status.cache.inflight.length }} 个请求进行中
              </template>
            </p>
          </div>
          <Button
            v-if="status.config.admin.allowCacheClear"
            variant="outline"
            size="sm"
            :icon="Trash2"
            :loading="busy === '__all__'"
            :disabled="!status.cache.entries.length"
            @click="clearCache()"
          >
            清空全部
          </Button>
        </div>

        <div v-if="status.cache.entries.length" class="mt-4 overflow-hidden rounded-lg border border-border">
          <table class="w-full text-sm">
            <thead class="bg-muted/50">
              <tr>
                <th scope="col" class="px-4 py-2.5 text-left font-medium">缓存项</th>
                <th scope="col" class="px-4 py-2.5 text-left font-medium">状态</th>
                <th scope="col" class="px-4 py-2.5 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="e in status.cache.entries" :key="e.key" class="border-t border-border">
                <td class="px-4 py-2.5">
                  <div class="font-medium">{{ cacheLabel(e.key) }}</div>
                  <code class="text-xs text-muted-foreground">{{ e.key }}</code>
                </td>
                <td class="px-4 py-2.5">
                  <Chip :variant="e.fresh ? 'primary' : 'secondary'" size="sm">
                    {{ e.fresh ? '新鲜' : '已过期' }}
                  </Chip>
                  <div class="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock class="size-3" aria-hidden="true" />
                    {{ e.ageSeconds }}s / {{ e.ttlSeconds }}s · {{ remaining(e) }}
                  </div>
                </td>
                <td class="px-4 py-2.5 text-right">
                  <Button
                    v-if="status.config.admin.allowCacheClear"
                    variant="ghost"
                    size="sm"
                    :loading="busy === e.key"
                    @click="clearCache(e.key)"
                  >
                    清理
                  </Button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <p v-else class="mt-4 rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          缓存为空 —— 还没有页面访问触发过上游拉取。
        </p>

        <p
          v-if="!status.config.admin.allowCacheClear"
          class="mt-4 text-xs text-muted-foreground"
        >
          配置中 <code class="rounded bg-muted px-1 py-0.5">admin.allowCacheClear = false</code>，
          面板为只读模式。
        </p>
      </Card>

      <!-- ---------------- 生效配置 ---------------- -->
      <Card class="p-6">
        <h2 class="flex items-center gap-2 text-base font-semibold">
          <Activity class="size-4 text-primary" aria-hidden="true" />
          生效配置
        </h2>
        <p class="mt-1 text-xs text-muted-foreground">
          配置文件：
          <code class="rounded bg-muted px-1 py-0.5">{{ status.config.path || '未找到，正在使用内置默认值' }}</code>
          · 修改后需重启服务生效
        </p>

        <dl class="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          <div class="flex items-center justify-between gap-4 border-b border-border/60 py-1.5">
            <dt class="text-muted-foreground">站点地址</dt>
            <dd class="truncate font-mono text-xs" :title="status.config.site.url">{{ status.config.site.url }}</dd>
          </div>
          <div class="flex items-center justify-between gap-4 border-b border-border/60 py-1.5">
            <dt class="text-muted-foreground">站点名称</dt>
            <dd>{{ status.config.site.name }}</dd>
          </div>
          <div class="flex items-center justify-between gap-4 border-b border-border/60 py-1.5">
            <dt class="text-muted-foreground">会话有效期</dt>
            <dd>{{ status.config.admin.sessionHours }} 小时</dd>
          </div>
          <div class="flex items-center justify-between gap-4 border-b border-border/60 py-1.5">
            <dt class="text-muted-foreground">GitHub Token</dt>
            <dd>
              <Badge :variant="status.config.github.tokenConfigured ? 'primary' : 'secondary'">
                {{ status.config.github.tokenConfigured ? '已配置' : '未配置' }}
              </Badge>
            </dd>
          </div>
          <div class="flex items-center justify-between gap-4 border-b border-border/60 py-1.5">
            <dt class="text-muted-foreground">发行数据缓存</dt>
            <dd>{{ humanDuration(status.config.github.releasesTtlSeconds) }}</dd>
          </div>
          <div class="flex items-center justify-between gap-4 border-b border-border/60 py-1.5">
            <dt class="text-muted-foreground">仓库信息缓存</dt>
            <dd>{{ humanDuration(status.config.github.repoTtlSeconds) }}</dd>
          </div>
          <div class="flex items-center justify-between gap-4 border-b border-border/60 py-1.5">
            <dt class="text-muted-foreground">首页活动流</dt>
            <dd>{{ status.config.display.showActivity ? '开启' : '关闭' }}</dd>
          </div>
          <div class="flex items-center justify-between gap-4 border-b border-border/60 py-1.5">
            <dt class="text-muted-foreground">更新日志条目上限</dt>
            <dd>{{ status.config.display.changelogMaxItems || '不限制' }}</dd>
          </div>
        </dl>
      </Card>

      <!-- ---------------- 配置可视化编辑 ---------------- -->
      <Card v-if="status.config.admin.allowConfigEdit" class="p-6">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 class="flex items-center gap-2 text-base font-semibold">
              <SlidersHorizontal class="size-4 text-primary" aria-hidden="true" />
              配置编辑
            </h2>
            <p class="mt-1 text-xs leading-5 text-muted-foreground">
              保存后<strong class="font-medium text-foreground">立即生效</strong>，无需重启服务。
              改动会写回
              <code class="rounded bg-muted px-1 py-0.5">{{ status.config.path || 'licore-site.toml' }}</code>
              并自动备份为 <code class="rounded bg-muted px-1 py-0.5">.bak</code>，原有注释保持不变。
            </p>
          </div>
          <div class="flex items-center gap-2">
            <Button
              v-if="hasDirty"
              variant="ghost"
              size="sm"
              :icon="RotateCcw"
              :disabled="configBusy"
              @click="resetDraft"
            >
              放弃修改
            </Button>
            <Button
              variant="primary"
              size="sm"
              :icon="Save"
              :loading="configBusy"
              :disabled="!hasDirty || configBusy"
              @click="saveConfig"
            >
              保存{{ hasDirty ? ` (${dirtyKeys.length})` : '' }}
            </Button>
          </div>
        </div>

        <p
          v-if="configFlash.text"
          class="mt-4 flex items-center gap-2 rounded-md px-3 py-2 text-sm"
          :class="configFlash.kind === 'ok' ? 'bg-primary/10 text-primary' : 'bg-destructive/10 text-destructive'"
          role="status"
        >
          <component :is="configFlash.kind === 'ok' ? CheckCircle2 : AlertTriangle" class="size-4 shrink-0" aria-hidden="true" />
          {{ configFlash.text }}
        </p>

        <div v-for="sec in status.editable" :key="sec.key" class="mt-6">
          <div class="border-b border-border pb-2">
            <h3 class="text-sm font-semibold">{{ sec.title }}</h3>
            <p v-if="sec.description" class="mt-0.5 text-xs text-muted-foreground">{{ sec.description }}</p>
          </div>

          <div class="mt-4 grid gap-5 sm:grid-cols-2">
            <div v-for="f in sec.fields" :key="f.key" :class="f.type === 'text' && f.field === 'icp' ? 'sm:col-span-2' : ''">
              <label :for="`cfg-${f.key}`" class="mb-1.5 flex items-center gap-2 text-sm font-medium">
                {{ f.label }}
                <span
                  v-if="isDirty(f)"
                  class="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary"
                >
                  已修改
                </span>
              </label>

              <!-- 被环境变量覆盖：只读并说明原因，避免"改了没效果"的困惑 -->
              <div v-if="f.lockedByEnv" class="space-y-1.5">
                <Input :id="`cfg-${f.key}`" :model-value="String(fieldValue(f))" disabled />
                <p class="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                  <AlertTriangle class="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                  已被环境变量 <code class="rounded bg-black/10 px-1 dark:bg-white/10">{{ f.lockedByEnv }}</code>
                  覆盖，面板改不动；请改环境变量后重启服务。
                </p>
              </div>

              <!-- 布尔 / 数字 / 文本三选一 -->
              <div v-if="!f.lockedByEnv">
                <button
                  v-if="f.type === 'boolean'"
                  :id="`cfg-${f.key}`"
                  type="button"
                  role="switch"
                  :aria-checked="Boolean(fieldValue(f))"
                  class="flex w-full items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm transition-colors hover:bg-accent/50"
                  :disabled="configBusy"
                  @click="setField(f, !fieldValue(f))"
                >
                  <span class="flex items-center gap-2">
                    <span
                      class="size-2 rounded-full"
                      :class="fieldValue(f) ? 'bg-emerald-500' : 'bg-muted-foreground/40'"
                      aria-hidden="true"
                    />
                    {{ fieldValue(f) ? '已开启' : '已关闭' }}
                  </span>
                  <span
                    class="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors"
                    :class="fieldValue(f) ? 'bg-primary' : 'bg-muted'"
                  >
                    <span
                      class="inline-block size-4 rounded-full bg-background shadow transition-transform"
                      :class="fieldValue(f) ? 'translate-x-4' : 'translate-x-0.5'"
                    />
                  </span>
                </button>

                <Input
                  v-else-if="f.type === 'number'"
                  :id="`cfg-${f.key}`"
                  type="number"
                  :model-value="String(fieldValue(f))"
                  :min="f.min"
                  :max="f.max"
                  :disabled="configBusy"
                  @update:model-value="(v: any) => setField(f, v === '' ? 0 : Number(v))"
                />

                <Input
                  v-else
                  :id="`cfg-${f.key}`"
                  :model-value="String(fieldValue(f))"
                  :disabled="configBusy"
                  :placeholder="f.type === 'url' ? 'https://example.com' : ''"
                  @update:model-value="(v: any) => setField(f, v)"
                />

                <p v-if="fieldErrors[f.key]" class="mt-1.5 flex items-start gap-1.5 text-xs text-destructive">
                  <AlertTriangle class="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                  {{ fieldErrors[f.key] }}
                </p>
                <p v-else class="mt-1.5 text-xs leading-5 text-muted-foreground">{{ f.hint }}</p>
              </div>
            </div>
          </div>
        </div>
        <p class="mt-6 border-t border-border pt-4 text-xs leading-5 text-muted-foreground">
          出于安全考虑，
          <code class="rounded bg-muted px-1 py-0.5">admin.password</code> /
          <code class="rounded bg-muted px-1 py-0.5">admin.username</code> 与
          <code class="rounded bg-muted px-1 py-0.5">github.token</code>
          不在此处编辑：token 请用上方专用入口；密码请直接改服务器上的配置文件后重启，
          避免后台会话被窃取即等同于拿到密码。
        </p>
      </Card>

      <Card v-else class="p-6">
        <h2 class="flex items-center gap-2 text-base font-semibold">
          <SlidersHorizontal class="size-4 text-muted-foreground" aria-hidden="true" />
          配置编辑已禁用
        </h2>
        <p class="mt-2 text-xs leading-5 text-muted-foreground">
          配置中 <code class="rounded bg-muted px-1 py-0.5">admin.allowConfigEdit = false</code>，
          面板不提供可视化编辑。如需启用，请改服务器上的配置文件并重启服务。
        </p>
      </Card>

      <div v-if="status" class="space-y-1">
        <p class="text-center text-xs text-muted-foreground">
          数据抓取于 {{ formatDate(status.now) }} · 版本号与下载链接由站点运行时自动聚合，无需人工维护
        </p>
        <p v-if="status.lastConfigReloadAt" class="text-center text-xs text-muted-foreground">
          配置最近一次热重载：{{ formatDate(status.lastConfigReloadAt) }}
        </p>
      </div>
    </div>
  </div>
</template>

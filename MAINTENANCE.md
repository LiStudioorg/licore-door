# MAINTENANCE.md — AI 维护工作流

> **本文件是写给 AI 代理看的操作手册，不是给人类读的概述。**
> 当你（AI 代理）收到"同步上游内容到官网""更新官网的 LiCore 文档"这类指令时，
> 按本文件的流程执行。人类用户只需说一句话，剩下按这里做。

---

## 0. 你的任务是什么

LiCore 官网（本仓库）的**文档类内容**是手写的，会随上游 [LiStudioorg/licore](https://github.com/LiStudioorg/licore)
的演进变旧。你的工作是把上游的 **README 特性、命令、提交摘要**拉下来，
更新到官网对应位置，并如实报告改了什么。

**你不需要处理版本号和下载链接** —— 那部分由站点运行时自动从 GitHub 拉取
（见 `server/utils/changelog.ts`），永远是最新的，不要动它。

### 明确边界

| 你应该做 | 你不应该做 |
| --- | --- |
| 同步 README 的**特性列表**到首页 | 改动 `server/utils/changelog.ts` 的版本聚合逻辑 |
| 同步 README 的**命令**到文档页命令表 | 手写版本号、手写下载链接 |
| 同步**近期提交摘要**到更新日志页（作为补充说明） | 修改 `app/config/site.ts` 的域名 |
| 更新与上游明显矛盾的描述性文案 | 大改页面结构与样式 |
| 如实报告无法确认的内容 | 编造上游没有的功能或命令 |

---

## 1. 数据源

所有内容来自公开仓库 `LiStudioorg/licore`。按优先级使用下列方式获取。

### 方式 A：GitHub API（推荐，结构化）

```bash
# 若本机已配置 GITHUB_TOKEN，带上它可把配额从 60/小时 提到 5000/小时
TOKEN="${GITHUB_TOKEN:-$(sed -E 's#https://[^:]+:([^@]+)@github.com#\1#' ~/.git-credentials 2>/dev/null | head -1)}"

# 1) README（核心来源）
curl -sS -H "Authorization: Bearer $TOKEN" -H "User-Agent: dsh" \
  https://api.github.com/repos/LiStudioorg/licore/contents/README.md \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
      console.log(Buffer.from(JSON.parse(s).content,'base64').toString('utf8'))})"

# 2) 近期提交（默认取 30 条）
curl -sS -H "Authorization: Bearer $TOKEN" -H "User-Agent: dsh" \
  "https://api.github.com/repos/LiStudioorg/licore/commits?per_page=30" \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
      JSON.parse(s).forEach(c=>console.log(c.sha.slice(0,7),'|',c.commit.author.date,'|',c.commit.message.split('\n')[0]))})"

# 3) 版本 tag（只用于确认当前大版本，不要写进页面）
curl -sS -H "Authorization: Bearer $TOKEN" -H "User-Agent: dsh" \
  "https://api.github.com/repos/LiStudioorg/licore/tags?per_page=10" \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
      JSON.parse(s).forEach(t=>console.log(t.name))})"
```

### 方式 B：raw 直链（无需配额）

配额耗尽时用这个，只能拿文件内容，拿不到提交记录：

```bash
curl -sSL https://raw.githubusercontent.com/LiStudioorg/licore/main/README.md
curl -sSL https://raw.githubusercontent.com/LiStudioorg/licore/main/AGENTS.md
```

### 方式 C：站点自己的接口

如果官网正在运行，可以直接问它（它内部有缓存与回退逻辑）：

```bash
curl -sS http://127.0.0.1:3000/api/status    # 先确认上游可达
curl -sS http://127.0.0.1:3000/api/commits?limit=30
```

> ⚠️ **配额检查**：开始前先看一眼，避免中途断掉。
>
> ```bash
> curl -sS -H "Authorization: Bearer $TOKEN" https://api.github.com/rate_limit \
>   | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
>       const r=JSON.parse(s).resources.core;console.log('配额:',r.remaining,'/',r.limit)})"
> ```
>
> **注意**：这个接口必须带 `Authorization` 头。不带 token 时它永远显示匿名的
> `60/60`，**不能反映你实际用 token 的配额**，会出现"明明还有额度却查不到"的困惑。
>
> 配额为 0 时不要反复重试（会一直失败），改用方式 B（raw 直链），并在报告里说明。

---

## 2. 上游内容长什么样（解析规则）

### 2.1 特性列表 → 首页特性卡

上游 README 的 `## 特性` 章节格式固定：

```markdown
## 特性

- 🪶 **极轻**：运行时内存目标 10–20 MiB，单个静态二进制；……
- 🧩 **自研镜像格式**：`.licore` = 分层 gzip tar + 自研 `index.json`，……
```

解析规则：`- [emoji] **标题**：说明`。**标题**映射到官网卡片的 `title`，
冒号后的说明映射到 `desc`。

### 2.2 命令行 → 文档页命令表

上游 README 的代码块里，带行尾注释的命令：

````markdown
```bash
licore build -t demo:v1 .        # 根据 Boxfile 构建 .licore 并自动导入
licore ps                        # 查看运行中的容器
```
````

解析规则：只取以 `licore ` 开头的行，命令名取**前两个词**（如 `licore build`），
行尾 `#` 后的文字就是说明。

### 2.3 提交信息 → 更新日志补充

上游提交遵循 Conventional Commits：`feat(cli): report the runtime platform in --version`。
官网的更新日志页**已经自动聚合**这些提交（按 `feat`/`fix`/`docs` 等分组），
所以你**不需要**把提交抄进页面。

你只在一种情况下动它：某些改动在 README 里没有体现，但明显影响使用者认知
（例如新增了一个重要命令）。这时把它补进第 3 节的对应位置，而不是新建章节。

---

## 3. 要更新的位置（精确到文件与变量）

### 3.1 首页特性卡 — `app/pages/index.vue`

**位置**：`const features = [` （约第 122 行）

```ts
const features = [
  {
    icon: Feather,                    // 从 lucide-vue-next 选一个语义接近的图标
    title: '极轻运行时',
    desc: '常驻内存目标 10–20 MiB，单个静态二进制。除可选的 internal/execns 外全部为纯 Go 实现。',
  },
  // …共 8 项
]
```

**操作**：
- 逐条对照上游 README 的 `## 特性`，**文案与事实不一致**的才改
- 上游有、官网没有的特性 → 追加，并从 `lucide-vue-next` 引入合适的 `icon`
- 官网有、上游已删除的特性 → 删掉，同时删掉不再使用的图标 import
- **保持 4 的倍数**（当前 8 项）：桌面端 4 列布局，凑成 4/8/12 项才不留空位

### 3.2 文档页命令表 — `app/pages/docs.vue`

**位置**：`v-for="c in ["`（约第 244 行）

```vue
<tr v-for="c in [
  { cmd: 'licore build', desc: '按 Boxfile 构建 .licore 镜像并自动导入本地' },
  { cmd: 'licore run', desc: '创建并启动容器，支持端口映射、卷与资源限制' },
  // …
]" :key="c.cmd" class="border-t border-border">
```

**操作**：
- 对照上游 README，补齐缺失的子命令、删除已废弃的
- `cmd` 用**反引号内的命令名**（页面会渲染成 `<code>`），格式为 `licore 子命令`
- 同一子命令的多个动作（如 `licore network ls / create / inspect / rm`）合并为一行
- 改完检查：命令表里每个命令，在上游 README 或 `licore --help` 里都能找到

### 3.3 关于页项目定位 — `app/pages/about.vue`

**位置**：`## 项目定位` 章节（约第 129 行起，`const designGoals` 在第 35 行）

**操作**：只在**事实性描述**与上游矛盾时修改（例如平台支持范围、内存目标、
许可证）。叙述性文字（"设计取舍"里的三个理由）保持稳定，
除非上游 `AGENTS.md` 或 README 的核心约定发生实质变化。

### 3.4 站点元信息 — `app/config/site.ts`

**位置**：`tagline` 与 `description`

**操作**：仅当上游的定位表述发生实质变化时同步。
`description` 会被用于 **SEO meta description**，修改时注意：
- 保留核心关键词（LiCore、轻量级容器引擎、Go、10–20 MiB、.licore、不兼容 OCI）
- 长度控制在 **150–160 字**，超了搜索引擎会截断
- 改完必须重新验证 SEO 输出（见第 5 节）

### 3.5 完整文档页的章节内容 — `app/pages/docs.vue`

各 `<section id="...">` 里的说明文字（Boxfile 指令集、镜像格式、网络、卷、
Hub、Compose、资源限制、开机自启）。

**操作**：对照上游 README 对应章节与 `docs/image-spec.md` 核对
**命令语法、参数名、默认值**。只改与上游不一致的技术细节。

---

## 4. 执行流程

严格按顺序做，每步都要有实际依据。

### 第 1 步：确认上游现状

```bash
# 配额（必须带 Authorization，否则只看得到匿名额度）
curl -sS -H "Authorization: Bearer $TOKEN" https://api.github.com/rate_limit \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
      const r=JSON.parse(s).resources.core;console.log('配额:',r.remaining,'/',r.limit)})"

# 仓库是否可达 + 最近推送时间（判断上游是否真有更新）
curl -sS -H "Authorization: Bearer $TOKEN" -H "User-Agent: dsh" \
  https://api.github.com/repos/LiStudioorg/licore \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
      const r=JSON.parse(s);console.log('pushed_at:',r.pushed_at,'| stars:',r.stargazers_count)})"
```

### 第 2 步：拉取并解析

用第 1 节的方式拿到 README 全文与提交列表。**先把 README 通读一遍**，
再动手改 —— 不要逐条对着改，容易漏掉整体变化。

### 第 3 步：逐项比对

用第 2 节的解析规则，把上游内容与第 3 节的官网内容**逐条对照**，列出差异清单：

```
差异清单（示例）
[首页特性] 上游第 6 条"资源限制"官网已有，措辞一致 → 不改
[首页特性] 上游新增"XXX" → 需追加，图标用 YYY
[命令表]   上游新增 `licore stats` → 官网已有
[命令表]   上游移除 `licore xxx` → 官网需删除
```

### 第 4 步：改代码

只改第 3 节列出的位置。**不要顺手重构**无关代码。

### 第 5 步：验证（必做，不可跳过）

```bash
cd <项目根目录>

# 1) 类型检查必须 0 错误
npm run typecheck 2>&1 | grep -E "error TS" && echo "有类型错误，必须修复"

# 2) 生产构建必须成功
npm run build

# 3) 启动产物做冒烟测试
#    本机 3000/3001 都可能被其他服务占用，先探一个空闲端口：
#      ss -ltn | grep :3111   （无输出即表示可用）
#    CI 里用的是 3001（runner 是干净环境，肯定空闲）
PORT=3111 HOST=127.0.0.1 node .output/server/index.mjs &
sleep 6
for p in / /changelog /download /docs /about; do
  printf "%-11s " "$p"
  curl -s -o /dev/null -w "HTTP %{http_code}\n" "http://127.0.0.1:3111$p"
done
# 全部应为 200
```

**注意**：这个 `node ... &` + `kill %1` 的写法只在**交互式 shell** 里可靠。
在脚本里 `%1` 可能指向别的任务，且 `kill` 与 `rm` 写在同一行时，
PID 文件可能先被删掉导致杀不掉进程。稳妥做法是**按端口反查 PID**：

```bash
pid=$(ss -ltnp | grep ':3111 ' | grep -oE 'pid=[0-9]+' | head -1 | cut -d= -f2)
[ -n "$pid" ] && kill "$pid"
```

**如果改动了后台或配置相关代码**（`server/utils/config.ts`、`server/utils/auth.ts`、
`server/api/admin/`、`app/pages/admin.vue`、`licore-site.toml`），额外验证：

```bash
B=http://127.0.0.1:3111
# 未登录必须被拒
curl -s -o /dev/null -w "未登录 status: %{http_code}（应 401）\n" "$B/api/admin/status"

# 错误密码必须被拒
curl -s -o /dev/null -w "错误密码: %{http_code}（应 401）\n" \
  -X POST "$B/api/admin/login" -H 'content-type: application/json' \
  -d '{"username":"admin","password":"wrong"}'

# 正确登录 → 拿到会话
curl -s -c /tmp/ck.txt -o /dev/null -w "登录: %{http_code}（应 200）\n" \
  -X POST "$B/api/admin/login" -H 'content-type: application/json' \
  -d '{"username":"admin","password":"admin"}'

# 带会话访问状态
curl -s -b /tmp/ck.txt -o /dev/null -w "已登录 status: %{http_code}（应 200）\n" "$B/api/admin/status"

# 面板页本身
curl -s -o /dev/null -w "/admin: %{http_code}（应 200）\n" "$B/admin"
rm -f /tmp/ck.txt
```

**注意**：改动 SEO 相关字段（3.4 节）时，额外确认输出：

```bash
curl -s http://127.0.0.1:3111/ | grep -oE '<title>[^<]*</title>|<meta name="description" content="[^"]{0,80}'
```

`<title>` 里不应出现重复的 "LiCore | LiCore"；description 不应被截断成半句话。

### 第 6 步：提交

```bash
git add -A
git commit -m "content: 同步上游 README（<具体改了什么>）"
git push origin main
```

提交信息里**必须写清楚具体改动**，不要只写"同步更新"。

---

## 5. 硬性约束

违反其中任何一条都会导致官网出问题。

1. **绝不手写版本号或下载链接**。版本数据由 `server/utils/changelog.ts`
   运行时自动聚合，手写会与之冲突。

   **上游状态（2026-10 核查）**：仓库有 10 个 tag（v0.1.0 ~ v0.7.0），
   但 **Release 数量为 0**；不过上游已新增 `.github/workflows/release.yml`，
   说明官方正在补自动化发布流程。

   站点已为此设计成**三级自动适配**，会随上游状态自动切换，你无需干预：

   | 上游状态 | 站点行为 |
   | --- | --- |
   | 有 Release + 二进制资产 | 展示官方二进制下载 |
   | 有 Release 但无资产 | 用 Release 正文作更新日志 |
   | **完全没有 Release（当前）** | 以 tag 为版本轴，用相邻 tag 间的提交自动合成日志 |

   所以：**如果哪天你发现下载页开始出现二进制链接了，那是上游发了 Release，
   站点自动切换的结果，不是 bug，也不需要你改代码。**
2. **绝不在源码里硬编码 GitHub Token**。需要时用环境变量 `GITHUB_TOKEN`。
   仓库是公开的，提交密钥等于泄露。
3. **改完必须跑第 5 步的验证**。只改文案也要跑 —— 模板里的全角引号、
   `</script>`、未转义的 `<` 都可能让页面直接 500。
4. **不要动 SEO 骨架**：`useSeoMeta` / `useHead` 里的 canonical、OG、
   JSON-LD 结构，以及 `nuxt.config.ts` 的 `site.url`。改 description
   文案可以，改结构不可以。
5. **保持中文**。站点是单语言中文站，不要引入英文段落。
6. **不确定就不要写**。上游 README 没提的功能、你无法验证的参数，
   宁可不写也不要推测。在报告里说明"无法确认"。

---

## 6. 已知的坑

| 坑 | 说明 |
| --- | --- |
| **全角引号** | 模板属性里不能出现 `"` `"`，会截断字符串导致编译失败。文案里要表达引号时用「」或去掉。 |
| **端口 3000/3001 都被占用** | 这台机器上 3000 与 3001 都有别的服务在监听。测试前先 `ss -ltn \| grep :3111` 确认空闲，用 3111 之类的高位端口。 |
| **`pkill -f nuxt` 会杀掉自己** | 该模式会匹配到执行它的 shell 本身。用 `kill %1 2>/dev/null   # 或按 PID kill：pgrep -f "server/index.mjs"` 按端口清理。 |
| **GitHub 配额** | 匿名 60 次/小时，很容易耗尽。配额为 0 时页面仍返回 200（降级渲染），但 `/api/status` 会报 503。改文案不需要访问 GitHub，不受影响。 |
| **`.licore` 不是 OCI** | 任何"兼容 Docker/OCI"的表述都是错的，不要写进官网。 |
| **Android 无 Root 不支持** | 这是官方明确立场，描述 Android 支持时不能含糊。 |
| **历史 tag v0.1.0~v0.6.1 是 Boxli** | 项目 v0.7.0 从 Boxli 更名。描述历史时注意区分，不要把 v0.6.x 说成 LiCore。 |
| **上游 release.yml 已就位** | 上游已有 `release.yml` 但尚未产生 Release。若下载页突然出现二进制链接，属站点自动切换，不要改代码去"修"它。 |
| **`/admin` 也是 200** | 后台面板页本身返回 200（登录表单靠客户端渲染），所以冒烟测试里 `/admin` 也应该是 200。**未登录时 `/api/admin/*` 返回 401 是正确的**，不要把它当故障。 |
| **本站配置是 TOML，上游是 YAML** | 别把两者搞混：`licore-site.toml` 是**官网自己**的配置；LiCore 引擎用 `~/.licore/config.yaml`，上游 `AGENTS.md` 明确规定"不要混用 TOML/JSON 配置文件"。写官网文案时不要声称 LiCore 用 TOML。 |
| **`echo "$HTML" \| grep -q` 在 pipefail 下会假阴性** | `grep -q` 匹配到立刻退出，`echo` 继续写已关闭的管道触发 SIGPIPE，pipeline 整体非 0，断言被误判失败（`<title>` 在页首最容易踩中，CI 实际红过一次）。冒烟脚本里判定大段 HTML 一律**先落盘再 `grep -q needle file`**，别走管道。 |

---

## 7. 完成后的报告格式

向用户汇报时，按这个结构，**只写你实际做了的事**：

```markdown
## 同步结果

上游状态：pushed_at=<日期>，stars=<N>，配额 remaining=<N>

### 改了什么
- `app/pages/index.vue` 第 N 条特性：<旧> → <新>（依据：README `## 特性` 第 N 条）
- `app/pages/docs.vue` 命令表：新增 `<命令>`，删除 `<命令>`

### 没改什么（及原因）
- 特性列表其余 6 条与上游一致，无需改动
- 更新日志页由运行时自动聚合，未手动干预

### 验证
- `npm run typecheck`：0 错误
- `npm run build`：成功
- 冒烟测试：5 条路由全部 200

### 无法确认
- <如有：上游没写清楚、或配额不足没能拉到的内容>
```

**如果拉取失败或配额耗尽，直接说明，不要用"已完成同步"糊弄过去。**

---

## 8. 相关文件索引

| 文件 | 作用 | 你会改吗 |
| --- | --- | --- |
| `app/pages/index.vue` | 首页（特性卡、统计） | ✅ 特性卡 |
| `app/pages/docs.vue` | 文档页（命令表、各章节） | ✅ 命令表与技术细节 |
| `app/pages/about.vue` | 关于页（定位、更名历史） | ⚠️ 仅事实性描述 |
| `app/pages/changelog.vue` | 更新日志 | ❌ 自动聚合 |
| `app/pages/download.vue` | 下载页 | ❌ 自动适配 |
| `app/pages/admin.vue` | 后台管理面板 | ❌ 与上游内容无关 |
| `app/config/site.ts` | 站点元信息（域名、SEO 描述） | ⚠️ 仅 description/tagline |
| `licore-site.toml` | 站点配置文件（TOML） | ❌ 与上游内容无关 |
| `server/utils/config.ts` | TOML 配置加载与校验 | ❌ 不要动 |
| `server/utils/auth.ts` | 后台认证（会话 cookie） | ❌ 不要动 |
| `server/api/admin/` | 后台接口 | ❌ 不要动 |
| `server/utils/changelog.ts` | 版本与下载聚合 | ❌ 不要动 |
| `server/utils/github.ts` | GitHub 数据层（缓存/TTL） | ❌ 不要动 |
| `README.md` | 项目说明（给人看） | ⚠️ 功能变化时同步 |
| `DEPLOY.md` | 部署指南 | ❌ 除非部署方式变了 |
| `.github/workflows/ci.yml` | CI（类型检查+构建+冒烟） | ❌ 不要动 |
| `.github/workflows/release.yml` | 自动发行（打 tag + 发 Release） | ❌ 不要动 |

> **注意**：`server/utils/github.ts` 里的 TTL 现在读的是 `licore-site.toml` 的
> `[github]` 段（`releases` / `repo` / `contributors`，单位秒），
> 不再是硬编码的 `minutes(5)`。改缓存时长请改配置文件，不要改代码。

---

## 10. 后台面板与配置文件（非内容维护，但别改坏）

站点有一个后台面板 `/admin`，账号密码在 `licore-site.toml` 的 `[admin]` 段
（默认 `admin` / `admin`）。相关文件：

| 文件 | 作用 |
| --- | --- |
| `licore-site.toml` | 站点配置：站点地址、后台账号、GitHub token、缓存 TTL、显示开关 |
| `server/utils/config.ts` | 加载并校验 TOML；任何错误都回退默认值，**绝不让站点挂掉** |
| `server/utils/auth.ts` | HMAC 签名会话 cookie；未登录一律 401 |
| `server/api/admin/*` | 登录 / 登出 / 状态 / 清缓存 |

**做内容同步时你不需要碰这些**。只有一条要注意：

- 如果你改动了 `app/config/site.ts` 的 `description`（第 3.4 节），
  记得 `licore-site.toml` 里的 `site.url` 与 `app/config/site.ts` 的 `site.url`
  是**两个地方**（前者优先级更高，因为它在运行时覆盖后者）。
  换域名时**两边都要改**，否则 sitemap 与 canonical 会不一致。

配置文件是**容错**的：字段类型写错只会让该字段回退默认值，其余字段照常生效，
并打印告警（后台面板顶部也会汇总显示）。所以你不必担心手滑改坏站点，
但改完仍要跑第 5 节的验证。

---

## 9. 快速开始（复制即用）

```bash
# 0. 进入项目
cd <项目根目录>

# 1. 拿上游 README
TOKEN="${GITHUB_TOKEN:-$(sed -E 's#https://[^:]+:([^@]+)@github.com#\1#' ~/.git-credentials 2>/dev/null | head -1)}"
curl -sS -H "Authorization: Bearer $TOKEN" -H "User-Agent: dsh" \
  https://api.github.com/repos/LiStudioorg/licore/contents/README.md \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
      const md=Buffer.from(JSON.parse(s).content,'base64').toString('utf8');
      const i=md.indexOf('## 特性');
      console.log(i>=0?md.slice(i, i+1500):md.slice(0,1500))})"

# 2. 看最近提交
curl -sS -H "Authorization: Bearer $TOKEN" -H "User-Agent: dsh" \
  "https://api.github.com/repos/LiStudioorg/licore/commits?per_page=20" \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
      JSON.parse(s).forEach(c=>console.log(c.sha.slice(0,7),'|',c.commit.message.split('\n')[0]))})"

# 3. 对照第 3 节改代码，然后验证
npm run typecheck && npm run build

# 4. 冒烟测试
PORT=3111 HOST=127.0.0.1 node .output/server/index.mjs &
sleep 6
for p in / /changelog /download /docs /about; do
  curl -s -o /dev/null -w "$p → %{http_code}\n" "http://127.0.0.1:3111$p"
done
kill %1 2>/dev/null   # 或按 PID kill：pgrep -f "server/index.mjs"
```

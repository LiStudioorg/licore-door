# 部署 v1.0.20（修复 HTTPS canonical 漂移）

本文件是**一次性操作单**：把已修好的产物部署到线上，让 canonical / og:url /
sitemap / robots 从 `http://` 变成 `https://`。

> 修复代码已全部合入 `main`（`2c476f1`），CI 通过，Release **v1.0.20** 已产出。
> 产物本身已实测确认干净（`http://` 站点域名 **0** 处，`"siteUrl": "https://…"`）。
> **只差部署这一步** —— 本机没有生产服务器的 SSH 私钥（实测
> `Permission denied (publickey,password)`），所以必须由你在服务器上执行。

---

## 为什么必须部署，光改配置不够

站点域名在**五处**定义，但它们的**作用范围不同** —— 这决定了「光改配置能不能修好」：

| 位置 | 生效方式 | 影响 canonical / og / sitemap？ |
| --- | --- | --- |
| `app/config/site.ts` 的 `site.url` | **构建期**烘焙进产物 | ✅ **是**（canonical 的实际来源） |
| `public/robots.txt` | **构建期**拷进产物（静态文件） | ✅ 是（Sitemap 行） |
| `.github/workflows/*.yml` 的兜底值 | **构建期**覆盖上面的 `site.ts` | ✅ 是（上一轮漏的就是这里） |
| `licore-site.toml` 的 `[site].url` | 运行时 | ❌ **否**（只喂 `/api/site-config`） |
| 环境变量 `NUXT_PUBLIC_SITE_URL`（服务器） | **构建期**（若部署时存在） | ✅ 是 |

**结论**：`canonical` 取自 `app/config/site.ts`（见 `app/app.vue`
`computed(() => \`${site.url}${route.path}\`)`），**是构建期值**。
所以**必须部署 v1.0.20 这个新产物才可能修好** —— 只改服务器上的 `licore-site.toml`
或面板配置**不会**改变 canonical。

`licore-site.toml` 的 `[site].url` 只影响 `/api/site-config` 下发给前端的
展示用地址，与 canonical 无关（但它也该是 https，否则数据自相矛盾）。

---

## 步骤 1：部署前确认服务器环境变量（可选但建议）

`NUXT_PUBLIC_SITE_URL` 在**构建期**被 `nuxt.config.ts` 读取
（`process.env.NUXT_PUBLIC_SITE_URL || site.url`），用来生成 sitemap 与
`runtimeConfig`。

> ✅ **好消息**：canonical 与 sitemap 的**实际输出**取自产物里烘焙好的
> `app/config/site.ts` 值，而 v1.0.20 里它已经是 `https://`。
> 服务器上有没有这个环境变量**不影响 v1.0.20 的效果**。
>
> ⚠️ 但**不要在服务器上把 `NUXT_PUBLIC_SITE_URL` 设成 `http://`** ——
> 若将来重新部署时带了它，或在服务器上重新构建，它会覆盖正确值。
> 顺手确认一下，避免留雷。

```bash
grep -n "NUXT_PUBLIC_SITE_URL" /opt/licore-website/ecosystem.config.cjs 2>/dev/null
grep -n "NUXT_PUBLIC_SITE_URL" /opt/licore-website/current/.env 2>/dev/null
```

- 输出 `http://...` → **删掉这一行或改成 `https://licore.z321.cc.cd`**
- 无输出，或已是 `https://` → 无需操作

---

## 步骤 1b：顺手把运行时 TOML 也改成 https（不影响 canonical，但应一致）

`/opt/licore-website/licore-site.toml` 的 `[site].url` 会被 `/api/site-config`
下发给前端，属于展示用地址。它与 canonical 无关，但留着 `http://` 会让
数据自相矛盾。

> ⚠️ `deploy-pm2.sh` 发现该文件已存在时**会原样保留**（首次部署才生成），
> 所以部署新包**不会**自动修掉它 —— 需要你手工改或走面板。

**方式 A（推荐，无需重启）**：登录 `/admin` → 「配置编辑」→ 把「站点规范地址」
改成 `https://licore.z321.cc.cd` → 保存（写回 TOML 并热重载）。

**方式 B（手工改 + 重载）**：

```bash
sudo sed -i 's|^url = "http://licore.z321.cc.cd"|url = "https://licore.z321.cc.cd"|' \
  /opt/licore-website/licore-site.toml
grep -n '^url' /opt/licore-website/licore-site.toml   # 确认已变 https
pm2 reload licore-website --update-env                # systemd 用 systemctl restart
```

---

## 步骤 2：部署 v1.0.20

```bash
# 服务器上一条命令（脚本会自动下载 + 原子切链 + PM2 重载 + 健康检查 + 失败回滚）
bash ~/.licore-deploy/deploy-latest.sh
```

若脚本不在默认位置（参考 DEPLOY.md §3.1，脚本可能落在 `~/`）：

```bash
ls -la ~/deploy-latest.sh ~/.licore-deploy/deploy-latest.sh 2>/dev/null
```

也可以显式指定版本，避免受"最新版"判断影响：

```bash
bash ~/.licore-deploy/deploy-latest.sh --tag v1.0.20
```

**发布脚本会保留 `/opt/licore-website/licore-site.toml` 不覆盖**，所以你在面板上
改过的站点名称/备案号不会丢。

---

## 步骤 3：验证（四类输出必须全是 https）

```bash
B=https://licore.z321.cc.cd

echo "--- canonical ---"
curl -s $B/ | grep -oE 'rel="canonical" href="[^"]*"'

echo "--- og:url / og:image ---"
curl -s $B/ | grep -oE 'property="og:(url|image)"[^>]*'

echo "--- sitemap ---"
curl -s $B/sitemap.xml | grep -oE '<loc>[^<]*</loc>' | head -3

echo "--- robots ---"
curl -s $B/robots.txt | grep -i "^Sitemap:"
```

**期望**：四类输出全部是 `https://licore.z321.cc.cd`。
**任何一处出现 `http://` 都说明还有一处没改全。**

补充检查（可选）：

```bash
# lastmod 应是真实的上游推送时间，而不是"现在"
curl -s $B/sitemap.xml | grep -oE '<lastmod>[^<]*</lastmod>' | head -1
date -u +"now=%Y-%m-%dT%H:%M:%SZ"

# 各页 description 应 ≤ 80 个汉字
for p in / /changelog /download /docs /about; do
  n=$(curl -s "$B$p" | grep -o 'name="description" content="[^"]*"' | head -1 | awk -F'"' '{print length($4)}')
  echo "$p → $n 字"
done
```

---

## 步骤 4：如果 `robots.txt` 仍是 http

`robots.txt` 是**静态文件**，属于产物的一部分。若部署后它仍是 `http://`，
说明跑的还是旧版本（或 CDN 缓存了旧文件）：

```bash
# 确认当前跑的是哪个版本
readlink /opt/licore-website/current
# 确认产物里的 robots.txt
grep -i "^Sitemap:" /opt/licore-website/current/.output/public/robots.txt
```

若产物里已是 https 但线上不是 → **CDN 缓存**，去 CDN 控制台刷新
`/robots.txt` 与 `/sitemap.xml`（`robots.txt` 的缓存时间通常较长）。

---

## 回滚

v1.0.20 有问题时：

```bash
bash ~/.licore-deploy/deploy-latest.sh --rollback
```

> 注意：回滚会**退回 http 的 canonical**，所以只在 v1.0.20 真出问题时才回滚。

---

## 部署后的下一步（SEO）

1. **Google Search Console** 提交 `https://licore.z321.cc.cd/sitemap.xml`
2. **Bing Webmaster Tools** 也提交一次（已有验证文件 `BingSiteAuth.xml`）
3. 在 GSC 里对首页用「网址检查」触发一次重新抓取，加速 canonical 更新

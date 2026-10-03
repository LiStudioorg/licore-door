/**
 * PM2 进程配置 —— LiCore 官网
 *
 * 用法（在服务器上，项目根目录）：
 *   pm2 start deploy/ecosystem.config.cjs
 *   pm2 save
 *   pm2 startup            # 按提示执行输出的那条 sudo 命令，实现开机自启
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么 script 用相对路径、并单独指定 cwd ？
 *
 * 这是本文件最关键的一点，不要改成绝对路径。
 *
 * 部署结构是：
 *   /opt/licore-website/
 *   ├── releases/v1/.output/server/index.mjs
 *   ├── releases/v2/.output/server/index.mjs
 *   └── current -> releases/v2          ← 部署时原子切换这个软链
 *
 * PM2 会把 cwd + script 拼成 "current/.output/server/index.mjs" 这样的
 * **软链路径**记录在案（实测验证过）。所以切换 current 之后执行
 * `pm2 reload licore-website`，进程会从新的版本目录启动。
 *
 * 如果这里写死绝对路径（如 /opt/licore-website/releases/v1/...），
 * 那么无论 current 怎么切，PM2 永远只跑 v1 —— 部署看起来成功，
 * 实际访问到的还是旧代码。这个坑很难发现，务必用相对路径。
 * ─────────────────────────────────────────────────────────────
 *
 * 环境变量来自 current/.env（部署脚本生成的版本级配置），
 * 所以这里**不要**写死 GITHUB_TOKEN 等到仓库里的东西。
 */
module.exports = {
  apps: [
    {
      name: 'licore-website',

      // 相对 cwd 的路径；配合下面的 cwd 一起解析到 current 软链
      script: '.output/server/index.mjs',
      cwd: '/opt/licore-website/current',

      // SSR 站点是单进程应用，不要用 cluster 模式。
      // Nuxt/Nitro 在 cluster 下需要额外的进程间处理，收益不抵复杂度。
      instances: 1,
      exec_mode: 'fork',

      // 内存超限自动重启。SSR 站点正常占用约 150–300MB，
      // 512M 阈值能在内存泄漏时自愈，又不会误杀正常负载。
      max_memory_restart: '512M',

      // 崩溃自动重启，但避免疯狂重启刷爆日志
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 3000,

      // 优雅退出。Nitro 收到 SIGINT 会停止接收新请求并处理完在途请求。
      kill_timeout: 15000,
      wait_ready: false,
      listen_timeout: 10000,

      // 日志
      output: '/opt/licore-website/logs/out.log',
      error: '/opt/licore-website/logs/error.log',
      merge_logs: true,
      time: true,

      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        // 只监听本机，外部流量一律走 Nginx 反代
        HOST: '127.0.0.1',
      },

      // 注意：NUXT_PUBLIC_SITE_URL 与 GITHUB_TOKEN 由 current/.env 提供。
      // PM2 的 env 优先级高于 .env，如果在这里也写一份，会覆盖掉
      // 部署脚本写入的值，导致换域名/换 token 后不生效。
    },
  ],
}

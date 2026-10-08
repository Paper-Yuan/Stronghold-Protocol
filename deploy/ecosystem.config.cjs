// deploy/ecosystem.config.cjs — PM2 守护进程配置
//
// 2+2G 内存策略（docs/OPTIMIZATION_AND_PR_PLAN.md §2.1.2-1，2026-10 修订）：
//   * --max-old-space-size=1300：V8 老生代堆上限。2GB 机器上为 OS / cloudflared / nginx 预留约 400MB，
//     堆外开销（Buffer、外部字符串、WS 帧）再留约 300MB。
//     注意：原先计划的 1750 在 2GB 机器上必然 OOM（且高于 PM2 重启线会形成重启循环），不作采用。
//   * max_memory_restart=1600M：PM2 看的是进程 RSS；重启线比堆上限高 300MB，保证 GC 有机会先跑，
//     避免堆还没到 1300 就被 PM2 杀掉的抖动循环。
module.exports = {
  apps: [
    {
      name: 'stronghold-blue',
      script: 'server/index.js',
      cwd: '/opt/stronghold-blue',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '1600M',
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
        ADMIN_SECRET: process.env.ADMIN_SECRET || 'stronghold-admin-2026',
        NODE_OPTIONS: '--max-old-space-size=1300',
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: '/var/log/stronghold/blue-err.log',
      out_file: '/var/log/stronghold/blue-out.log',
      merge_logs: true,
    },
    {
      name: 'stronghold-green',
      script: 'server/index.js',
      cwd: '/opt/stronghold-green',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '1600M',
      env: {
        NODE_ENV: 'production',
        PORT: 3002,
        ADMIN_SECRET: process.env.ADMIN_SECRET || 'stronghold-admin-2026',
        NODE_OPTIONS: '--max-old-space-size=1300',
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: '/var/log/stronghold/green-err.log',
      out_file: '/var/log/stronghold/green-out.log',
      merge_logs: true,
    },
  ],
};

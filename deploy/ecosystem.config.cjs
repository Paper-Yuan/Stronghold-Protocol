// deploy/ecosystem.config.cjs — PM2 守护进程配置
module.exports = {
  apps: [
    {
      name: 'stronghold-blue',
      script: 'server/index.js',
      cwd: '/opt/stronghold-blue',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '1500M',
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
        ADMIN_SECRET: process.env.ADMIN_SECRET || 'stronghold-admin-2026',
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
      max_memory_restart: '1500M',
      env: {
        NODE_ENV: 'production',
        PORT: 3002,
        ADMIN_SECRET: process.env.ADMIN_SECRET || 'stronghold-admin-2026',
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: '/var/log/stronghold/green-err.log',
      out_file: '/var/log/stronghold/green-out.log',
      merge_logs: true,
    },
  ],
};

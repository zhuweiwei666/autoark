module.exports = {
  apps: [
    {
      name: 'autoark',
      script: './dist/server.js',
      cwd: '/root/autoark/autoark-backend',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
      },
      error_file: '/root/.pm2/logs/autoark-error.log',
      out_file: '/root/.pm2/logs/autoark-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
    },
  ],
}


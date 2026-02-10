module.exports = {
  apps: [{
    name: 'autoark-agent',
    script: './dist/server.js',
    cwd: '/root/autoark/autoark-agent',
    instances: 1,
    exec_mode: 'fork',
    env: { NODE_ENV: 'production' },
    autorestart: true,
    max_restarts: 10,
    min_uptime: '10s',
  }],
}

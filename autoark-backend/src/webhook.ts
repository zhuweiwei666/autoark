import express from 'express'
import { exec } from 'child_process'

const app = express()

// GitHub webhook POST 接口
app.post('/webhook', (req, res) => {
  exec('bash /root/auto-deploy.sh', (err, stdout, stderr) => {
    if (err) {
      console.error('🚨 Deploy error:', err)
      return res.status(500).send('Deploy failed')
    }
    console.log('🚀 Deploy OK:', stdout)
    res.send('Deploy triggered')
  })
})

// 监听 webhook 服务端口（不要和主服务冲突）
app.listen(3001, () => {
  console.log('Webhook server running on port 3001')
})


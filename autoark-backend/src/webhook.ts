import express, { Request, Response } from 'express'
import crypto from 'crypto'
import { exec } from 'child_process'

const app = express()
const PORT = 3001
const WEBHOOK_SECRET = 'zww199976'

// Use raw body buffer for signature verification
app.use(
  express.json({
    verify: (req: any, res, buf) => {
      req.rawBody = buf
    },
  }),
)

app.post('/webhook', (req: Request, res: Response) => {
  const signature = req.headers['x-hub-signature-256'] as string
  const body = (req as any).rawBody

  if (!signature || !body) {
    console.error('Missing signature or body')
    return res.status(403).json({ error: 'Missing signature or body' })
  }

  const hmac = crypto.createHmac('sha256', WEBHOOK_SECRET)
  const digest = 'sha256=' + hmac.update(body).digest('hex')

  if (signature !== digest) {
    console.error('Invalid signature')
    return res.status(403).json({ error: 'Invalid signature' })
  }

  console.log('✅ Webhook signature verified. Triggering deployment...')

  exec('bash /root/auto-deploy.sh', (error, stdout, stderr) => {
    if (error) {
      console.error(`🚨 Exec error: ${error.message}`)
      return res.status(500).json({ success: false, error: error.message })
    }
    if (stderr) {
      console.error(`⚠️ Stderr: ${stderr}`)
    }
    console.log(`🚀 Stdout: ${stdout}`)
    res.json({ success: true, msg: 'Deploy triggered', output: stdout })
  })
})

app.listen(PORT, () => {
  console.log(`Webhook server listening on port ${PORT}`)
})

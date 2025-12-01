import app from './app'
import './cron' // Importing for side-effects if needed, though initCronJobs is explicit below
import initCronJobs from './cron'
import logger from './utils/logger'

const PORT = process.env.PORT || 3001

// Handle Uncaught Exceptions
process.on('uncaughtException', (err) => {
  logger.error('UNCAUGHT EXCEPTION! 💥 Shutting down...', err)
  process.exit(1)
})

// Handle Unhandled Rejections
process.on('unhandledRejection', (err: any) => {
  logger.error('UNHANDLED REJECTION! 💥 Shutting down...', err)
  // Ideally we should close the server gracefully, but process.exit is acceptable here
  process.exit(1)
})

// Initialize Cron Jobs
initCronJobs()

app.listen(PORT, () => console.log(`AutoArk backend running on port ${PORT}`))

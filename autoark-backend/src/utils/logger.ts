const logger = {
  info: (message: string) => console.log(`[INFO] ${message}`),
  warn: (message: string) => console.warn(`[WARN] ${message}`),
  error: (message: string, error?: any) => {
    console.error(`[ERROR] ${message}`)
    if (error) {
      if (error instanceof Error) {
        console.error(error.stack)
      } else {
        console.error(error)
      }
    }
  },
  timerLog: (label: string, startTime: number) => {
    const duration = Date.now() - startTime
    console.log(`[TIMER] ${label} - ${duration}ms`)
  },
}

export default logger

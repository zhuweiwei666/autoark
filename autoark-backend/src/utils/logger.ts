const logger = {
  info: (message: string) => console.log(`[INFO] ${message}`),
  error: (message: string, error?: any) => {
    console.error(`[ERROR] ${message}`);
    if (error) {
      if (error instanceof Error) {
        console.error(error.stack);
      } else {
        console.error(error);
      }
    }
  },
};

export default logger;

import app from "./app";
import initCronJobs from "./cron";

const PORT = process.env.PORT || 3001;

// Initialize Cron Jobs
initCronJobs();

app.listen(PORT, () => console.log(`AutoArk backend running on port ${PORT}`));

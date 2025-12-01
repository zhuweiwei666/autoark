import cron from "node-cron";
import { SCHEDULES } from "./schedule";
import fetchFacebookDaily from "./fetchFacebookDaily";
import { runRulesDaily } from "../rules";
import { runAiOptimizerDaily } from "../ai";
import logger from "../utils/logger";

const initCronJobs = () => {
  // Facebook Data Sync (Hourly)
  cron.schedule(SCHEDULES.FETCH_FB_HOURLY, () => {
    fetchFacebookDaily().catch(err => logger.error("Unhandled error in Facebook fetch cron", err));
  });

  // Rule Engine (Daily at 1 AM)
  cron.schedule(SCHEDULES.RUN_RULES_DAILY, () => {
    runRulesDaily().catch(err => logger.error("Unhandled error in Rule Engine cron", err));
  });

  // AI Optimizer (Daily at 3 AM)
  cron.schedule(SCHEDULES.RUN_AI_DAILY, () => {
    runAiOptimizerDaily().catch(err => logger.error("Unhandled error in AI Optimizer cron", err));
  });

  logger.info("Cron jobs initialized");
};

export default initCronJobs;

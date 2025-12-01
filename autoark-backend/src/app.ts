import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import connectDB from './config/db';
import facebookRoutes from './routes/facebook.routes';
import dashboardRoutes from './routes/dashboard.routes';
import logger from './utils/logger';

dotenv.config();

// Handle Uncaught Exceptions
process.on('uncaughtException', (err) => {
  logger.error('UNCAUGHT EXCEPTION! 💥 Shutting down...', err);
  process.exit(1);
});

// Connect to Database
connectDB();

const app = express();

app.use(cors());
app.use(express.json());

// Routes
app.use('/facebook', facebookRoutes);
app.use('/dashboard', dashboardRoutes);

app.get('/', (req, res) => {
  res.send('AutoArk Backend API is running');
});

// Global Error Handling Middleware
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  logger.error('Global Error Handler', err);

  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  res.status(statusCode).json({
    status: 'error',
    statusCode,
    message,
    stack: process.env.NODE_ENV === 'production' ? undefined : err.stack,
  });
});

// Handle Unhandled Rejections
process.on('unhandledRejection', (err: any) => {
  logger.error('UNHANDLED REJECTION! 💥 Shutting down...', err);
  // Ideally we should close the server gracefully, but process.exit is acceptable here
  process.exit(1);
});

export default app;

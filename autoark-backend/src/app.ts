import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import connectDB from './config/db';
import facebookRoutes from './routes/facebook.routes';

dotenv.config();

// Connect to Database
connectDB();

const app = express();

app.use(cors());
app.use(express.json());

// Routes
app.use('/facebook', facebookRoutes);

app.get('/', (req, res) => {
  res.send('AutoArk Backend API is running');
});

export default app;


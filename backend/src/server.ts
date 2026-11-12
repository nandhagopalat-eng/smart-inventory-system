/**
 * Smart Inventory System - Backend Server
 *
 * Express application with MongoDB, CORS, JSON parsing, route
 * registration, health checking, and centralized error handling.
 */
import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import mongoose from 'mongoose';
import cors from 'cors';

import authRoutes from './routes/authRoutes';
import userRoutes from './routes/userRoutes';
import inventoryRoutes from './routes/inventoryRoutes';
import stockMovementRoutes from './routes/stockMovementRoutes';
import salesRoutes from './routes/salesRoutes';
import alertsRoutes from './routes/alertsRoutes';
import predictionRoutes from './routes/predictionRoutes';

const app = express();

// --- Middleware (must run before routes) ---

app.use(express.json());

const allowedOrigins = (
  process.env.CORS_ORIGIN || 'http://localhost:5173,http://localhost:5174'
)
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(cors({
  origin: allowedOrigins,
  credentials: true,
}));

// --- Routes ---

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/stock-movements', stockMovementRoutes);
app.use('/api/sales', salesRoutes);
app.use('/api/alerts', alertsRoutes);
app.use('/api/predictions', predictionRoutes);

// --- Health Check ---

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    message: 'Smart Inventory System API is running',
    timestamp: new Date().toISOString(),
  });
});

// --- Database Connection ---

const connectDB = async (): Promise<void> => {
  const mongoUri =
    process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/smart_inventory';

  try {
    await mongoose.connect(mongoUri);
    console.log('MongoDB connected successfully');
  } catch (error) {
    console.error('MongoDB connection error:', error);
    process.exit(1);
  }
};

mongoose.connection.on('disconnected', () => {
  console.warn('MongoDB disconnected');
});

mongoose.connection.on('open', () => {
  console.log('MongoDB connection opened');
});

mongoose.connection.on('error', (err) => {
  console.error('MongoDB connection error:', err);
});

// --- 404 Handler ---

app.use((_req: Request, res: Response) => {
  res.status(404).json({
    status: 'error',
    message: 'Endpoint not found',
  });
});

// --- Global Error Handler ---

interface HttpError extends Error {
  statusCode?: number;
}

const errorHandler = (
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void => {
  const error = err instanceof Error ? err : new Error('Unknown error');
  const statusCode = (error as HttpError).statusCode ?? 500;

  console.error('Error handler caught:', error.message);

  res.status(statusCode).json({
    status: 'error',
    message: statusCode === 500 ? 'Internal Server Error' : error.message,
    ...(process.env.NODE_ENV !== 'production' && { stack: error.stack }),
  });
};

app.use(errorHandler);

// --- Server Initialization ---

const startServer = async (): Promise<void> => {
  await connectDB();

  const port = Number(process.env.PORT) || 5000;

  app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
    console.log(`Health check: http://localhost:${port}/api/health`);
  });
};

if (require.main === module) {
  void startServer();
}

export { app };
export default app;

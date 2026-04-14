import express from 'express';
import cors from 'cors';

import authRoutes from './routes/auth.routes.js';
import logRoutes from './routes/log.routes.js';

const app = express();

app.use(cors());
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/logs', logRoutes);

export default app;

import cors from 'cors';
import express from 'express';
import dotenv from 'dotenv';
import onebankRoutes from './routes/onebank.routes.js';
import cognigyRoutes from './routes/cognigy.routes.js';
import authRoutes from './routes/auth.routes.js';

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/cognigy', cognigyRoutes);
app.use('/api/onebank', onebankRoutes);

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'cognigy-demo-backend'
  });
});

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});
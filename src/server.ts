import cors from 'cors';
import express from 'express';
import dotenv from 'dotenv';
import onebankRoutes from './routes/onebank.routes.js';

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'cognigy-demo-backend'
  });
});

app.use('/api/onebank', onebankRoutes);

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});
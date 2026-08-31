import cors from 'cors';
import express from 'express';
import dotenv from 'dotenv';
import onebankRoutes from './routes/onebank.routes.js';
import cognigyRoutes from './routes/cognigy.routes.js';
import authRoutes from './routes/auth.routes.js';
import demosRoutes from './routes/demos.routes.js';
import adminDemosRoutes from './routes/admin-demos.routes.js';
import auditRoutes from './routes/audit.routes.js';
import adminUsersRoutes from './routes/admin-users.routes.js';

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/cognigy', cognigyRoutes);
app.use('/api/onebank', onebankRoutes);
app.use('/api/demos', demosRoutes);
app.use('/api/admin/demos', adminDemosRoutes);
app.use('/api/admin/users', adminUsersRoutes);
app.use('/api/audit', auditRoutes);


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
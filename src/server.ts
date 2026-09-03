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

/*
 * Render normalmente fica atrás de proxy.
 * Isso permite que req.ip represente corretamente
 * o IP encaminhado pelo proxy.
 */
app.set('trust proxy', 1);

app.use(cors());

/*
 * O sistema não precisa aceitar payloads JSON grandes.
 * Isso reduz superfície para abuso e consumo desnecessário
 * de memória.
 */
app.use(
  express.json({
    limit: '10kb',
  }),
);

app.use('/api/auth', authRoutes);
app.use('/api/cognigy', cognigyRoutes);
app.use('/api/onebank', onebankRoutes);
app.use('/api/demos', demosRoutes);
app.use('/api/admin/demos', adminDemosRoutes);
app.use('/api/admin/users', adminUsersRoutes);
app.use('/api/audit', auditRoutes);

app.get('/api/health', (_req, res) => {
  return res.json({
    status: 'ok',
    service: 'cognigy-demo-backend',
  });
});

const PORT =
  process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(
    `Backend running on port ${PORT}`,
  );
});
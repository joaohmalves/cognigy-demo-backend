import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/requirePermission.js';
import { supabaseAdmin } from '../db/supabase.js';

const router = Router();
router.use(requireAuth, requirePermission('MANAGE_USERS'));

router.get('/', async (_req, res) => {
  const { data, error } = await supabaseAdmin
    .from('audit_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) return res.status(500).json({ error: 'Erro ao buscar logs' });
  res.json(data);
});

export default router;
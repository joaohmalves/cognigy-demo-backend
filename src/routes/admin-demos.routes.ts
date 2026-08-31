import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/requirePermission.js';
import { supabaseAdmin } from '../db/supabase.js';
import { logAction } from '../audit/log.js';

const router = Router();

router.use(
  requireAuth,
  requirePermission('MANAGE_DEMOS')
);

// ============================================================
// GET /api/admin/demos
// ============================================================

router.get('/', async (_req, res) => {
  const { data, error } = await supabaseAdmin
    .from('demos')
    .select('id, payload, active, created_at, updated_at')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[admin/demos] erro ao buscar demos', error);

    return res.status(500).json({
      error: 'Erro ao buscar demos',
    });
  }

  res.json(data);
});

// ============================================================
// POST /api/admin/demos
// ============================================================

router.post('/', async (req, res) => {
  const { id, payload } = req.body ?? {};

  if (!id || !payload) {
    return res.status(400).json({
      error: 'id e payload são obrigatórios',
    });
  }

  const { data, error } = await supabaseAdmin
    .from('demos')
    .insert({
      id,
      payload,
    })
    .select('id, payload, active, created_at, updated_at')
    .single();

  if (error) {
    console.error('[admin/demos] erro ao criar demo', error);

    return res.status(500).json({
      error: 'Erro ao criar demo',
    });
  }

  await logAction(
    req.authUserId!,
    'CREATE_DEMO',
    'demo',
    id,
    { payload }
  );

  res.status(201).json(data);
});

// ============================================================
// PUT /api/admin/demos/:id
// ============================================================

router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { payload, active } = req.body ?? {};

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (payload !== undefined) {
    updates.payload = payload;
  }

  if (active !== undefined) {
    updates.active = active;
  }

  const { data, error } = await supabaseAdmin
    .from('demos')
    .update(updates)
    .eq('id', id)
    .select('id, payload, active, created_at, updated_at')
    .single();

  if (error) {
    console.error('[admin/demos] erro ao atualizar demo', error);

    return res.status(500).json({
      error: 'Erro ao atualizar demo',
    });
  }

  await logAction(
    req.authUserId!,
    'UPDATE_DEMO',
    'demo',
    id,
    {
      payload,
      active,
    }
  );

  res.json(data);
});

// ============================================================
// DELETE /api/admin/demos/:id
// ============================================================
// Soft delete

router.delete('/:id', async (req, res) => {
  const { id } = req.params;

  const { error } = await supabaseAdmin
    .from('demos')
    .update({
      active: false,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (error) {
    console.error('[admin/demos] erro ao desativar demo', error);

    return res.status(500).json({
      error: 'Erro ao desativar demo',
    });
  }

  await logAction(
    req.authUserId!,
    'DEACTIVATE_DEMO',
    'demo',
    id
  );

  res.json({
    deactivated: true,
  });
});

export default router;
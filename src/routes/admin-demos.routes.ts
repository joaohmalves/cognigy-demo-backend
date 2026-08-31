import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/requirePermission.js';
import { supabaseAdmin } from '../db/supabase.js';
import { logAction } from '../audit/log.js';

const router = Router();
router.use(requireAuth, requirePermission('MANAGE_DEMOS'));

// Lista todas as demos, ativas ou não (painel admin vê tudo).
router.get('/', async (_req, res) => {
  const { data, error } = await supabaseAdmin.from('demos').select('id, payload, active, updated_at');
  if (error) return res.status(500).json({ error: 'Erro ao buscar demos' });
  res.json(data);
});

// Cria uma demo nova.
router.post('/', async (req, res) => {
  const { id, payload, roleIds } = req.body ?? {};
  if (!id || !payload) return res.status(400).json({ error: 'id e payload são obrigatórios' });

  const { error } = await supabaseAdmin.from('demos').insert({ id, payload });
  if (error) return res.status(500).json({ error: 'Erro ao criar demo' });

  if (Array.isArray(roleIds) && roleIds.length) {
    await supabaseAdmin.from('role_demos').insert(roleIds.map((roleId: string) => ({ role_id: roleId, demo_id: id })));
  }

  await logAction(req.authUserId!, 'CREATE_DEMO', 'demo', id, { payload, roleIds });
  res.status(201).json({ created: true });
});

// Edita uma demo existente (payload e/ou permissões por role).
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { payload, roleIds } = req.body ?? {};

  if (payload) {
    const { error } = await supabaseAdmin
      .from('demos')
      .update({ payload, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) return res.status(500).json({ error: 'Erro ao atualizar demo' });
  }

  if (Array.isArray(roleIds)) {
    await supabaseAdmin.from('role_demos').delete().eq('demo_id', id);
    if (roleIds.length) {
      await supabaseAdmin.from('role_demos').insert(roleIds.map((roleId: string) => ({ role_id: roleId, demo_id: id })));
    }
  }

  await logAction(req.authUserId!, 'UPDATE_DEMO', 'demo', id, { payload, roleIds });
  res.json({ updated: true });
});

// Desativa (soft delete) — não some do banco, só some do catálogo.
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const { error } = await supabaseAdmin.from('demos').update({ active: false }).eq('id', id);
  if (error) return res.status(500).json({ error: 'Erro ao desativar demo' });

  await logAction(req.authUserId!, 'DEACTIVATE_DEMO', 'demo', id);
  res.json({ deactivated: true });
});

export default router;
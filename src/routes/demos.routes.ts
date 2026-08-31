import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { supabaseAdmin } from '../db/supabase.js';

const router = Router();

// Retorna só as demos que a role do usuário logado tem permissão de ver.
// Admin vê tudo, sem precisar cadastrar cada demo em role_demos manualmente.
router.get('/', requireAuth, async (req, res) => {
  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('role_id, roles(name)')
    .eq('id', req.authUserId)
    .single();

  if (profileError || !profile) {
    console.error('[demos] perfil não encontrado', profileError);
    return res.status(403).json({ error: 'Perfil de usuário não encontrado' });
  }

  const roleName = (profile as unknown as { roles: { name: string } }).roles?.name;

  if (roleName === 'admin') {
    const { data, error } = await supabaseAdmin
      .from('demos')
      .select('payload')
      .eq('active', true);
    if (error) return res.status(500).json({ error: 'Erro ao buscar demos' });
    return res.json(data.map(row => row.payload));
  }

  const { data, error } = await supabaseAdmin
    .from('role_demos')
    .select('demos!inner(payload, active)')
    .eq('role_id', profile.role_id)
    .eq('demos.active', true);

  if (error) {
    console.error('[demos] erro ao buscar demos permitidas', error);
    return res.status(500).json({ error: 'Erro ao buscar demos' });
  }

  const demos = (data as unknown as { demos: { payload: unknown } }[]).map(row => row.demos.payload);
  res.json(demos);
});

export default router;

import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { supabaseAdmin } from '../db/supabase.js';

const router = Router();

router.get('/', requireAuth, async (req, res) => {
  const userId = req.authUserId;

  if (!userId) {
    return res.status(401).json({ error: 'Usuário não autenticado' });
  }

  // Busca a role do usuário
  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('role_id, roles(name)')
    .eq('id', userId)
    .single();

  if (profileError || !profile) {
    console.error('[demos] perfil não encontrado', profileError);
    return res.status(403).json({
      error: 'Perfil de usuário não encontrado',
    });
  }

  const roleName = (
    profile as unknown as {
      roles: { name: string } | null;
    }
  ).roles?.name;

  // ============================================================
  // ADMIN / SALES
  // ============================================================
  // Admin e Sales podem visualizar todas as demos ativas.
  if (roleName === 'admin' || roleName === 'sales') {
    const { data, error } = await supabaseAdmin
      .from('demos')
      .select('payload')
      .eq('active', true);

    if (error) {
      console.error('[demos] erro ao buscar todas as demos', error);

      return res.status(500).json({
        error: 'Erro ao buscar demos',
      });
    }

    return res.json(
      data.map((row) => row.payload)
    );
  }

  // ============================================================
  // VIEWER
  // ============================================================
  // Viewer só pode visualizar as demos atribuídas
  // individualmente pelo administrador.
  if (roleName === 'viewer') {
    const { data, error } = await supabaseAdmin
      .from('user_demos')
      .select('demos!inner(payload, active)')
      .eq('user_id', userId)
      .eq('demos.active', true);

    if (error) {
      console.error(
        '[demos] erro ao buscar demos do viewer',
        error
      );

      return res.status(500).json({
        error: 'Erro ao buscar demos',
      });
    }

    const demos = (
      data as unknown as {
        demos: {
          payload: unknown;
        };
      }[]
    ).map((row) => row.demos.payload);

    return res.json(demos);
  }

  // ============================================================
  // ROLE DESCONHECIDA
  // ============================================================

  console.warn(
    `[demos] role sem acesso ao catálogo: ${roleName}`
  );

  return res.status(403).json({
    error: 'Role sem permissão para visualizar demos',
  });
});

export default router;
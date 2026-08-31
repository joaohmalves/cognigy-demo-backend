
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { supabaseAdmin } from '../db/supabase.js';

const router = Router();

router.get('/', requireAuth, async (req, res) => {
  const userId = req.authUserId;

  if (!userId) {
    return res.status(401).json({
      error: 'Usuário não autenticado',
    });
  }

  try {
    // ============================================================
    // 1. Busca o profile do usuário
    // ============================================================

    const {
      data: profile,
      error: profileError,
    } = await supabaseAdmin
      .from('profiles')
      .select('role_id')
      .eq('id', userId)
      .maybeSingle();

    if (profileError) {
      console.error(
        '[demos] erro ao buscar profile:',
        profileError
      );

      return res.status(500).json({
        error: 'Erro ao buscar perfil do usuário',
      });
    }

    if (!profile) {
      console.error(
        `[demos] profile não encontrado para userId: ${userId}`
      );

      return res.status(403).json({
        error: 'Perfil de usuário não encontrado',
      });
    }

    // ============================================================
    // 2. Busca a role separadamente
    // ============================================================

    const {
      data: role,
      error: roleError,
    } = await supabaseAdmin
      .from('roles')
      .select('id, name')
      .eq('id', profile.role_id)
      .maybeSingle();

    if (roleError) {
      console.error(
        '[demos] erro ao buscar role:',
        roleError
      );

      return res.status(500).json({
        error: 'Erro ao buscar role do usuário',
      });
    }

    if (!role) {
      console.error(
        `[demos] role não encontrada para role_id: ${profile.role_id}`
      );

      return res.status(403).json({
        error: 'Role do usuário não encontrada',
      });
    }

    const roleName = role.name.toLowerCase();

    console.log(
      `[demos] user=${userId} role=${roleName}`
    );

    // ============================================================
    // 3. ADMIN
    // ============================================================
    //
    // Admin sempre vê todos os flows ativos.
    //

    if (roleName === 'admin') {
      const {
        data: demos,
        error: demosError,
      } = await supabaseAdmin
        .from('demos')
        .select('payload')
        .eq('active', true)
        .order('id');

      if (demosError) {
        console.error(
          '[demos] erro ao buscar demos do admin:',
          demosError
        );

        return res.status(500).json({
          error: 'Erro ao buscar demos',
        });
      }

      return res.json(
        (demos ?? []).map((demo) => demo.payload)
      );
    }

    // ============================================================
    // 4. SALES
    // ============================================================
    //
    // Sales também pode visualizar todos os flows ativos.
    // Não precisa cadastrar cada demo individualmente.
    //

    if (roleName === 'sales') {
      const {
        data: demos,
        error: demosError,
      } = await supabaseAdmin
        .from('demos')
        .select('payload')
        .eq('active', true)
        .order('id');

      if (demosError) {
        console.error(
          '[demos] erro ao buscar demos do sales:',
          demosError
        );

        return res.status(500).json({
          error: 'Erro ao buscar demos',
        });
      }

      return res.json(
        (demos ?? []).map((demo) => demo.payload)
      );
    }

    // ============================================================
    // 5. VIEWER
    // ============================================================
    //
    // Viewer NÃO recebe todos os flows.
    //
    // O administrador controla individualmente quais demos
    // esse usuário pode visualizar através da tabela user_demos.
    //

    if (roleName === 'viewer') {
      const {
        data: userDemos,
        error: userDemosError,
      } = await supabaseAdmin
        .from('user_demos')
        .select(`
          demo_id,
          demos!inner (
            id,
            payload,
            active
          )
        `)
        .eq('user_id', userId)
        .eq('demos.active', true);

      if (userDemosError) {
        console.error(
          '[demos] erro ao buscar demos do viewer:',
          userDemosError
        );

        return res.status(500).json({
          error: 'Erro ao buscar demos permitidas',
        });
      }

      const demos = (
        userDemos ?? []
      ).map((row) => {
        const demo = Array.isArray(row.demos)
          ? row.demos[0]
          : row.demos;

        return demo?.payload;
      }).filter(Boolean);

      return res.json(demos);
    }

    // ============================================================
    // 6. ROLE DESCONHECIDA
    // ============================================================

    console.warn(
      `[demos] role sem acesso ao catálogo: ${roleName}`
    );

    return res.status(403).json({
      error: 'Role sem permissão para visualizar demos',
    });

  } catch (error) {
    console.error(
      '[demos] erro inesperado:',
      error
    );

    return res.status(500).json({
      error: 'Erro interno ao buscar demos',
    });
  }
});

export default router;
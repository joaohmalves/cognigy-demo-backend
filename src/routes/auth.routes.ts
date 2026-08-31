import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { supabaseAdmin } from '../db/supabase.js';

const router = Router();

// ============================================================
// GET /api/auth/test
// ============================================================

router.get('/test', async (_req, res) => {
  try {
    const {
      data,
      error,
    } = await supabaseAdmin.auth.admin.listUsers({
      page: 1,
      perPage: 1,
    });

    if (error) {
      console.error('[Supabase]', error);

      return res.status(500).json({
        status: 'error',
        message: error.message,
      });
    }

    return res.json({
      status: 'ok',
      supabase: 'connected',
      users: data.users.length,
    });
  } catch (error) {
    console.error('[Supabase]', error);

    return res.status(500).json({
      status: 'error',
    });
  }
});

// ============================================================
// GET /api/auth/me
// ============================================================

router.get('/me', requireAuth, async (req, res) => {
  const userId = req.authUserId;

  if (!userId) {
    return res.status(401).json({
      error: 'Usuário não autenticado',
    });
  }

  try {
    // ========================================================
    // 1. Busca usuário no Supabase Auth
    // ========================================================

    const {
      data: authData,
      error: authError,
    } = await supabaseAdmin.auth.admin.getUserById(userId);

    if (authError || !authData.user) {
      console.error(
        '[auth/me] usuário não encontrado',
        authError
      );

      return res.status(404).json({
        error: 'Usuário não encontrado',
      });
    }

    const user = authData.user;

    // ========================================================
    // 2. Busca PROFILE
    // ========================================================

    const {
      data: profile,
      error: profileError,
    } = await supabaseAdmin
      .from('profiles')
      .select('id, display_name, role_id')
      .eq('id', userId)
      .maybeSingle();

    if (profileError) {
      console.error(
        '[auth/me] erro ao buscar profile:',
        profileError
      );

      return res.status(500).json({
        error: 'Erro ao buscar perfil do usuário',
      });
    }

    if (!profile) {
      console.error(
        '[auth/me] profile não encontrado para:',
        userId
      );

      return res.status(404).json({
        error: 'Perfil do usuário não encontrado',
      });
    }

    // ========================================================
    // 3. Busca ROLE separadamente
    // ========================================================

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
        '[auth/me] erro ao buscar role:',
        roleError
      );

      return res.status(500).json({
        error: 'Erro ao buscar role do usuário',
      });
    }

    // ========================================================
    // 4. Busca permissões da ROLE
    // ========================================================

    const {
      data: rolePermissions,
      error: rolePermissionsError,
    } = await supabaseAdmin
      .from('role_permissions')
      .select(`
        permissions (
          id,
          name
        )
      `)
      .eq('role_id', profile.role_id);

    if (rolePermissionsError) {
      console.error(
        '[auth/me] erro ao buscar role permissions:',
        rolePermissionsError
      );

      return res.status(500).json({
        error: 'Erro ao buscar permissões',
      });
    }

    // ========================================================
    // 5. Busca permissões INDIVIDUAIS
    // ========================================================

    const {
      data: userPermissions,
      error: userPermissionsError,
    } = await supabaseAdmin
      .from('user_permissions')
      .select(`
        permissions (
          id,
          name
        )
      `)
      .eq('user_id', userId);

    if (userPermissionsError) {
      console.error(
        '[auth/me] erro ao buscar user permissions:',
        userPermissionsError
      );

      return res.status(500).json({
        error: 'Erro ao buscar permissões individuais',
      });
    }

    // ========================================================
    // 6. Junta permissões
    // ========================================================

    const rolePermissionNames = (rolePermissions ?? [])
      .map((item) => {
        const permission = Array.isArray(item.permissions)
          ? item.permissions[0]
          : item.permissions;

        return permission?.name;
      })
      .filter(
        (name): name is string => Boolean(name)
      );

    const userPermissionNames = (userPermissions ?? [])
      .map((item) => {
        const permission = Array.isArray(item.permissions)
          ? item.permissions[0]
          : item.permissions;

        return permission?.name;
      })
      .filter(
        (name): name is string => Boolean(name)
      );

    const permissions = Array.from(
      new Set([
        ...rolePermissionNames,
        ...userPermissionNames,
      ])
    );

    // ========================================================
    // 7. Admin possui todas as permissões
    // ========================================================

    if (role?.name === 'admin') {
      const {
        data: allPermissions,
        error: allPermissionsError,
      } = await supabaseAdmin
        .from('permissions')
        .select('name');

      if (!allPermissionsError && allPermissions) {
        permissions.splice(
          0,
          permissions.length,
          ...allPermissions.map(
            (permission) => permission.name
          )
        );
      }
    }

    // ========================================================
    // 8. Retorna usuário
    // ========================================================

    return res.json({
      id: user.id,

      email: user.email ?? null,

      displayName:
        profile.display_name ??
        user.user_metadata?.displayName ??
        user.email ??
        'Usuário',

      role: role
        ? {
            id: role.id,
            name: role.name,
          }
        : null,

      permissions,

      createdAt: user.created_at,

      lastSignInAt: user.last_sign_in_at,
    });

  } catch (error) {
    console.error(
      '[auth/me] erro inesperado:',
      error
    );

    return res.status(500).json({
      error: 'Erro interno ao buscar usuário',
    });
  }
});

export default router;
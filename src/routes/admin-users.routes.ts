// src/routes/admin-users.routes.ts

import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/requirePermission.js';
import { supabaseAdmin } from '../db/supabase.js';
import { logAction } from '../audit/log.js';

const router = Router();

// Todas as rotas deste arquivo exigem:
// 1. usuário autenticado
// 2. permissão MANAGE_USERS
router.use(
  requireAuth,
  requirePermission('MANAGE_USERS')
);

// ============================================================
// GET /api/admin/users
// Lista todos os usuários com role, permissões e demos.
// ============================================================

router.get('/', async (_req, res) => {
  try {
    // ----------------------------------------------------------
    // Busca usuários do Supabase Auth
    // ----------------------------------------------------------

    const {
      data: authData,
      error: authError,
    } = await supabaseAdmin.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });

    if (authError) {
      console.error('[admin/users] erro ao buscar usuários', authError);

      return res.status(500).json({
        error: 'Erro ao buscar usuários',
      });
    }

    // ----------------------------------------------------------
    // Busca profiles
    // ----------------------------------------------------------

    const {
      data: profiles,
      error: profilesError,
    } = await supabaseAdmin
      .from('profiles')
      .select(`
        id,
        display_name,
        role_id,
        roles (
          id,
          name
        )
      `);

    if (profilesError) {
      console.error(
        '[admin/users] erro ao buscar profiles',
        profilesError
      );

      return res.status(500).json({
        error: 'Erro ao buscar perfis',
      });
    }

    // ----------------------------------------------------------
    // Busca permissões individuais
    // ----------------------------------------------------------

    const {
      data: userPermissions,
      error: permissionsError,
    } = await supabaseAdmin
      .from('user_permissions')
      .select(`
        user_id,
        permission_id,
        permissions (
          id,
          name
        )
      `);

    if (permissionsError) {
      console.error(
        '[admin/users] erro ao buscar permissões',
        permissionsError
      );

      return res.status(500).json({
        error: 'Erro ao buscar permissões dos usuários',
      });
    }

    // ----------------------------------------------------------
    // Busca permissões padrão das roles
    // ----------------------------------------------------------

    const {
      data: rolePermissions,
      error: rolePermissionsError,
    } = await supabaseAdmin
      .from('role_permissions')
      .select(`
        role_id,
        permission_id,
        permissions (
          id,
          name
        )
      `);

    if (rolePermissionsError) {
      console.error(
        '[admin/users] erro ao buscar permissões das roles',
        rolePermissionsError
      );

      return res.status(500).json({
        error: 'Erro ao buscar permissões das roles',
      });
    }

    // ----------------------------------------------------------
    // Busca todas as permissões disponíveis
    // ----------------------------------------------------------

    const {
      data: allPermissions,
      error: allPermissionsError,
    } = await supabaseAdmin
      .from('permissions')
      .select('id, name');

    if (allPermissionsError) {
      console.error(
        '[admin/users] erro ao buscar todas as permissões',
        allPermissionsError
      );

      return res.status(500).json({
        error: 'Erro ao buscar permissões',
      });
    }

    // ----------------------------------------------------------
    // Busca demos individuais
    // ----------------------------------------------------------

    const {
      data: userDemos,
      error: demosError,
    } = await supabaseAdmin
      .from('user_demos')
      .select(`
        user_id,
        demo_id
      `);

    if (demosError) {
      console.error(
        '[admin/users] erro ao buscar demos dos usuários',
        demosError
      );

      return res.status(500).json({
        error: 'Erro ao buscar demos dos usuários',
      });
    }

    // ----------------------------------------------------------
    // Monta resposta
    // ----------------------------------------------------------

    const result = authData.users.map((user) => {
      const profile = profiles?.find(
        (item) => item.id === user.id
      );

      const permissions = (userPermissions ?? [])
        .filter((item) => item.user_id === user.id)
        .map((item) => {
          const permission = Array.isArray(item.permissions)
            ? item.permissions[0]
            : item.permissions;

          return {
            id: permission?.id,
            name: permission?.name,
          };
        })
        .filter(
          (permission): permission is {
            id: string;
            name: string;
          } =>
            Boolean(
              permission.id &&
              permission.name
            )
        );

      const role = Array.isArray(profile?.roles)
        ? profile.roles[0]
        : profile?.roles;

      const inheritedPermissions = (rolePermissions ?? [])
        .filter(
          (item) =>
            item.role_id === profile?.role_id
        )
        .map((item) => {
          const permission = Array.isArray(item.permissions)
            ? item.permissions[0]
            : item.permissions;

          return {
            id: permission?.id,
            name: permission?.name,
          };
        })
        .filter(
          (permission): permission is {
            id: string;
            name: string;
          } =>
            Boolean(
              permission.id &&
              permission.name
            )
        );

      // Admin possui todas as permissões.
      //
      // Para as demais roles:
      // permissões efetivas =
      // permissões da role + permissões individuais.
      const effectivePermissions =
        role?.name?.toLowerCase() === 'admin'
          ? (allPermissions ?? [])
          : Array.from(
              new Map(
                [
                  ...inheritedPermissions,
                  ...permissions,
                ].map((permission) => [
                  permission.id,
                  permission,
                ])
              ).values()
            );

      const demos = (userDemos ?? [])
        .filter((item) => item.user_id === user.id)
        .map((item) => item.demo_id);

      return {
        id: user.id,
        email: user.email,

        displayName:
          profile?.display_name ??
          user.user_metadata?.displayName ??
          user.email,

        role: role
          ? {
              id: role.id,
              name: role.name,
            }
          : null,

        // Permissões adicionadas diretamente ao usuário.
        permissions,

        // Permissões herdadas da role.
        rolePermissions: inheritedPermissions,

        // União das permissões da role + individuais.
        effectivePermissions,

        demos,

        // Admin e Sales possuem acesso automático a todas
        // as demos.
        //
        // Viewer possui somente as demos atribuídas
        // individualmente através de user_demos.
        demoAccess:
          role?.name?.toLowerCase() === 'admin' ||
          role?.name?.toLowerCase() === 'sales'
            ? 'all'
            : 'assigned',

        createdAt: user.created_at,
        lastSignInAt: user.last_sign_in_at,
      };
    });

    return res.json(result);
  } catch (error) {
    console.error(
      '[admin/users] erro inesperado',
      error
    );

    return res.status(500).json({
      error: 'Erro interno ao buscar usuários',
    });
  }
});

// ============================================================
// GET /api/admin/users/options
//
// Retorna roles, permissions, permissões das roles e demos
// disponíveis para o painel.
// ============================================================

router.get('/options', async (_req, res) => {
  const [
    rolesResult,
    permissionsResult,
    rolePermissionsResult,
    demosResult,
  ] = await Promise.all([
    supabaseAdmin
      .from('roles')
      .select('id, name')
      .order('name'),

    supabaseAdmin
      .from('permissions')
      .select('id, name')
      .order('name'),

    supabaseAdmin
      .from('role_permissions')
      .select('role_id, permission_id'),

    supabaseAdmin
      .from('demos')
      .select('id, payload, active')
      .eq('active', true)
      .order('id'),
  ]);

  if (rolesResult.error) {
    return res.status(500).json({
      error: 'Erro ao buscar roles',
    });
  }

  if (permissionsResult.error) {
    return res.status(500).json({
      error: 'Erro ao buscar permissões',
    });
  }

  if (rolePermissionsResult.error) {
    return res.status(500).json({
      error: 'Erro ao buscar permissões das roles',
    });
  }

  if (demosResult.error) {
    return res.status(500).json({
      error: 'Erro ao buscar demos',
    });
  }

  return res.json({
    roles: rolesResult.data,
    permissions: permissionsResult.data,
    rolePermissions: rolePermissionsResult.data,

    demos: demosResult.data.map((demo) => ({
      id: demo.id,
      name:
        (demo.payload as { name?: string })?.name ??
        demo.id,
    })),
  });
});

// ============================================================
// PUT /api/admin/users/:id/role
//
// Altera a role do usuário.
// ============================================================

router.put('/:id/role', async (req, res) => {
  const { id } = req.params;
  const { roleId } = req.body ?? {};

  if (!roleId) {
    return res.status(400).json({
      error: 'roleId é obrigatório',
    });
  }

  // Verifica se a role existe.
  const {
    data: role,
    error: roleError,
  } = await supabaseAdmin
    .from('roles')
    .select('id, name')
    .eq('id', roleId)
    .single();

  if (roleError || !role) {
    return res.status(400).json({
      error: 'Role inválida',
    });
  }

  // Não permitir que um admin altere a própria role.
  if (id === req.authUserId) {
    return res.status(400).json({
      error: 'Você não pode alterar a própria role',
    });
  }

  // Busca dados do usuário no Auth para preencher
  // display_name caso seja preciso criar o profile.
  const {
    data: authUser,
  } = await supabaseAdmin.auth.admin.getUserById(id);

  const {
    error: updateError,
  } = await supabaseAdmin
    .from('profiles')
    .upsert(
      {
        id,
        role_id: roleId,
        display_name:
          authUser?.user?.user_metadata?.displayName ??
          authUser?.user?.email ??
          null,
      },
      {
        onConflict: 'id',
      }
    );

  if (updateError) {
    console.error(
      '[admin/users] erro ao alterar role',
      updateError
    );

    return res.status(500).json({
      error: 'Erro ao alterar role',
    });
  }

  await logAction(
    req.authUserId!,
    'UPDATE_USER_ROLE',
    'user',
    id,
    {
      roleId,
      roleName: role.name,
    }
  );

  return res.json({
    updated: true,
    role,
  });
});

// ============================================================
// PUT /api/admin/users/:id/permissions
//
// Substitui TODAS as permissões individuais do usuário.
//
// IMPORTANTE:
// permissões herdadas da role não são copiadas para
// user_permissions. Essa tabela guarda somente exceções
// individuais.
// ============================================================

router.put('/:id/permissions', async (req, res) => {
  const { id } = req.params;
  const { permissionIds } = req.body ?? {};

  if (!Array.isArray(permissionIds)) {
    return res.status(400).json({
      error: 'permissionIds deve ser um array',
    });
  }

  // ----------------------------------------------------------
  // Valida as permissões
  // ----------------------------------------------------------

  const {
    data: permissions,
    error: permissionsError,
  } = await supabaseAdmin
    .from('permissions')
    .select('id, name')
    .in('id', permissionIds);

  if (permissionsError) {
    return res.status(500).json({
      error: 'Erro ao validar permissões',
    });
  }

  if (permissions.length !== permissionIds.length) {
    return res.status(400).json({
      error: 'Uma ou mais permissões são inválidas',
    });
  }

  // ----------------------------------------------------------
  // Remove permissões individuais atuais
  // ----------------------------------------------------------

  const {
    error: deleteError,
  } = await supabaseAdmin
    .from('user_permissions')
    .delete()
    .eq('user_id', id);

  if (deleteError) {
    return res.status(500).json({
      error: 'Erro ao atualizar permissões',
    });
  }

  // ----------------------------------------------------------
  // Insere novas permissões individuais
  // ----------------------------------------------------------

  if (permissionIds.length > 0) {
    const rows = permissionIds.map(
      (permissionId: string) => ({
        user_id: id,
        permission_id: permissionId,
      })
    );

    const {
      error: insertError,
    } = await supabaseAdmin
      .from('user_permissions')
      .insert(rows);

    if (insertError) {
      console.error(
        '[admin/users] erro ao inserir permissões',
        insertError
      );

      return res.status(500).json({
        error: 'Erro ao salvar permissões',
      });
    }
  }

  await logAction(
    req.authUserId!,
    'UPDATE_USER_PERMISSIONS',
    'user',
    id,
    {
      permissionIds,
      permissions: permissions.map(
        (permission) => permission.name
      ),
    }
  );

  return res.json({
    updated: true,
    permissions,
  });
});

// ============================================================
// PUT /api/admin/users/:id/demos
//
// Substitui TODAS as demos individuais do usuário.
//
// Admin e Sales possuem acesso global às demos e, portanto,
// não utilizam user_demos.
// ============================================================

router.put('/:id/demos', async (req, res) => {
  const { id } = req.params;
  const { demoIds } = req.body ?? {};

  if (!Array.isArray(demoIds)) {
    return res.status(400).json({
      error: 'demoIds deve ser um array',
    });
  }

  // ----------------------------------------------------------
  // Busca a role do usuário alvo.
  // ----------------------------------------------------------

  const {
    data: targetProfile,
    error: targetProfileError,
  } = await supabaseAdmin
    .from('profiles')
    .select(`
      role_id,
      roles (
        name
      )
    `)
    .eq('id', id)
    .maybeSingle();

  if (targetProfileError) {
    console.error(
      '[admin/users] erro ao buscar role do usuário para demos',
      targetProfileError
    );

    return res.status(500).json({
      error: 'Erro ao buscar role do usuário',
    });
  }

  if (!targetProfile) {
    return res.status(404).json({
      error: 'Perfil do usuário não encontrado',
    });
  }

  const targetRole = Array.isArray(targetProfile.roles)
    ? targetProfile.roles[0]
    : targetProfile.roles;

  const targetRoleName =
    targetRole?.name?.toLowerCase();

  // ----------------------------------------------------------
  // Admin e Sales não podem receber atribuições individuais.
  // Eles já possuem acesso automático a todas as demos.
  // ----------------------------------------------------------

  if (
    targetRoleName === 'admin' ||
    targetRoleName === 'sales'
  ) {
    return res.status(400).json({
      error:
        'Usuários Admin e Sales possuem acesso automático a todas as demos',
    });
  }

  // ----------------------------------------------------------
  // Valida demos
  // ----------------------------------------------------------

  if (demoIds.length > 0) {
    const {
      data: demos,
      error: demosError,
    } = await supabaseAdmin
      .from('demos')
      .select('id')
      .in('id', demoIds);

    if (demosError) {
      return res.status(500).json({
        error: 'Erro ao validar demos',
      });
    }

    if (demos.length !== demoIds.length) {
      return res.status(400).json({
        error: 'Uma ou mais demos são inválidas',
      });
    }
  }

  // ----------------------------------------------------------
  // Remove demos atuais
  // ----------------------------------------------------------

  const {
    error: deleteError,
  } = await supabaseAdmin
    .from('user_demos')
    .delete()
    .eq('user_id', id);

  if (deleteError) {
    return res.status(500).json({
      error: 'Erro ao atualizar demos',
    });
  }

  // ----------------------------------------------------------
  // Insere novas demos
  // ----------------------------------------------------------

  if (demoIds.length > 0) {
    const rows = demoIds.map(
      (demoId: string) => ({
        user_id: id,
        demo_id: demoId,
      })
    );

    const {
      error: insertError,
    } = await supabaseAdmin
      .from('user_demos')
      .insert(rows);

    if (insertError) {
      console.error(
        '[admin/users] erro ao inserir demos',
        insertError
      );

      return res.status(500).json({
        error: 'Erro ao salvar demos',
      });
    }
  }

  await logAction(
    req.authUserId!,
    'UPDATE_USER_DEMOS',
    'user',
    id,
    {
      demoIds,
    }
  );

  return res.json({
    updated: true,
    demoIds,
  });
});

export default router;
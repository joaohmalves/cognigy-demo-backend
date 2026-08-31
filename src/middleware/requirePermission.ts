import type { NextFunction, Request, Response } from 'express';
import { supabaseAdmin } from '../db/supabase.js';

// Verifica se o usuário possui uma determinada permissão.
//
// A permissão pode vir de:
// 1. role_permissions → permissões padrão da role
// 2. user_permissions → permissões concedidas individualmente pelo admin
//
// Se estiver em qualquer uma das duas, o acesso é permitido.
export function requirePermission(permissionName: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.authUserId;

    if (!userId) {
      return res.status(401).json({
        error: 'Usuário não autenticado',
      });
    }

    // ============================================================
    // 1. Busca o perfil e a role do usuário
    // ============================================================

    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('role_id, roles(name)')
      .eq('id', userId)
      .single();

    if (profileError || !profile) {
      console.error(
        '[requirePermission] perfil não encontrado',
        profileError
      );

      return res.status(403).json({
        error: 'Perfil não encontrado',
      });
    }

    const roleName = (
      profile as unknown as {
        role_id: string;
        roles: { name: string } | null;
      }
    ).roles?.name;

    // ============================================================
    // 2. ADMIN
    // ============================================================
    // Admin possui acesso total.
    //
    // Isso evita precisar cadastrar cada permissão individualmente
    // para administradores.

    if (roleName === 'admin') {
      return next();
    }

    // ============================================================
    // 3. Verifica a permissão da ROLE
    // ============================================================

    const { data: rolePerm, error: rolePermError } = await supabaseAdmin
      .from('role_permissions')
      .select(`
        permission_id,
        permissions!inner(name)
      `)
      .eq('role_id', profile.role_id)
      .eq('permissions.name', permissionName)
      .maybeSingle();

    if (rolePermError) {
      console.error(
        '[requirePermission] erro ao verificar role permission',
        rolePermError
      );

      return res.status(500).json({
        error: 'Erro ao verificar permissões',
      });
    }

    if (rolePerm) {
      return next();
    }

    // ============================================================
    // 4. Verifica a permissão INDIVIDUAL do usuário
    // ============================================================

    const { data: permission, error: permissionError } =
      await supabaseAdmin
        .from('permissions')
        .select('id')
        .eq('name', permissionName)
        .maybeSingle();

    if (permissionError) {
      console.error(
        '[requirePermission] erro ao buscar permission',
        permissionError
      );

      return res.status(500).json({
        error: 'Erro ao verificar permissões',
      });
    }

    if (!permission) {
      console.error(
        `[requirePermission] permissão inexistente: ${permissionName}`
      );

      return res.status(500).json({
        error: 'Permissão configurada no sistema não existe',
      });
    }

    const { data: userPermission, error: userPermissionError } =
      await supabaseAdmin
        .from('user_permissions')
        .select('permission_id')
        .eq('user_id', userId)
        .eq('permission_id', permission.id)
        .maybeSingle();

    if (userPermissionError) {
      console.error(
        '[requirePermission] erro ao verificar user permission',
        userPermissionError
      );

      return res.status(500).json({
        error: 'Erro ao verificar permissões',
      });
    }

    if (userPermission) {
      return next();
    }

    // ============================================================
    // 5. SEM PERMISSÃO
    // ============================================================

    return res.status(403).json({
      error: `Permissão ${permissionName} necessária`,
    });
  };
}
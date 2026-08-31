import type { NextFunction, Request, Response } from 'express';
import { supabaseAdmin } from '../db/supabase.js';

// Verifica se a role do usuário logado tem a permissão exigida.
export function requirePermission(permissionName: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('role_id')
      .eq('id', req.authUserId)
      .single();

    if (profileError || !profile) return res.status(403).json({ error: 'Perfil não encontrado' });

    const { data: rolePerm, error: permError } = await supabaseAdmin
      .from('role_permissions')
      .select('permissions!inner(name)')
      .eq('role_id', profile.role_id)
      .eq('permissions.name', permissionName)
      .maybeSingle();

    if (permError || !rolePerm) return res.status(403).json({ error: `Permissão ${permissionName} necessária` });

    next();
  };
}
import type { NextFunction, Request, Response } from 'express';
import { supabaseAdmin } from '../db/supabase.js';

declare global {
  namespace Express {
    interface Request {
      authUserId?: string;
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const accessToken = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  if (!accessToken) return res.status(401).json({ error: 'Token de acesso ausente' });

  const { data, error } = await supabaseAdmin.auth.getUser(accessToken);
  if (error || !data?.user) return res.status(401).json({ error: 'Token inválido ou expirado' });

  req.authUserId = data.user.id;
  next();
}

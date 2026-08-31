import { supabaseAdmin } from '../db/supabase.js';

export async function logAction(userId: string, action: string, targetType: string, targetId?: string, details?: unknown) {
  const { error } = await supabaseAdmin
    .from('audit_logs')
    .insert({ user_id: userId, action, target_type: targetType, target_id: targetId, details });
  if (error) console.error('[audit] falha ao registrar log', error);
}
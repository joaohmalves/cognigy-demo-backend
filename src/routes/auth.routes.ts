import { Router } from 'express';
import { supabaseAdmin } from '../db/supabase.js';

const router = Router();

router.get('/test', async (_req, res) => {
  try {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({
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

export default router;
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { createRateLimiter } from '../middleware/rateLimiter.js';
import { supabaseAdmin, createAuthVerificationClient } from '../db/supabase.js';
import { logAction } from '../audit/log.js';

const router = Router();

// ============================================================
// Segurança: troca de senha/login
// ============================================================
//
// - Rate limit: no máx. 5 tentativas a cada 15 min por usuário
//   (protege contra força bruta na senha atual).
// - Cooldown: após uma troca bem-sucedida, o usuário precisa
//   aguardar 10 min para trocar novamente. Persistido no banco
//   (profiles.password_changed_at / email_changed_at), então
//   sobrevive a restarts do backend.
// - Sempre exige a senha atual, validada via signInWithPassword
//   antes de qualquer alteração.
// - Nunca loga senhas (nem em audit_logs, nem no console).
//
// Pré-requisito no banco (rodar uma vez no Supabase):
//   ALTER TABLE profiles ADD COLUMN IF NOT EXISTS password_changed_at timestamptz;
//   ALTER TABLE profiles ADD COLUMN IF NOT EXISTS email_changed_at timestamptz;

const CREDENTIALS_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutos
const CREDENTIALS_RATE_LIMIT_MAX = 5; // tentativas por janela
const CREDENTIALS_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutos entre trocas bem-sucedidas

const credentialsChangeLimiter = createRateLimiter({
  windowMs: CREDENTIALS_RATE_LIMIT_WINDOW_MS,
  max: CREDENTIALS_RATE_LIMIT_MAX,
  keyFn: (req) => req.authUserId ?? req.ip ?? 'anon',
  message:
    'Muitas tentativas de alteração de credenciais. Aguarde alguns minutos e tente novamente.',
});

function isStrongPassword(password: unknown): password is string {
  if (typeof password !== 'string') return false;
  if (password.length < 8) return false;
  if (!/[a-z]/.test(password)) return false;
  if (!/[A-Z]/.test(password)) return false;
  if (!/[0-9]/.test(password)) return false;
  if (!/[^A-Za-z0-9]/.test(password)) return false;
  return true;
}

function isValidEmail(email: unknown): email is string {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

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

// ============================================================
// POST /api/auth/exchange-code
// Gera um código de uso único para handoff nas demos multimodais
// ============================================================

router.post('/exchange-code', requireAuth, async (req, res) => {
  const userId = req.authUserId;

  if (!userId) {
    return res.status(401).json({
      error: 'Usuário não autenticado',
    });
  }

  try {
    const code = crypto.randomUUID().replace(/-/g, '');
    const expiresAt = new Date(Date.now() + 60 * 1000); // 60s de validade

    const { error } = await supabaseAdmin
      .from('exchange_codes')
      .insert({
        code,
        user_id: userId,
        expires_at: expiresAt.toISOString(),
      });

    if (error) {
      console.error('[auth/exchange-code] erro ao criar código:', error);
      return res.status(500).json({
        error: 'Erro ao gerar código de troca',
      });
    }

    return res.json({ code });
  } catch (error) {
    console.error('[auth/exchange-code] erro inesperado:', error);
    return res.status(500).json({
      error: 'Erro interno ao gerar código',
    });
  }
});

// ============================================================
// POST /api/auth/redeem-code
// Resgata o código de handoff gerado em /exchange-code
// ============================================================

router.post('/redeem-code', async (req, res) => {
  const { code } = req.body ?? {};

  if (!code || typeof code !== 'string') {
    return res.status(400).json({
      error: 'Código ausente ou inválido',
    });
  }

  try {
    const { data: exchangeCode, error: fetchError } = await supabaseAdmin
      .from('exchange_codes')
      .select('id, user_id, expires_at, used_at')
      .eq('code', code)
      .maybeSingle();

    if (fetchError) {
      console.error('[auth/redeem-code] erro ao buscar código:', fetchError);
      return res.status(500).json({ error: 'Erro ao validar código' });
    }

    if (!exchangeCode) {
      return res.status(404).json({ error: 'Código inválido' });
    }

    if (exchangeCode.used_at) {
      return res.status(409).json({ error: 'Código já utilizado' });
    }

    if (new Date(exchangeCode.expires_at).getTime() < Date.now()) {
      return res.status(410).json({ error: 'Código expirado' });
    }

    // Marca como usado (uso único)
    const { error: updateError } = await supabaseAdmin
      .from('exchange_codes')
      .update({ used_at: new Date().toISOString() })
      .eq('id', exchangeCode.id);

    if (updateError) {
      console.error('[auth/redeem-code] erro ao marcar código como usado:', updateError);
      return res.status(500).json({ error: 'Erro ao resgatar código' });
    }

    // Busca dados básicos do usuário pra devolver pro front do OneBank
    const { data: authData } = await supabaseAdmin.auth.admin.getUserById(
      exchangeCode.user_id,
    );

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('display_name')
      .eq('id', exchangeCode.user_id)
      .maybeSingle();

    return res.json({
      user: {
        id: exchangeCode.user_id,
        email: authData?.user?.email ?? null,
        displayName: profile?.display_name ?? authData?.user?.email ?? 'Usuário',
      },
    });
  } catch (error) {
    console.error('[auth/redeem-code] erro inesperado:', error);
    return res.status(500).json({ error: 'Erro interno ao resgatar código' });
  }
});

// ============================================================
// PUT /api/auth/password
// Permite que o usuário autenticado troque a própria senha.
// Exige a senha atual + rate limit + cooldown.
// ============================================================

router.put('/password', requireAuth, credentialsChangeLimiter, async (req, res) => {
  const userId = req.authUserId!;
  const { currentPassword, newPassword } = req.body ?? {};

  if (typeof currentPassword !== 'string' || currentPassword.length === 0) {
    return res.status(400).json({ error: 'Informe a senha atual.' });
  }

  if (!isStrongPassword(newPassword)) {
    return res.status(400).json({
      error:
        'A nova senha deve ter no mínimo 8 caracteres, incluindo letra maiúscula, minúscula, número e caractere especial.',
    });
  }

  if (newPassword === currentPassword) {
    return res.status(400).json({
      error: 'A nova senha deve ser diferente da senha atual.',
    });
  }

  try {
    // 1. Cooldown persistido: impede trocas muito frequentes.
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('password_changed_at')
      .eq('id', userId)
      .maybeSingle();

    if (profileError) {
      console.error('[auth/password] erro ao buscar profile:', profileError);
      return res.status(500).json({ error: 'Erro ao validar solicitação.' });
    }

    if (profile?.password_changed_at) {
      const elapsedMs = Date.now() - new Date(profile.password_changed_at).getTime();

      if (elapsedMs < CREDENTIALS_COOLDOWN_MS) {
        const waitMinutes = Math.ceil((CREDENTIALS_COOLDOWN_MS - elapsedMs) / 60_000);
        return res.status(429).json({
          error: `Aguarde ${waitMinutes} minuto(s) antes de trocar a senha novamente.`,
        });
      }
    }

    // 2. Busca e-mail do usuário para validar a senha atual.
    const { data: authUser, error: getUserError } = await supabaseAdmin.auth.admin.getUserById(
      userId,
    );

    if (getUserError || !authUser?.user?.email) {
      console.error('[auth/password] usuário não encontrado:', getUserError);
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }

    // 3. Confirma identidade validando a senha atual (fora do supabaseAdmin
    // compartilhado, usando um client isolado).
    const verificationClient = createAuthVerificationClient();
    const { error: signInError } = await verificationClient.auth.signInWithPassword({
      email: authUser.user.email,
      password: currentPassword,
    });

    if (signInError) {
      await logAction(userId, 'CHANGE_PASSWORD_FAILED', 'user', userId, {
        reason: 'senha_atual_invalida',
      });

      return res.status(401).json({ error: 'Senha atual incorreta.' });
    }

    // 4. Atualiza a senha via Admin API (isso já revoga sessões antigas).
    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      password: newPassword,
    });

    if (updateError) {
      console.error('[auth/password] erro ao atualizar senha:', updateError);
      return res.status(500).json({ error: 'Erro ao atualizar senha.' });
    }

    // 5. Persiste o cooldown.
    await supabaseAdmin
      .from('profiles')
      .update({ password_changed_at: new Date().toISOString() })
      .eq('id', userId);

    await logAction(userId, 'CHANGE_PASSWORD', 'user', userId);

    return res.json({ success: true });
  } catch (error) {
    console.error('[auth/password] erro inesperado:', error);
    return res.status(500).json({ error: 'Erro interno ao alterar senha.' });
  }
});

// ============================================================
// PUT /api/auth/email
// Permite que o usuário autenticado troque o próprio login (e-mail).
// Exige a senha atual + rate limit + cooldown.
// ============================================================

router.put('/email', requireAuth, credentialsChangeLimiter, async (req, res) => {
  const userId = req.authUserId!;
  const { currentPassword, newEmail } = req.body ?? {};

  if (typeof currentPassword !== 'string' || currentPassword.length === 0) {
    return res.status(400).json({ error: 'Informe a senha atual.' });
  }

  if (!isValidEmail(newEmail)) {
    return res.status(400).json({ error: 'Informe um login (e-mail) válido.' });
  }

  try {
    // 1. Cooldown persistido: impede trocas muito frequentes.
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('email_changed_at')
      .eq('id', userId)
      .maybeSingle();

    if (profileError) {
      console.error('[auth/email] erro ao buscar profile:', profileError);
      return res.status(500).json({ error: 'Erro ao validar solicitação.' });
    }

    if (profile?.email_changed_at) {
      const elapsedMs = Date.now() - new Date(profile.email_changed_at).getTime();

      if (elapsedMs < CREDENTIALS_COOLDOWN_MS) {
        const waitMinutes = Math.ceil((CREDENTIALS_COOLDOWN_MS - elapsedMs) / 60_000);
        return res.status(429).json({
          error: `Aguarde ${waitMinutes} minuto(s) antes de trocar o login novamente.`,
        });
      }
    }

    const { data: authUser, error: getUserError } = await supabaseAdmin.auth.admin.getUserById(
      userId,
    );

    if (getUserError || !authUser?.user?.email) {
      console.error('[auth/email] usuário não encontrado:', getUserError);
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }

    if (authUser.user.email.toLowerCase() === newEmail.toLowerCase()) {
      return res.status(400).json({ error: 'O novo login deve ser diferente do atual.' });
    }

    // 2. Confirma identidade validando a senha atual.
    const verificationClient = createAuthVerificationClient();
    const { error: signInError } = await verificationClient.auth.signInWithPassword({
      email: authUser.user.email,
      password: currentPassword,
    });

    if (signInError) {
      await logAction(userId, 'CHANGE_EMAIL_FAILED', 'user', userId, {
        reason: 'senha_atual_invalida',
      });

      return res.status(401).json({ error: 'Senha atual incorreta.' });
    }

    // 3. Atualiza o e-mail via Admin API (email_confirm evita fluxo de
    // confirmação por e-mail, já que quem está trocando é o próprio dono
    // da conta e já provou a identidade com a senha atual).
    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      email: newEmail,
      email_confirm: true,
    });

    if (updateError) {
      console.error('[auth/email] erro ao atualizar login:', updateError);
      return res.status(409).json({
        error: 'Não foi possível usar esse login. Ele pode já estar em uso.',
      });
    }

    // 4. Persiste o cooldown.
    await supabaseAdmin
      .from('profiles')
      .update({ email_changed_at: new Date().toISOString() })
      .eq('id', userId);

    await logAction(userId, 'CHANGE_EMAIL', 'user', userId, { newEmail });

    return res.json({ success: true, email: newEmail });
  } catch (error) {
    console.error('[auth/email] erro inesperado:', error);
    return res.status(500).json({ error: 'Erro interno ao alterar login.' });
  }
});

export default router;
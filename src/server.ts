import { Router } from 'express';
import { randomUUID } from 'node:crypto';

import { requireAuth } from './middleware/auth.js';
import { createRateLimiter } from './middleware/rateLimiter.js';

import {
  supabaseAdmin,
  createAuthVerificationClient,
} from './db/supabase.js';

import { logAction } from './audit/log.js';

const router = Router();

// ============================================================
// CONFIGURAÇÕES DE SEGURANÇA
// ============================================================

const CREDENTIALS_RATE_LIMIT_WINDOW_MS =
  15 * 60 * 1000;

// Senha:
// máximo de 5 tentativas por usuário
// a cada 15 minutos.
const PASSWORD_RATE_LIMIT_MAX = 5;

// Login/e-mail:
// máximo de 5 tentativas por usuário
// a cada 15 minutos.
const EMAIL_RATE_LIMIT_MAX = 5;

// Proteção adicional por IP.
const IP_RATE_LIMIT_MAX = 20;

// Após alteração bem-sucedida,
// aguarda 10 minutos antes de permitir outra alteração.
const CREDENTIALS_COOLDOWN_MS =
  10 * 60 * 1000;

// Senha mínima.
const MIN_PASSWORD_LENGTH = 12;

// Senha máxima.
// Evita payloads abusivos sem impor limite
// artificialmente pequeno.
const MAX_PASSWORD_LENGTH = 128;

// Login/e-mail máximo.
const MAX_EMAIL_LENGTH = 254;

// ============================================================
// RATE LIMIT — SENHA
// ============================================================

const passwordUserLimiter =
  createRateLimiter({
    windowMs:
      CREDENTIALS_RATE_LIMIT_WINDOW_MS,

    max: PASSWORD_RATE_LIMIT_MAX,

    keyFn: (req) =>
      `user:${req.authUserId ?? 'unknown'}`,

    message:
      'Muitas tentativas de alteração de senha. Aguarde alguns minutos e tente novamente.',
  });

const passwordIpLimiter =
  createRateLimiter({
    windowMs:
      CREDENTIALS_RATE_LIMIT_WINDOW_MS,

    max: IP_RATE_LIMIT_MAX,

    keyFn: (req) =>
      `ip:${req.ip ?? 'unknown'}`,

    message:
      'Muitas solicitações de alteração de senha deste endereço. Aguarde alguns minutos e tente novamente.',
  });

// ============================================================
// RATE LIMIT — LOGIN / E-MAIL
// ============================================================

const emailUserLimiter =
  createRateLimiter({
    windowMs:
      CREDENTIALS_RATE_LIMIT_WINDOW_MS,

    max: EMAIL_RATE_LIMIT_MAX,

    keyFn: (req) =>
      `user:${req.authUserId ?? 'unknown'}`,

    message:
      'Muitas tentativas de alteração de login. Aguarde alguns minutos e tente novamente.',
  });

const emailIpLimiter =
  createRateLimiter({
    windowMs:
      CREDENTIALS_RATE_LIMIT_WINDOW_MS,

    max: IP_RATE_LIMIT_MAX,

    keyFn: (req) =>
      `ip:${req.ip ?? 'unknown'}`,

    message:
      'Muitas solicitações de alteração de login deste endereço. Aguarde alguns minutos e tente novamente.',
  });

// ============================================================
// VALIDAÇÕES
// ============================================================

function isStrongPassword(
  password: unknown,
): password is string {
  if (typeof password !== 'string') {
    return false;
  }

  if (
    password.length <
    MIN_PASSWORD_LENGTH
  ) {
    return false;
  }

  if (
    password.length >
    MAX_PASSWORD_LENGTH
  ) {
    return false;
  }

  if (!/[a-z]/.test(password)) {
    return false;
  }

  if (!/[A-Z]/.test(password)) {
    return false;
  }

  if (!/[0-9]/.test(password)) {
    return false;
  }

  if (!/[^A-Za-z0-9]/.test(password)) {
    return false;
  }

  return true;
}

function isValidEmail(
  email: unknown,
): email is string {
  if (typeof email !== 'string') {
    return false;
  }

  if (
    email.length === 0 ||
    email.length > MAX_EMAIL_LENGTH
  ) {
    return false;
  }

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
    email,
  );
}

function normalizeEmail(
  email: string,
): string {
  return email.trim().toLowerCase();
}

function getRemainingCooldownMs(
  changedAt: string | null | undefined,
): number {
  if (!changedAt) {
    return 0;
  }

  const changedAtMs =
    new Date(changedAt).getTime();

  if (!Number.isFinite(changedAtMs)) {
    return 0;
  }

  const elapsed =
    Date.now() - changedAtMs;

  return Math.max(
    0,
    CREDENTIALS_COOLDOWN_MS -
    elapsed,
  );
}

function getWaitMinutes(
  remainingMs: number,
): number {
  return Math.max(
    1,
    Math.ceil(
      remainingMs / 60_000,
    ),
  );
}

// ============================================================
// GET /api/auth/test
// ============================================================

router.get(
  '/test',
  async (_req, res) => {
    try {
      const {
        data,
        error,
      } =
        await supabaseAdmin.auth.admin.listUsers(
          {
            page: 1,
            perPage: 1,
          },
        );

      if (error) {
        console.error(
          '[Supabase]',
          error,
        );

        return res.status(500).json({
          status: 'error',
          message: error.message,
        });
      }

      return res.json({
        status: 'ok',
        supabase: 'connected',
        users:
          data.users.length,
      });
    } catch (error) {
      console.error(
        '[Supabase]',
        error,
      );

      return res.status(500).json({
        status: 'error',
      });
    }
  },
);

// ============================================================
// GET /api/auth/me
// ============================================================

router.get(
  '/me',
  requireAuth,
  async (req, res) => {
    const userId =
      req.authUserId;

    if (!userId) {
      return res.status(401).json({
        error:
          'Usuário não autenticado',
      });
    }

    try {
      // ======================================================
      // 1. Busca usuário no Supabase Auth
      // ======================================================

      const {
        data: authData,
        error: authError,
      } =
        await supabaseAdmin.auth.admin.getUserById(
          userId,
        );

      if (
        authError ||
        !authData.user
      ) {
        console.error(
          '[auth/me] usuário não encontrado',
          authError,
        );

        return res.status(404).json({
          error:
            'Usuário não encontrado',
        });
      }

      const user =
        authData.user;

      // ======================================================
      // 2. Busca PROFILE
      // ======================================================

      const {
        data: profile,
        error: profileError,
      } =
        await supabaseAdmin
          .from('profiles')
          .select(
            'id, display_name, role_id',
          )
          .eq('id', userId)
          .maybeSingle();

      if (profileError) {
        console.error(
          '[auth/me] erro ao buscar profile:',
          profileError,
        );

        return res.status(500).json({
          error:
            'Erro ao buscar perfil do usuário',
        });
      }

      if (!profile) {
        console.error(
          '[auth/me] profile não encontrado para:',
          userId,
        );

        return res.status(404).json({
          error:
            'Perfil do usuário não encontrado',
        });
      }

      // ======================================================
      // 3. Busca ROLE
      // ======================================================

      const {
        data: role,
        error: roleError,
      } =
        await supabaseAdmin
          .from('roles')
          .select('id, name')
          .eq(
            'id',
            profile.role_id,
          )
          .maybeSingle();

      if (roleError) {
        console.error(
          '[auth/me] erro ao buscar role:',
          roleError,
        );

        return res.status(500).json({
          error:
            'Erro ao buscar role do usuário',
        });
      }

      // ======================================================
      // 4. Busca permissões da ROLE
      // ======================================================

      const {
        data: rolePermissions,
        error:
        rolePermissionsError,
      } =
        await supabaseAdmin
          .from('role_permissions')
          .select(`
            permissions (
              id,
              name
            )
          `)
          .eq(
            'role_id',
            profile.role_id,
          );

      if (rolePermissionsError) {
        console.error(
          '[auth/me] erro ao buscar role permissions:',
          rolePermissionsError,
        );

        return res.status(500).json({
          error:
            'Erro ao buscar permissões',
        });
      }

      // ======================================================
      // 5. Busca permissões individuais
      // ======================================================

      const {
        data: userPermissions,
        error:
        userPermissionsError,
      } =
        await supabaseAdmin
          .from('user_permissions')
          .select(`
            permissions (
              id,
              name
            )
          `)
          .eq(
            'user_id',
            userId,
          );

      if (userPermissionsError) {
        console.error(
          '[auth/me] erro ao buscar user permissions:',
          userPermissionsError,
        );

        return res.status(500).json({
          error:
            'Erro ao buscar permissões individuais',
        });
      }

      // ======================================================
      // 6. Junta permissões
      // ======================================================

      const rolePermissionNames =
        (rolePermissions ?? [])
          .map((item) => {
            const permission =
              Array.isArray(
                item.permissions,
              )
                ? item.permissions[0]
                : item.permissions;

            return permission?.name;
          })
          .filter(
            (
              name,
            ): name is string =>
              Boolean(name),
          );

      const userPermissionNames =
        (userPermissions ?? [])
          .map((item) => {
            const permission =
              Array.isArray(
                item.permissions,
              )
                ? item.permissions[0]
                : item.permissions;

            return permission?.name;
          })
          .filter(
            (
              name,
            ): name is string =>
              Boolean(name),
          );

      const permissions =
        Array.from(
          new Set([
            ...rolePermissionNames,
            ...userPermissionNames,
          ]),
        );

      // ======================================================
      // 7. Admin possui todas as permissões
      // ======================================================

      if (
        role?.name ===
        'admin'
      ) {
        const {
          data: allPermissions,
          error:
          allPermissionsError,
        } =
          await supabaseAdmin
            .from('permissions')
            .select('name');

        if (
          !allPermissionsError &&
          allPermissions
        ) {
          permissions.splice(
            0,
            permissions.length,
            ...allPermissions.map(
              (permission) =>
                permission.name,
            ),
          );
        }
      }

      // ======================================================
      // 8. Retorna usuário
      // ======================================================

      return res.json({
        id: user.id,

        email:
          user.email ?? null,

        displayName:
          profile.display_name ??
          user.user_metadata
            ?.displayName ??
          user.email ??
          'Usuário',

        role: role
          ? {
            id: role.id,
            name: role.name,
          }
          : null,

        permissions,

        createdAt:
          user.created_at,

        lastSignInAt:
          user.last_sign_in_at,
      });
    } catch (error) {
      console.error(
        '[auth/me] erro inesperado:',
        error,
      );

      return res.status(500).json({
        error:
          'Erro interno ao buscar usuário',
      });
    }
  },
);

// ============================================================
// POST /api/auth/exchange-code
// ============================================================

router.post(
  '/exchange-code',
  requireAuth,
  async (req, res) => {
    const userId =
      req.authUserId;

    if (!userId) {
      return res.status(401).json({
        error:
          'Usuário não autenticado',
      });
    }

    try {
      const code =
        randomUUID().replace(
          /-/g,
          '',
        );

      const expiresAt =
        new Date(
          Date.now() +
          60 * 1000,
        );

      const { error } =
        await supabaseAdmin
          .from(
            'exchange_codes',
          )
          .insert({
            code,
            user_id: userId,
            expires_at:
              expiresAt.toISOString(),
          });

      if (error) {
        console.error(
          '[auth/exchange-code] erro ao criar código:',
          error,
        );

        return res.status(500).json({
          error:
            'Erro ao gerar código de troca',
        });
      }

      return res.json({
        code,
      });
    } catch (error) {
      console.error(
        '[auth/exchange-code] erro inesperado:',
        error,
      );

      return res.status(500).json({
        error:
          'Erro interno ao gerar código',
      });
    }
  },
);

// ============================================================
// POST /api/auth/redeem-code
// ============================================================

router.post(
  '/redeem-code',
  async (req, res) => {
    const { code } =
      req.body ?? {};

    if (
      typeof code !==
      'string' ||
      code.length === 0 ||
      code.length > 128
    ) {
      return res.status(400).json({
        error:
          'Código ausente ou inválido',
      });
    }

    try {
      const {
        data: exchangeCode,
        error: fetchError,
      } =
        await supabaseAdmin
          .from(
            'exchange_codes',
          )
          .select(
            'id, user_id, expires_at, used_at',
          )
          .eq(
            'code',
            code,
          )
          .maybeSingle();

      if (fetchError) {
        console.error(
          '[auth/redeem-code] erro ao buscar código:',
          fetchError,
        );

        return res.status(500).json({
          error:
            'Erro ao validar código',
        });
      }

      if (!exchangeCode) {
        return res.status(404).json({
          error:
            'Código inválido',
        });
      }

      if (
        exchangeCode.used_at
      ) {
        return res.status(409).json({
          error:
            'Código já utilizado',
        });
      }

      if (
        new Date(
          exchangeCode.expires_at,
        ).getTime() <
        Date.now()
      ) {
        return res.status(410).json({
          error:
            'Código expirado',
        });
      }

      /*
       * Consumo atômico.
       *
       * Apenas a requisição que encontrar
       * used_at IS NULL consegue marcar
       * o código como utilizado.
       */
      const {
        data: consumedCode,
        error:
        updateError,
      } =
        await supabaseAdmin
          .from(
            'exchange_codes',
          )
          .update({
            used_at:
              new Date().toISOString(),
          })
          .eq(
            'id',
            exchangeCode.id,
          )
          .is(
            'used_at',
            null,
          )
          .select(
            'id',
          )
          .maybeSingle();

      if (updateError) {
        console.error(
          '[auth/redeem-code] erro ao marcar código como usado:',
          updateError,
        );

        return res.status(500).json({
          error:
            'Erro ao resgatar código',
        });
      }

      if (!consumedCode) {
        return res.status(409).json({
          error:
            'Código já utilizado',
        });
      }

      const {
        data: authData,
      } =
        await supabaseAdmin.auth.admin.getUserById(
          exchangeCode.user_id,
        );

      const {
        data: profile,
      } =
        await supabaseAdmin
          .from('profiles')
          .select(
            'display_name',
          )
          .eq(
            'id',
            exchangeCode.user_id,
          )
          .maybeSingle();

      return res.json({
        user: {
          id: exchangeCode.user_id,

          email:
            authData?.user
              ?.email ??
            null,

          displayName:
            profile?.display_name ??
            authData?.user
              ?.email ??
            'Usuário',
        },
      });
    } catch (error) {
      console.error(
        '[auth/redeem-code] erro inesperado:',
        error,
      );

      return res.status(500).json({
        error:
          'Erro interno ao resgatar código',
      });
    }
  },
);

// ============================================================
// PUT /api/auth/password
// ============================================================

router.put(
  '/password',
  requireAuth,
  passwordUserLimiter,
  passwordIpLimiter,
  async (req, res) => {
    const userId =
      req.authUserId!;

    const {
      currentPassword,
      newPassword,
    } = req.body ?? {};

    // ========================================================
    // Validação básica
    // ========================================================

    if (
      typeof currentPassword !==
      'string' ||
      currentPassword.length ===
      0 ||
      currentPassword.length >
      MAX_PASSWORD_LENGTH
    ) {
      return res.status(400).json({
        error:
          'Informe a senha atual.',
      });
    }

    if (
      !isStrongPassword(
        newPassword,
      )
    ) {
      return res.status(400).json({
        error:
          'A nova senha deve ter no mínimo 12 caracteres, incluindo letra maiúscula, minúscula, número e caractere especial.',
      });
    }

    if (
      newPassword ===
      currentPassword
    ) {
      return res.status(400).json({
        error:
          'A nova senha deve ser diferente da senha atual.',
      });
    }

    try {
      // ======================================================
      // 1. Verifica cooldown
      // ======================================================

      const {
        data: profile,
        error: profileError,
      } =
        await supabaseAdmin
          .from('profiles')
          .select(
            'password_changed_at',
          )
          .eq(
            'id',
            userId,
          )
          .maybeSingle();

      if (profileError) {
        console.error(
          '[auth/password] erro ao buscar profile:',
          profileError,
        );

        return res.status(500).json({
          error:
            'Erro ao validar solicitação.',
        });
      }

      const remainingCooldown =
        getRemainingCooldownMs(
          profile?.password_changed_at,
        );

      if (
        remainingCooldown >
        0
      ) {
        const waitMinutes =
          getWaitMinutes(
            remainingCooldown,
          );

        return res.status(429).json({
          error:
            `Aguarde ${waitMinutes} minuto(s) antes de trocar a senha novamente.`,
          retryAfterSeconds:
            Math.ceil(
              remainingCooldown /
              1000,
            ),
        });
      }

      // ======================================================
      // 2. Busca usuário
      // ======================================================

      const {
        data: authUser,
        error: getUserError,
      } =
        await supabaseAdmin.auth.admin.getUserById(
          userId,
        );

      if (
        getUserError ||
        !authUser?.user?.email
      ) {
        console.error(
          '[auth/password] usuário não encontrado:',
          getUserError,
        );

        return res.status(404).json({
          error:
            'Usuário não encontrado.',
        });
      }

      // ======================================================
      // 3. Valida senha atual
      // ======================================================

      const verificationClient =
        createAuthVerificationClient();

      const {
        error: signInError,
      } =
        await verificationClient.auth.signInWithPassword(
          {
            email:
              authUser.user.email,
            password:
              currentPassword,
          },
        );

      if (signInError) {
        await logAction(
          userId,
          'CHANGE_PASSWORD_FAILED',
          'user',
          userId,
          {
            reason:
              'senha_atual_invalida',
          },
        );

        return res.status(401).json({
          error:
            'Senha atual incorreta.',
        });
      }

      // ======================================================
      // 4. Atualiza senha
      // ======================================================

      const {
        error: updateError,
      } =
        await supabaseAdmin.auth.admin.updateUserById(
          userId,
          {
            password:
              newPassword,
          },
        );

      if (updateError) {
        console.error(
          '[auth/password] erro ao atualizar senha:',
          updateError,
        );

        return res.status(500).json({
          error:
            'Erro ao atualizar senha.',
        });
      }

      // ======================================================
      // 5. Atualiza cooldown
      // ======================================================

      const changedAt =
        new Date().toISOString();

      const {
        error:
        cooldownError,
      } =
        await supabaseAdmin
          .from('profiles')
          .update({
            password_changed_at:
              changedAt,
          })
          .eq(
            'id',
            userId,
          );

      if (cooldownError) {
        /*
         * A senha já foi alterada.
         *
         * Não devolvemos erro para o usuário
         * como se a senha não tivesse mudado.
         *
         * Registramos o problema para investigação.
         */
        console.error(
          '[auth/password] senha alterada, mas não foi possível salvar cooldown:',
          cooldownError,
        );
      }

      // ======================================================
      // 6. Auditoria
      // ======================================================

      await logAction(
        userId,
        'CHANGE_PASSWORD',
        'user',
        userId,
      );

      return res.json({
        success: true,
      });
    } catch (error) {
      console.error(
        '[auth/password] erro inesperado:',
        error,
      );

      return res.status(500).json({
        error:
          'Erro interno ao alterar senha.',
      });
    }
  },
);

// ============================================================
// PUT /api/auth/email
// ============================================================

router.put(
  '/email',
  requireAuth,
  emailUserLimiter,
  emailIpLimiter,
  async (req, res) => {
    const userId =
      req.authUserId!;

    const {
      currentPassword,
      newEmail,
    } = req.body ?? {};

    // ========================================================
    // Validação
    // ========================================================

    if (
      typeof currentPassword !==
      'string' ||
      currentPassword.length ===
      0 ||
      currentPassword.length >
      MAX_PASSWORD_LENGTH
    ) {
      return res.status(400).json({
        error:
          'Informe a senha atual.',
      });
    }

    if (
      !isValidEmail(
        newEmail,
      )
    ) {
      return res.status(400).json({
        error:
          'Informe um login (e-mail) válido.',
      });
    }

    const normalizedNewEmail =
      normalizeEmail(
        newEmail,
      );

    try {
      // ======================================================
      // 1. Verifica cooldown
      // ======================================================

      const {
        data: profile,
        error: profileError,
      } =
        await supabaseAdmin
          .from('profiles')
          .select(
            'email_changed_at',
          )
          .eq(
            'id',
            userId,
          )
          .maybeSingle();

      if (profileError) {
        console.error(
          '[auth/email] erro ao buscar profile:',
          profileError,
        );

        return res.status(500).json({
          error:
            'Erro ao validar solicitação.',
        });
      }

      const remainingCooldown =
        getRemainingCooldownMs(
          profile?.email_changed_at,
        );

      if (
        remainingCooldown >
        0
      ) {
        const waitMinutes =
          getWaitMinutes(
            remainingCooldown,
          );

        return res.status(429).json({
          error:
            `Aguarde ${waitMinutes} minuto(s) antes de trocar o login novamente.`,
          retryAfterSeconds:
            Math.ceil(
              remainingCooldown /
              1000,
            ),
        });
      }

      // ======================================================
      // 2. Busca usuário
      // ======================================================

      const {
        data: authUser,
        error: getUserError,
      } =
        await supabaseAdmin.auth.admin.getUserById(
          userId,
        );

      if (
        getUserError ||
        !authUser?.user?.email
      ) {
        console.error(
          '[auth/email] usuário não encontrado:',
          getUserError,
        );

        return res.status(404).json({
          error:
            'Usuário não encontrado.',
        });
      }

      const currentEmail =
        normalizeEmail(
          authUser.user.email,
        );

      // ======================================================
      // 3. Verifica se realmente mudou
      // ======================================================

      if (
        currentEmail ===
        normalizedNewEmail
      ) {
        return res.status(400).json({
          error:
            'O novo login deve ser diferente do atual.',
        });
      }

      // ======================================================
      // 4. Confirma senha atual
      // ======================================================

      const verificationClient =
        createAuthVerificationClient();

      const {
        error: signInError,
      } =
        await verificationClient.auth.signInWithPassword(
          {
            email:
              authUser.user.email,
            password:
              currentPassword,
          },
        );

      if (signInError) {
        await logAction(
          userId,
          'CHANGE_EMAIL_FAILED',
          'user',
          userId,
          {
            reason:
              'senha_atual_invalida',
          },
        );

        return res.status(401).json({
          error:
            'Senha atual incorreta.',
        });
      }

      // ======================================================
      // 5. Atualiza e-mail
      // ======================================================

      const {
        error: updateError,
      } =
        await supabaseAdmin.auth.admin.updateUserById(
          userId,
          {
            email:
              normalizedNewEmail,

            /*
             * O usuário comprovou a posse da conta
             * através da senha atual.
             *
             * Como o sistema usa o e-mail como LOGIN,
             * a alteração é efetivada imediatamente.
             */
            email_confirm:
              true,
          },
        );

      if (updateError) {
        console.error(
          '[auth/email] erro ao atualizar login:',
          updateError,
        );

        /*
         * Não revelamos detalhes sobre
         * contas existentes.
         */
        return res.status(409).json({
          error:
            'Não foi possível utilizar este login.',
        });
      }

      // ======================================================
      // 6. Atualiza cooldown
      // ======================================================

      const changedAt =
        new Date().toISOString();

      const {
        error:
        cooldownError,
      } =
        await supabaseAdmin
          .from('profiles')
          .update({
            email_changed_at:
              changedAt,
          })
          .eq(
            'id',
            userId,
          );

      if (cooldownError) {
        console.error(
          '[auth/email] login alterado, mas não foi possível salvar cooldown:',
          cooldownError,
        );
      }

      // ======================================================
      // 7. Auditoria
      // ======================================================

      /*
       * Não armazenamos o novo e-mail
       * no audit log desnecessariamente.
       */
      await logAction(
        userId,
        'CHANGE_EMAIL',
        'user',
        userId,
        {
          changed: true,
        },
      );

      return res.json({
        success: true,
        email:
          normalizedNewEmail,
      });
    } catch (error) {
      console.error(
        '[auth/email] erro inesperado:',
        error,
      );

      return res.status(500).json({
        error:
          'Erro interno ao alterar login.',
      });
    }
  },
);

export default router;
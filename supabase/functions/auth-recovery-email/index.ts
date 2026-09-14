// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveStoreUserId } from "../_shared/multi-store.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizeBaseUrl(value: string | null | undefined) {
  const fallback = "https://popsystem.com.br";
  try {
    const url = new URL(String(value || fallback));
    if (url.protocol !== "http:" && url.protocol !== "https:") return fallback;
    const allowedHosts = new Set([
      "popsystem.com.br",
      "www.popsystem.com.br",
      "boracume.com",
      "www.boracume.com",
      "boracume-pdv-system.vercel.app",
      "localhost",
      "127.0.0.1",
    ]);
    if (!allowedHosts.has(url.hostname) && !url.hostname.endsWith(".vercel.app")) return fallback;
    return url.toString().replace(/\/+$/, "");
  } catch {
    return fallback;
  }
}

function sanitizeEmail(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function buildEmailHtml(actionLink: string, baseUrl: string, mode: "password" | "operator_pin", operatorName = "") {
  const logoUrl = `${baseUrl}/LOGOMARCA/logo-pop.webp`;
  const safeLink = escapeHtml(actionLink);
  const safeLogo = escapeHtml(logoUrl);
  const isPinRecovery = mode === "operator_pin";
  const safeOperatorName = escapeHtml(operatorName);
  const title = isPinRecovery ? "Redefinição de PIN" : "Redefinição de senha";
  const description = isPinRecovery
    ? `Recebemos uma solicitação para alterar o PIN do operador <strong>${safeOperatorName}</strong>. Clique no botão abaixo para cadastrar um novo PIN com segurança.`
    : "Recebemos uma solicitação para alterar a senha de acesso ao PopSystem. Clique no botão abaixo para criar uma nova senha com segurança.";
  const buttonLabel = isPinRecovery ? "Redefinir PIN do operador" : "Redefinir minha senha";
  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title} PopSystem</title>
  </head>
  <body style="margin:0;background:#f6f7f3;font-family:Arial,Helvetica,sans-serif;color:#12382b;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6f7f3;padding:32px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #e4e0d6;border-radius:18px;overflow:hidden;">
            <tr>
              <td style="background:#00452f;padding:28px 32px;text-align:center;">
                <img src="${safeLogo}" width="190" alt="PopSystem" style="display:inline-block;max-width:190px;height:auto;" />
              </td>
            </tr>
            <tr>
              <td style="padding:34px 32px 10px;">
                <h1 style="margin:0 0 12px;font-size:26px;line-height:1.2;color:#063f2d;">${title}</h1>
                <p style="margin:0 0 18px;font-size:16px;line-height:1.6;color:#435366;">
                  ${description}
                </p>
                <p style="margin:0 0 28px;font-size:14px;line-height:1.6;color:#667085;">
                  Por segurança, use este link somente se você fez essa solicitação. Caso contrário, ignore este e-mail.
                </p>
                <table role="presentation" cellspacing="0" cellpadding="0">
                  <tr>
                    <td style="border-radius:12px;background:#ff6400;">
                      <a href="${safeLink}" style="display:inline-block;padding:14px 22px;font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:12px;">
                        ${buttonLabel}
                      </a>
                    </td>
                  </tr>
                </table>
                <p style="margin:28px 0 0;font-size:13px;line-height:1.6;color:#667085;">
                  Se o botão não abrir, copie e cole este link no navegador:<br />
                  <a href="${safeLink}" style="color:#0b7a53;word-break:break-all;">${safeLink}</a>
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 30px;color:#8a94a6;font-size:12px;line-height:1.5;">
                PopSystem PDV - tecnologia para restaurantes.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const recoveryMode = body.mode === "operator_pin" ? "operator_pin" : "password";
    let email = sanitizeEmail(body.email);
    let redirectTo = normalizeBaseUrl(body.redirectTo);
    let operatorName = "";

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || Deno.env.get("BORACUME_SUPABASE_URL");
    const serviceKey = Deno.env.get("SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    const fromEmail = Deno.env.get("RESEND_FROM_EMAIL") || "PopSystem <relatorios@popsystem.com.br>";
    const publicBaseUrl = normalizeBaseUrl(Deno.env.get("PUBLIC_WEB_BASE_URL") || Deno.env.get("VITE_PUBLIC_WEB_BASE_URL"));

    if (!supabaseUrl || !serviceKey) return json({ error: "Configuração Supabase ausente." }, 500);
    if (!resendApiKey) return json({ error: "RESEND_API_KEY não configurada." }, 500);

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    if (recoveryMode === "operator_pin") {
      const operatorId = String(body.operatorId || "").trim();
      const accessToken = String(req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
      if (!operatorId || !accessToken) return json({ error: "Solicitação de recuperação inválida." }, 401);

      const { data: authData, error: authError } = await admin.auth.getUser(accessToken);
      const accountUser = authData?.user;
      if (authError || !accountUser?.id) {
        return json({ error: "Sua sessão expirou. Entre novamente na conta do restaurante." }, 401);
      }

      let storeUserId = accountUser.id;
      try {
        storeUserId = await resolveStoreUserId(admin, accountUser.id, body._storeId);
      } catch {
        return json({ error: "Você não possui acesso a esta loja." }, 403);
      }

      const { data: operator, error: operatorError } = await admin
        .from("waiters")
        .select("id,name")
        .eq("id", operatorId)
        .eq("user_id", storeUserId)
        .eq("active", true)
        .maybeSingle();

      if (operatorError || !operator) return json({ error: "Operador não encontrado nesta loja." }, 404);

      const { data: storeOwnerData, error: storeOwnerError } = await admin.auth.admin.getUserById(storeUserId);
      const storeOwner = storeOwnerData?.user;
      if (storeOwnerError || !storeOwner?.email) {
        return json({ error: "A loja não possui um e-mail responsável disponível para recuperação." }, 409);
      }

      email = sanitizeEmail(storeOwner.email);
      operatorName = String(operator.name || "Administrador");
      const resetUrl = new URL("/reset-password", redirectTo);
      resetUrl.searchParams.set("mode", "operator-pin");
      resetUrl.searchParams.set("operatorId", operatorId);
      resetUrl.searchParams.set("storeId", storeUserId);
      redirectTo = resetUrl.toString();
    }

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ error: "Informe um e-mail válido." }, 400);
    }

    const { data, error } = await admin.auth.admin.generateLink({
      type: "recovery",
      email,
      options: { redirectTo },
    });

    if (error) {
      console.error("generate recovery link error", error);
      return json({ ok: true });
    }

    const actionLink = (data as any)?.properties?.action_link;
    if (!actionLink) {
      console.error("recovery link missing", data);
      return json({ error: "Não foi possível gerar o link de recuperação." }, 500);
    }

    const emailResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [email],
        subject: recoveryMode === "operator_pin" ? "Redefina o PIN do operador no PopSystem" : "Recupere sua senha do PopSystem",
        html: buildEmailHtml(actionLink, publicBaseUrl, recoveryMode, operatorName),
      }),
    });

    if (!emailResponse.ok) {
      const details = await emailResponse.text();
      console.error("resend recovery email error", emailResponse.status, details);
      return json({ error: "Não foi possível enviar o e-mail agora." }, 500);
    }

    return json({ ok: true });
  } catch (error) {
    console.error("auth recovery email error", error);
    return json({ error: "Erro interno ao enviar recuperação de senha." }, 500);
  }
});

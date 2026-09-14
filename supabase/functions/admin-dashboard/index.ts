// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

const DEFAULT_ADMIN_EMAIL = "admin@popsystem.com.br";
const DEFAULT_ADMIN_PASSWORD = "__configure_POP_SYSTEM_ADMIN_PASSWORD_secret__";
const TOKEN_TTL_MS = 6 * 60 * 60 * 1000;

function json(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: corsHeaders,
  });
}

function normalizeStatus(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function numeric(value: unknown) {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function dateMs(value: unknown) {
  const ms = new Date(String(value || "")).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function startOfDay(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfMonth(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function addMonths(date: Date, months: number) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

function maxDateIso(...values: unknown[]) {
  const max = values.reduce<number>((latest, value) => Math.max(latest, dateMs(value)), 0);
  return max ? new Date(max).toISOString() : null;
}

function cleanText(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function locationFromPostalRecord(fiscalSettings: any) {
  const postalCode = String(fiscalSettings?.endereco_cep || "").replace(/\D/g, "");
  const city = cleanText(fiscalSettings?.endereco_municipio).slice(0, 100);
  const state = cleanText(fiscalSettings?.endereco_uf).toUpperCase().slice(0, 2);
  if (postalCode.length !== 8 || !city || !/^[A-Z]{2}$/.test(state)) {
    return { postalCode: "", city: "Não informado", state: "NI", locationVerifiedByPostalCode: false };
  }
  return { postalCode, city, state, locationVerifiedByPostalCode: true };
}

function groupCount<T>(items: T[], keyGetter: (item: T) => string) {
  const map = new Map<string, number>();
  for (const item of items) {
    const key = keyGetter(item) || "Não informado";
    map.set(key, (map.get(key) || 0) + 1);
  }
  return Array.from(map.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
}

function dayKey(value: unknown) {
  const ms = dateMs(value);
  if (!ms) return "";
  return new Date(ms).toISOString().slice(0, 10);
}

function buildDailySeries(days: number, date = new Date(), rows: any[], dateField: string, label: string) {
  const dates = Array.from({ length: days }, (_, index) => {
    const day = addDays(date, index - days + 1);
    return day.toISOString().slice(0, 10);
  });
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = dayKey(row?.[dateField]);
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return dates.map((dateKey) => ({
    date: dateKey.slice(5).split("-").reverse().join("/"),
    [label]: counts.get(dateKey) || 0,
  }));
}

function stableStringify(value: unknown) {
  return JSON.stringify(value);
}

async function hmacHex(secret: string, payload: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return Array.from(new Uint8Array(signature)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function getAdminConfig() {
  const emails = String(Deno.env.get("POPSYSTEM_ADMIN_EMAILS") || DEFAULT_ADMIN_EMAIL)
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  const password = String(Deno.env.get("POPSYSTEM_ADMIN_PASSWORD") || DEFAULT_ADMIN_PASSWORD);
  const tokenSecret = String(Deno.env.get("POPSYSTEM_ADMIN_TOKEN_SECRET") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || password);
  return { emails, password, tokenSecret };
}

async function createToken(email: string, role = "owner", memberId: string | null = null) {
  const { tokenSecret } = getAdminConfig();
  const exp = Date.now() + TOKEN_TTL_MS;
  const payload = stableStringify({ email: email.toLowerCase(), role, memberId, exp });
  const sig = await hmacHex(tokenSecret, payload);
  return btoa(`${payload}.${sig}`);
}

async function verifyToken(token: string) {
  if (!token) return null;
  try {
    const decoded = atob(token);
    const dot = decoded.lastIndexOf(".");
    if (dot <= 0) return null;
    const payload = decoded.slice(0, dot);
    const sig = decoded.slice(dot + 1);
    const { tokenSecret, emails } = getAdminConfig();
    const expected = await hmacHex(tokenSecret, payload);
    if (sig !== expected) return null;
    const parsed = JSON.parse(payload);
    const email = String(parsed?.email || "").toLowerCase();
    const exp = Number(parsed?.exp || 0);
    if (!emails.includes(email) || !Number.isFinite(exp) || exp < Date.now()) return null;
    return { email, role: String(parsed?.role || "owner"), memberId: parsed?.memberId || null };
  } catch {
    return null;
  }
}

async function authenticate(body: any, req?: Request) {
  const token = String(body?.token || "").trim();
  const tokenUser = await verifyToken(token);
  if (tokenUser) return tokenUser;

  const email = String(body?.email || "").trim().toLowerCase();
  const password = String(body?.password || "");
  const { emails, password: expectedPassword } = getAdminConfig();
  if (emails.includes(email) && password === expectedPassword) {
    return { email, role: "owner", memberId: null };
  }
  const bearer = String(req?.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (bearer) {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const { data: authData } = await admin.auth.getUser(bearer);
    if (authData?.user?.id) {
      const { data: member } = await admin.from("internal_admin_members").select("id,email,display_name,role,permissions,active").eq("auth_user_id", authData.user.id).eq("active", true).maybeSingle();
      if (member) return { email: member.email, memberId: member.id, role: member.role, permissions: member.permissions };
    }
  }
  return null;
}

async function listAuthUsers(supabase: any) {
  const users: any[] = [];
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) break;
    const batch = Array.isArray(data?.users) ? data.users : [];
    users.push(...batch);
    if (batch.length < 1000) break;
  }
  return users;
}

function isPaidStatus(status: string) {
  return ["active", "paid", "trialing_paid", "current"].includes(status);
}

function isTrialStatus(status: string) {
  return status.includes("trial") || status === "teste";
}

function isDelinquentStatus(status: string, subscription: any, nowMs: number) {
  if (["past_due", "unpaid", "overdue", "inadimplente", "blocked", "suspended"].includes(status)) return true;
  const trialEnd = dateMs(subscription?.trial_end);
  if (isTrialStatus(status) && (!trialEnd || trialEnd < nowMs)) return true;
  const periodEnd = dateMs(subscription?.current_period_end);
  if (periodEnd && periodEnd < nowMs && !isTrialStatus(status)) return true;
  return false;
}

function billingPeriodEnd(subscription: any) {
  const status = normalizeStatus(subscription?.status);
  return isTrialStatus(status) ? subscription?.trial_end || null : subscription?.current_period_end || null;
}

function hasSubscriptionAccess(subscription: any, nowMs = Date.now()) {
  if (!subscription) return false;
  if (subscription.billing_exempt === true) return true;
  if (dateMs(subscription.access_override_until) > nowMs) return true;
  const status = normalizeStatus(subscription.status);
  if (isTrialStatus(status)) return dateMs(subscription.trial_end) > nowMs;
  if (isPaidStatus(status)) return dateMs(subscription.current_period_end) > nowMs;
  return false;
}

function financialStatus(subscription: any, invoices: any[], nowMs = Date.now()) {
  const latest = invoices[0];
  const invoiceStatus = normalizeStatus(latest?.status);
  if (["received", "confirmed", "paid"].includes(invoiceStatus)) return "paid";
  if (["refunded", "refund_requested"].includes(invoiceStatus)) return "refunded";
  if (["chargeback_requested", "chargeback_dispute", "awaiting_chargeback_reversal"].includes(invoiceStatus)) return "chargeback";
  if (latest?.due_date && dateMs(`${latest.due_date}T23:59:59`) < nowMs) return "overdue";
  if (latest) return "pending";
  return isPaidStatus(normalizeStatus(subscription?.status)) ? "paid_period" : "unknown";
}

function healthForClient(params: { accessAllowed: boolean; financial: string; lastActivityAt: string | null; lastOrderAt: string | null; openTickets: number; nfceRejected: number }) {
  let score = 100;
  const reasons: string[] = [];
  const days = (value: string | null) => value ? Math.floor((Date.now() - dateMs(value)) / 86400000) : 9999;
  if (!params.accessAllowed) { score -= 35; reasons.push("acesso bloqueado"); }
  if (["overdue", "chargeback"].includes(params.financial)) { score -= 30; reasons.push("pendência financeira"); }
  if (days(params.lastActivityAt) >= 7) { score -= 15; reasons.push("sem atividade há 7 dias"); }
  if (days(params.lastOrderAt) >= 7) { score -= 10; reasons.push("sem pedidos há 7 dias"); }
  if (params.openTickets > 0) { score -= Math.min(15, params.openTickets * 5); reasons.push("chamado em aberto"); }
  if (params.nfceRejected > 0) { score -= 10; reasons.push("NFC-e rejeitada"); }
  score = Math.max(0, score);
  return { score, classification: score >= 80 ? "healthy" : score >= 60 ? "attention" : score >= 35 ? "risk" : "critical", reasons };
}

function toClientRow(params: {
  profile: any;
  subscription: any;
  plan: any;
  authUser: any;
  orders: any[];
  monthOrders: any[];
  productsCount: number;
  customersCount: number;
  whatsappEnabled: boolean;
  nfceAuthorizedMonth: number;
  nfceRejectedMonth: number;
  invoices?: any[];
  lastActivityAt?: string | null;
  openTickets?: number;
  assignment?: any;
  fiscalSettings?: any;
}) {
  const lastOrderAt = params.orders.reduce((latest, order) => Math.max(latest, dateMs(order.created_at)), 0);
  const status = normalizeStatus(params.subscription?.status || "sem_assinatura");
  const lastAccessAt = params.lastActivityAt || params.authUser?.last_sign_in_at || null;
  const accessAllowed = hasSubscriptionAccess(params.subscription);
  const financial = financialStatus(params.subscription, params.invoices || []);
  const health = healthForClient({ accessAllowed, financial, lastActivityAt: lastAccessAt, lastOrderAt: lastOrderAt ? new Date(lastOrderAt).toISOString() : null, openTickets: params.openTickets || 0, nfceRejected: params.nfceRejectedMonth });
  const periodEnd = billingPeriodEnd(params.subscription);
  const overdueDays = !accessAllowed && periodEnd && dateMs(periodEnd) < Date.now() ? Math.max(0, Math.floor((Date.now() - dateMs(periodEnd)) / 86400000)) : 0;
  const location = locationFromPostalRecord(params.fiscalSettings);
  return {
    id: params.profile.id,
    restaurantName: params.profile.restaurant_name || "Restaurante sem nome",
    email: params.profile.email || params.authUser?.email || "",
    phone: params.profile.owner_phone || params.profile.phone || "",
    ownerPhone: params.profile.owner_phone || "",
    restaurantPhone: params.profile.phone || "",
    address: params.profile.address || "",
    ...location,
    createdAt: params.profile.created_at,
    updatedAt: params.profile.updated_at || null,
    lastSignInAt: params.authUser?.last_sign_in_at || null,
    lastAccessAt,
    subscriptionStatus: status,
    planName: params.plan?.name || (params.subscription?.plan_id ? `Plano ${params.subscription.plan_id}` : "Sem plano"),
    planPrice: numeric(params.plan?.price),
    trialEnd: params.subscription?.trial_end || null,
    currentPeriodEnd: params.subscription?.current_period_end || null,
    accessOverrideUntil: params.subscription?.access_override_until || null,
    accessAllowed,
    accessStatus: accessAllowed ? (dateMs(params.subscription?.access_override_until) > Date.now() ? "temporary_release" : "allowed") : "blocked",
    financialStatus: financial,
    billingAmount: numeric(params.subscription?.billing_amount || params.plan?.price),
    paymentMethod: params.subscription?.payment_method || null,
    overdueDays,
    healthScore: health.score,
    healthClassification: health.classification,
    healthReasons: health.reasons,
    ownerName: params.assignment?.internal_admin_members?.display_name || null,
    ownerEmail: params.assignment?.internal_admin_members?.email || null,
    commercialStage: params.assignment?.commercial_stage || (isTrialStatus(status) ? "trial" : "customer"),
    onboardingStage: params.assignment?.onboarding_stage || (lastOrderAt ? "operational" : "registered"),
    priority: params.assignment?.priority || "normal",
    nextAction: params.assignment?.next_action || null,
    nextActionAt: params.assignment?.next_action_at || null,
    openTickets: params.openTickets || 0,
    latestInvoice: params.invoices?.[0] || null,
    ordersMonth: params.monthOrders.length,
    lastOrderAt: lastOrderAt ? new Date(lastOrderAt).toISOString() : null,
    productsCount: params.productsCount,
    customersCount: params.customersCount,
    whatsappEnabled: params.whatsappEnabled,
    nfceAuthorizedMonth: params.nfceAuthorizedMonth,
    nfceRejectedMonth: params.nfceRejectedMonth,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const user = await authenticate(body, req);
    if (!user) return json({ ok: false, error: "Login interno inválido." }, 401);
    if (user.role === "representative") {
      return json({ ok: false, error: "Representantes devem usar o portal exclusivo." }, 403);
    }
    const canMutate = user.role !== "viewer";
    const canFinance = ["owner", "finance"].includes(user.role);
    const canAssign = ["owner", "operations", "success"].includes(user.role);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    if (body?.action === "login") {
      return json({ ok: true, token: await createToken(user.email, user.role, user.memberId), user });
    }

    if (body?.action === "create_representative") {
      if (user.role !== "owner") return json({ ok: false, error: "Somente o proprietário pode criar representantes." }, 403);
      const representativeName = cleanText(body?.name);
      const representativeEmail = cleanText(body?.email).toLowerCase();
      const representativePassword = String(body?.password || "");
      if (representativeName.length < 2 || !representativeEmail.includes("@") || representativePassword.length < 8) {
        return json({ ok: false, error: "Informe nome, e-mail válido e senha com pelo menos 8 caracteres." }, 400);
      }

      const { data: created, error: createError } = await supabase.auth.admin.createUser({
        email: representativeEmail,
        password: representativePassword,
        email_confirm: true,
        user_metadata: { full_name: representativeName, internal_account_type: "representative" },
      });
      if (createError || !created.user) return json({ ok: false, error: createError?.message || "Representante não criado." }, 409);

      const { data: member, error: memberError } = await supabase.from("internal_admin_members").insert({
        auth_user_id: created.user.id,
        email: representativeEmail,
        display_name: representativeName,
        role: "representative",
        permissions: { representative_portal: true },
        active: true,
      }).select("id,email,display_name,role,active").single();
      if (memberError || !member) {
        await supabase.auth.admin.deleteUser(created.user.id);
        return json({ ok: false, error: memberError?.message || "Acesso do representante não criado." }, 500);
      }
      await supabase.from("internal_admin_audit_events").insert({
        actor_email: user.email,
        action: "representative_created",
        entity_type: "internal_admin_member",
        entity_id: member.id,
        after_data: member,
      });
      return json({ ok: true, representative: member });
    }

    if (body?.action === "grant_subscription_access_24h") {
      if (!canFinance) return json({ ok: false, error: "Seu perfil não pode liberar acesso financeiro." }, 403);
      const restaurantId = cleanText(body?.restaurantId);
      if (!restaurantId) return json({ ok: false, error: "Restaurante não informado." }, 400);

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("id,restaurant_name,email")
        .eq("id", restaurantId)
        .maybeSingle();
      if (profileError || !profile?.id) return json({ ok: false, error: "Restaurante não encontrado." }, 404);

      const { data: subscription, error: subscriptionError } = await supabase
        .from("subscriptions")
        .select("*")
        .eq("user_id", profile.id)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (subscriptionError || !subscription?.id) return json({ ok: false, error: "Assinatura não encontrada." }, 404);
      if (hasSubscriptionAccess(subscription)) {
        return json({ ok: false, error: "Esta conta já possui acesso liberado." }, 409);
      }

      const periodEnd = billingPeriodEnd(subscription);
      const grantedForPeriod = subscription.access_override_granted_for_period_end;
      const sameOverduePeriod = periodEnd
        ? dateMs(grantedForPeriod) === dateMs(periodEnd)
        : Boolean(subscription.access_override_granted_at);
      if (sameOverduePeriod) {
        return json({
          ok: false,
          error: "A liberação de 24 horas já foi usada neste vencimento. Agora é necessário confirmar o pagamento.",
        }, 409);
      }

      const grantedAt = new Date();
      const accessUntil = addDays(grantedAt, 1);
      const { data: updated, error: updateError } = await supabase
        .from("subscriptions")
        .update({
          access_override_until: accessUntil.toISOString(),
          access_override_granted_at: grantedAt.toISOString(),
          access_override_granted_for_period_end: periodEnd,
          access_override_granted_by: user.email,
          updated_at: grantedAt.toISOString(),
        })
        .eq("id", subscription.id)
        .select("id,access_override_until")
        .maybeSingle();
      if (updateError || !updated) return json({ ok: false, error: "Não foi possível liberar a conta." }, 500);

      await supabase.from("subscription_access_events").insert({
        subscription_id: subscription.id,
        user_id: profile.id,
        event_type: "temporary_release",
        actor: user.email,
        period_end: periodEnd,
        access_until: accessUntil.toISOString(),
        metadata: { restaurant_name: profile.restaurant_name, restaurant_email: profile.email },
      });
      await supabase.from("internal_admin_audit_events").insert({
        actor_email: user.email,
        action: "subscription_temporary_release",
        client_user_id: profile.id,
        entity_type: "subscription",
        entity_id: subscription.id,
        reason: cleanText(body?.reason || "Liberação emergencial solicitada pela equipe"),
        before_data: { access_override_until: subscription.access_override_until, period_end: periodEnd },
        after_data: { access_override_until: accessUntil.toISOString(), period_end: periodEnd },
      });

      return json({
        ok: true,
        restaurant: profile.restaurant_name || profile.email,
        accessUntil: accessUntil.toISOString(),
      });
    }

    if (body?.action === "add_client_note") {
      if (!canMutate) return json({ ok: false, error: "Perfil somente leitura." }, 403);
      const clientId = cleanText(body?.restaurantId);
      const content = cleanText(body?.content);
      const category = cleanText(body?.category || "general");
      if (!clientId || !content) return json({ ok: false, error: "Cliente e anotação são obrigatórios." }, 400);
      const { data: note, error } = await supabase.from("internal_client_notes").insert({ client_user_id: clientId, content, category, created_by_email: user.email }).select("*").single();
      if (error) throw error;
      await supabase.from("internal_admin_audit_events").insert({ actor_email: user.email, action: "client_note_created", client_user_id: clientId, entity_type: "internal_client_note", entity_id: note.id, after_data: note });
      return json({ ok: true, note });
    }

    if (body?.action === "create_client_task") {
      if (!canMutate) return json({ ok: false, error: "Perfil somente leitura." }, 403);
      const clientId = cleanText(body?.restaurantId);
      const title = cleanText(body?.title);
      if (!clientId || !title) return json({ ok: false, error: "Cliente e título são obrigatórios." }, 400);
      const { data: task, error } = await supabase.from("internal_client_tasks").insert({ client_user_id: clientId, title, description: cleanText(body?.description) || null, type: cleanText(body?.type || "follow_up"), priority: cleanText(body?.priority || "normal"), due_at: body?.dueAt || null, created_by_email: user.email }).select("*").single();
      if (error) throw error;
      await supabase.from("internal_admin_audit_events").insert({ actor_email: user.email, action: "client_task_created", client_user_id: clientId, entity_type: "internal_client_task", entity_id: task.id, after_data: task });
      return json({ ok: true, task });
    }

    if (body?.action === "assign_client") {
      if (!canAssign) return json({ ok: false, error: "Seu perfil não pode alterar responsáveis." }, 403);
      const clientId = cleanText(body?.restaurantId);
      const ownerMemberId = cleanText(body?.ownerMemberId) || null;
      const commercialStage = cleanText(body?.commercialStage || "customer");
      const onboardingStage = cleanText(body?.onboardingStage || "registered");
      const priority = cleanText(body?.priority || "normal");
      if (!clientId) return json({ ok: false, error: "Cliente não informado." }, 400);
      const { data: before } = await supabase.from("internal_client_assignments").select("*").eq("client_user_id", clientId).maybeSingle();
      const { data: assignment, error } = await supabase.from("internal_client_assignments").upsert({ client_user_id: clientId, owner_member_id: ownerMemberId, commercial_stage: commercialStage, onboarding_stage: onboardingStage, priority, next_action: cleanText(body?.nextAction) || null, next_action_at: body?.nextActionAt || null, updated_by: user.email, updated_at: new Date().toISOString() }, { onConflict: "client_user_id" }).select("*").single();
      if (error) throw error;
      await supabase.from("internal_admin_audit_events").insert({ actor_email: user.email, action: "client_assignment_updated", client_user_id: clientId, entity_type: "internal_client_assignment", entity_id: clientId, before_data: before, after_data: assignment });
      return json({ ok: true, assignment });
    }

    if (body?.action === "update_client_task") {
      if (!canMutate) return json({ ok: false, error: "Perfil somente leitura." }, 403);
      const taskId = cleanText(body?.taskId);
      const status = cleanText(body?.status);
      if (!taskId || !["open", "in_progress", "done", "cancelled"].includes(status)) return json({ ok: false, error: "Tarefa ou status inválido." }, 400);
      const { data: before } = await supabase.from("internal_client_tasks").select("*").eq("id", taskId).maybeSingle();
      if (!before) return json({ ok: false, error: "Tarefa não encontrada." }, 404);
      const { data: task, error } = await supabase.from("internal_client_tasks").update({ status, completed_at: status === "done" ? new Date().toISOString() : null, updated_at: new Date().toISOString() }).eq("id", taskId).select("*").single();
      if (error) throw error;
      await supabase.from("internal_admin_audit_events").insert({ actor_email: user.email, action: "client_task_updated", client_user_id: before.client_user_id, entity_type: "internal_client_task", entity_id: taskId, before_data: before, after_data: task });
      return json({ ok: true, task });
    }

    if (body?.action === "get_client_detail") {
      const clientId = cleanText(body?.restaurantId);
      if (!clientId) return json({ ok: false, error: "Cliente não informado." }, 400);
      const [notes, tasks, tickets, accessEvents, invoices, activity, audit] = await Promise.all([
        supabase.from("internal_client_notes").select("*").eq("client_user_id", clientId).order("created_at", { ascending: false }).limit(100),
        supabase.from("internal_client_tasks").select("*").eq("client_user_id", clientId).order("created_at", { ascending: false }).limit(100),
        supabase.from("support_tickets").select("id,subject,message,priority,status,created_at,updated_at").eq("user_id", clientId).order("created_at", { ascending: false }).limit(100),
        supabase.from("subscription_access_events").select("*").eq("user_id", clientId).order("created_at", { ascending: false }).limit(100),
        supabase.from("subscription_invoices").select("*").eq("user_id", clientId).order("due_date", { ascending: false }).limit(100),
        supabase.from("client_activity_events").select("event_type,source,occurred_at,metadata").eq("client_user_id", clientId).order("occurred_at", { ascending: false }).limit(200),
        supabase.from("internal_admin_audit_events").select("*").eq("client_user_id", clientId).order("created_at", { ascending: false }).limit(100),
      ]);
      return json({ ok: true, detail: { notes: notes.data || [], tasks: tasks.data || [], tickets: tickets.data || [], accessEvents: accessEvents.data || [], invoices: invoices.data || [], activity: activity.data || [], audit: audit.data || [] } });
    }

    const now = new Date();
    const nowMs = now.getTime();
    const today = startOfDay(now);
    const monthStart = startOfMonth(now);
    const nextMonthStart = addMonths(monthStart, 1);
    const sevenDaysAgo = addDays(now, -7);
    const thirtyDaysAgo = addDays(now, -30);
    const nextSevenDays = addDays(now, 7);

    const [
      authUsers,
      profilesResp,
      subscriptionsResp,
      plansResp,
      ordersResp,
      productsResp,
      customersResp,
      whatsappResp,
      nfceResp,
      assignmentsResp,
      invoicesResp,
      activityResp,
      ticketsResp,
      tasksResp,
      membersResp,
      fiscalSettingsResp,
      commercialLeadsResp,
      representativeVisitsResp,
    ] = await Promise.all([
      listAuthUsers(supabase),
      supabase.from("profiles").select("id, restaurant_name, email, owner_phone, phone, address, created_at, updated_at").order("created_at", { ascending: false }).limit(5000),
      supabase.from("subscriptions").select("id, user_id, status, plan_id, trial_start, trial_end, current_period_start, current_period_end, billing_exempt, access_override_until, access_override_granted_at, access_override_granted_for_period_end, created_at, updated_at").limit(5000),
      supabase.from("subscription_plans").select("id, name, price").limit(100),
      supabase.from("orders").select("id, user_id, status, created_at, order_type").gte("created_at", addDays(now, -365).toISOString()).limit(50000),
      supabase.from("products").select("id, user_id, available").limit(50000),
      supabase.from("customers").select("id, user_id, created_at").limit(50000),
      supabase.from("whatsapp_settings").select("user_id, enabled, phone_number, updated_at").limit(5000),
      supabase.from("nfce_cupons").select("id, user_id, status, valor_total, created_at").gte("created_at", monthStart.toISOString()).limit(20000),
      supabase.from("internal_client_assignments").select("*,internal_admin_members(display_name,email)").limit(5000),
      supabase.from("subscription_invoices").select("*").order("due_date", { ascending: false }).limit(20000),
      supabase.from("client_activity_events").select("client_user_id,occurred_at,event_type").gte("occurred_at", addDays(now, -90).toISOString()).order("occurred_at", { ascending: false }).limit(50000),
      supabase.from("support_tickets").select("id,user_id,status,priority,created_at,updated_at").limit(20000),
      supabase.from("internal_client_tasks").select("id,client_user_id,status,due_at,priority").neq("status", "done").neq("status", "cancelled").limit(20000),
      supabase.from("internal_admin_members").select("id,email,display_name,role,active").eq("active", true).order("display_name"),
      supabase.from("fiscal_settings").select("user_id,endereco_cep,endereco_municipio,endereco_uf").limit(5000),
      supabase.from("commercial_leads").select("*,internal_admin_members(display_name,email)").order("updated_at", { ascending: false }).limit(5000),
      supabase.from("representative_visits").select("id,lead_id,representative_member_id,visited_at,outcome").order("visited_at", { ascending: false }).limit(10000),
    ]);

    const profiles = Array.isArray(profilesResp.data) ? profilesResp.data : [];
    const subscriptions = Array.isArray(subscriptionsResp.data) ? subscriptionsResp.data : [];
    const plans = Array.isArray(plansResp.data) ? plansResp.data : [];
    const orders = Array.isArray(ordersResp.data) ? ordersResp.data : [];
    const products = Array.isArray(productsResp.data) ? productsResp.data : [];
    const customers = Array.isArray(customersResp.data) ? customersResp.data : [];
    const whatsappSettings = Array.isArray(whatsappResp.data) ? whatsappResp.data : [];
    const nfce = Array.isArray(nfceResp.data) ? nfceResp.data : [];
    const assignments = Array.isArray(assignmentsResp.data) ? assignmentsResp.data : [];
    const invoices = Array.isArray(invoicesResp.data) ? invoicesResp.data : [];
    const activities = Array.isArray(activityResp.data) ? activityResp.data : [];
    const tickets = Array.isArray(ticketsResp.data) ? ticketsResp.data : [];
    const tasks = Array.isArray(tasksResp.data) ? tasksResp.data : [];
    const members = Array.isArray(membersResp.data) ? membersResp.data : [];
    const fiscalSettings = Array.isArray(fiscalSettingsResp.data) ? fiscalSettingsResp.data : [];
    const commercialLeads = Array.isArray(commercialLeadsResp.data) ? commercialLeadsResp.data : [];
    const representativeVisits = Array.isArray(representativeVisitsResp.data) ? representativeVisitsResp.data : [];

    const subscriptionByUser = new Map<string, any>();
    for (const subscription of subscriptions.sort((a: any, b: any) => dateMs(b.updated_at) - dateMs(a.updated_at))) {
      if (!subscriptionByUser.has(subscription.user_id)) subscriptionByUser.set(subscription.user_id, subscription);
    }
    const planById = new Map(plans.map((p: any) => [Number(p.id), p]));
    const authById = new Map(authUsers.map((u: any) => [u.id, u]));
    const assignmentByUser = new Map(assignments.map((row: any) => [row.client_user_id, row]));
    const fiscalSettingsByUser = new Map(fiscalSettings.map((row: any) => [row.user_id, row]));
    const invoicesByUser = new Map<string, any[]>();
    invoices.forEach((row: any) => { const list = invoicesByUser.get(row.user_id) || []; list.push(row); invoicesByUser.set(row.user_id, list); });
    const latestActivityByUser = new Map<string, string>();
    activities.forEach((row: any) => { if (!latestActivityByUser.has(row.client_user_id)) latestActivityByUser.set(row.client_user_id, row.occurred_at); });
    const openTicketsByUser = new Map<string, number>();
    tickets.filter((row: any) => !["closed", "resolved"].includes(normalizeStatus(row.status))).forEach((row: any) => openTicketsByUser.set(row.user_id, (openTicketsByUser.get(row.user_id) || 0) + 1));

    const ordersByUser = new Map<string, any[]>();
    const monthOrdersByUser = new Map<string, any[]>();
    for (const order of orders) {
      const userId = String(order.user_id || "");
      if (!userId) continue;
      if (!ordersByUser.has(userId)) ordersByUser.set(userId, []);
      ordersByUser.get(userId)!.push(order);
      const created = dateMs(order.created_at);
      if (created >= monthStart.getTime() && created < nextMonthStart.getTime()) {
        if (!monthOrdersByUser.has(userId)) monthOrdersByUser.set(userId, []);
        monthOrdersByUser.get(userId)!.push(order);
      }
    }

    const countByUser = (rows: any[]) => {
      const map = new Map<string, number>();
      for (const row of rows) {
        const userId = String(row.user_id || "");
        if (!userId) continue;
        map.set(userId, (map.get(userId) || 0) + 1);
      }
      return map;
    };

    const productsByUser = countByUser(products);
    const customersByUser = countByUser(customers);
    const whatsappByUser = new Map(whatsappSettings.map((w: any) => [w.user_id, Boolean(w.enabled && w.phone_number)]));
    const nfceAuthorizedByUser = new Map<string, number>();
    const nfceRejectedByUser = new Map<string, number>();
    for (const coupon of nfce) {
      const userId = String(coupon.user_id || "");
      const status = normalizeStatus(coupon.status);
      if (["autorizado", "authorized", "aprovado"].includes(status)) {
        nfceAuthorizedByUser.set(userId, (nfceAuthorizedByUser.get(userId) || 0) + 1);
      }
      if (["rejeitado", "rejected", "erro", "error"].includes(status)) {
        nfceRejectedByUser.set(userId, (nfceRejectedByUser.get(userId) || 0) + 1);
      }
    }

    const clients = profiles.map((profile: any) => {
      const subscription = subscriptionByUser.get(profile.id);
      return toClientRow({
        profile,
        subscription,
        plan: planById.get(Number(subscription?.plan_id || 0)),
        authUser: authById.get(profile.id),
        orders: ordersByUser.get(profile.id) || [],
        monthOrders: monthOrdersByUser.get(profile.id) || [],
        productsCount: productsByUser.get(profile.id) || 0,
        customersCount: customersByUser.get(profile.id) || 0,
        whatsappEnabled: Boolean(whatsappByUser.get(profile.id)),
        nfceAuthorizedMonth: nfceAuthorizedByUser.get(profile.id) || 0,
        nfceRejectedMonth: nfceRejectedByUser.get(profile.id) || 0,
        invoices: invoicesByUser.get(profile.id) || [],
        lastActivityAt: latestActivityByUser.get(profile.id) || null,
        openTickets: openTicketsByUser.get(profile.id) || 0,
        assignment: assignmentByUser.get(profile.id),
        fiscalSettings: fiscalSettingsByUser.get(profile.id),
      });
    });

    if (clients.length) {
      await supabase.from("client_health_snapshots").upsert(clients.map((client: any) => ({
        client_user_id: client.id,
        score: client.healthScore,
        classification: client.healthClassification,
        reasons: client.healthReasons,
        metrics: {
          access_status: client.accessStatus,
          financial_status: client.financialStatus,
          orders_month: client.ordersMonth,
          open_tickets: client.openTickets,
          nfce_rejected_month: client.nfceRejectedMonth,
        },
        snapshot_date: now.toISOString().slice(0, 10),
        calculated_at: now.toISOString(),
      })), { onConflict: "client_user_id,snapshot_date" });
    }

    const activeClients = clients.filter((client: any) => client.accessAllowed === true && !isTrialStatus(client.subscriptionStatus));
    const trialClients = clients.filter((client: any) => isTrialStatus(client.subscriptionStatus));
    const delinquentClients = clients.filter((client: any) => isDelinquentStatus(client.subscriptionStatus, subscriptionByUser.get(client.id), nowMs));
    const newToday = clients.filter((client: any) => dateMs(client.createdAt) >= today.getTime());
    const newMonth = clients.filter((client: any) => dateMs(client.createdAt) >= monthStart.getTime());
    const paidThisMonth = clients.filter((client: any) => {
      const sub = subscriptionByUser.get(client.id);
      const status = normalizeStatus(sub?.status);
      const paidInvoice = (invoicesByUser.get(client.id) || []).some((invoice: any) => ["received", "confirmed", "paid"].includes(normalizeStatus(invoice.status)) && dateMs(invoice.paid_at || invoice.updated_at) >= monthStart.getTime());
      return paidInvoice || (isPaidStatus(status) && dateMs(sub?.current_period_start) >= monthStart.getTime());
    });
    const trialExpiring = clients.filter((client: any) => {
      const trialEnd = dateMs(client.trialEnd);
      return isTrialStatus(client.subscriptionStatus) && trialEnd >= nowMs && trialEnd <= nextSevenDays.getTime();
    });
    const accessedToday = clients.filter((client: any) => dateMs(client.lastAccessAt) >= today.getTime());
    const accessed7Days = clients.filter((client: any) => dateMs(client.lastAccessAt) >= sevenDaysAgo.getTime());
    const accessed30Days = clients.filter((client: any) => dateMs(client.lastAccessAt) >= thirtyDaysAgo.getTime());
    const noAccess7Days = clients.filter((client: any) => {
      const last = dateMs(client.lastAccessAt);
      return !last || last < sevenDaysAgo.getTime();
    });
    const noAccess30Days = clients.filter((client: any) => {
      const last = dateMs(client.lastAccessAt);
      return !last || last < thirtyDaysAgo.getTime();
    });
    const neverAccessed = clients.filter((client: any) => !client.lastAccessAt);
    const noOrders7Days = clients.filter((client: any) => {
      const last = dateMs(client.lastOrderAt);
      return !last || last < sevenDaysAgo.getTime();
    });

    const ordersMonth = clients.reduce((sum: number, client: any) => sum + Number(client.ordersMonth || 0), 0);
    const mrr = activeClients.reduce((sum: number, client: any) => {
      const subscription = subscriptionByUser.get(client.id);
      const amount = numeric(subscription?.billing_amount || client.planPrice);
      const months = Math.max(1, numeric(subscription?.billing_months || 1));
      return sum + amount / months;
    }, 0);

    const attention = clients
      .map((client: any) => {
        const reasons: string[] = [];
        if (delinquentClients.some((item: any) => item.id === client.id)) reasons.push("inadimplente");
        if (trialExpiring.some((item: any) => item.id === client.id)) reasons.push("teste vencendo");
        if (!client.whatsappEnabled) reasons.push("WhatsApp não configurado");
        if (client.productsCount <= 0) reasons.push("sem produtos");
        if (!client.lastAccessAt || dateMs(client.lastAccessAt) < sevenDaysAgo.getTime()) reasons.push("sem acesso há 7 dias");
        if (!client.lastOrderAt || dateMs(client.lastOrderAt) < sevenDaysAgo.getTime()) reasons.push("sem pedidos há 7 dias");
        if (client.nfceRejectedMonth > 0) reasons.push("NFC-e com rejeição");
        return { ...client, reasons };
      })
      .filter((client: any) => client.reasons.length > 0)
      .sort((a: any, b: any) => b.reasons.length - a.reasons.length || dateMs(a.lastAccessAt) - dateMs(b.lastAccessAt))
      .slice(0, 30);

    const activeByAccess = [...clients]
      .sort((a: any, b: any) => dateMs(b.lastAccessAt) - dateMs(a.lastAccessAt))
      .slice(0, 12);

    const locatedClients = clients.filter((client: any) => client.locationVerifiedByPostalCode === true);
    const cityHeatmap = groupCount(locatedClients, (client: any) => `${client.city} · ${client.state}`).slice(0, 16);
    const stateHeatmap = groupCount(locatedClients, (client: any) => client.state).slice(0, 12);
    const representativeLeadStages = groupCount(commercialLeads, (lead: any) => lead.commercial_stage || "new");
    const statusBreakdown = [
      { label: "Ativos", value: activeClients.length },
      { label: "Teste", value: trialClients.length },
      { label: "Inadimplentes", value: delinquentClients.length },
      { label: "Sem assinatura", value: clients.filter((client: any) => client.subscriptionStatus === "sem_assinatura").length },
    ];
    const activityBreakdown = [
      { label: "Hoje", value: accessedToday.length },
      { label: "7 dias", value: accessed7Days.length },
      { label: "30 dias", value: accessed30Days.length },
      { label: "Sem 30 dias", value: noAccess30Days.length },
      { label: "Nunca", value: neverAccessed.length },
    ];
    const signupTrend = buildDailySeries(14, now, clients, "createdAt", "cadastros");
    const accessTrend = buildDailySeries(14, now, clients.filter((client: any) => client.lastAccessAt), "lastAccessAt", "acessos");
    const orderTrend = buildDailySeries(14, now, orders, "created_at", "pedidos");

    return json({
      ok: true,
      token: await createToken(user.email, user.role, user.memberId),
      generatedAt: now.toISOString(),
      members,
      metrics: {
        totalClients: clients.length,
        newToday: newToday.length,
        newMonth: newMonth.length,
        activeClients: activeClients.length,
        trialClients: trialClients.length,
        trialExpiring: trialExpiring.length,
        delinquentClients: delinquentClients.length,
        paidThisMonth: paidThisMonth.length,
        accessedToday: accessedToday.length,
        accessed7Days: accessed7Days.length,
        accessed30Days: accessed30Days.length,
        noAccess7Days: noAccess7Days.length,
        noAccess30Days: noAccess30Days.length,
        neverAccessed: neverAccessed.length,
        noOrders7Days: noOrders7Days.length,
        ordersMonth,
        mrr,
        whatsappConfigured: clients.filter((client: any) => client.whatsappEnabled).length,
        nfceAuthorizedMonth: Array.from(nfceAuthorizedByUser.values()).reduce((sum, value) => sum + value, 0),
        nfceRejectedMonth: Array.from(nfceRejectedByUser.values()).reduce((sum, value) => sum + value, 0),
        overdueAmount: invoices.filter((invoice: any) => financialStatus(null, [invoice]) === "overdue").reduce((sum: number, invoice: any) => sum + numeric(invoice.amount), 0),
        openTickets: Array.from(openTicketsByUser.values()).reduce((sum, value) => sum + value, 0),
        openTasks: tasks.length,
        criticalClients: clients.filter((client: any) => client.healthClassification === "critical").length,
        clientsWithVerifiedPostalCode: locatedClients.length,
        clientsWithoutVerifiedPostalCode: clients.length - locatedClients.length,
        commercialLeads: commercialLeads.length,
        representativeVisits: representativeVisits.length,
        marketingOptIns: commercialLeads.filter((lead: any) => lead.marketing_consent === true).length,
      },
      lists: {
        portfolio: clients,
        newToday: newToday.slice(0, 20),
        recentSignups: clients.slice(0, 20),
        delinquent: delinquentClients.slice(0, 20),
        trialExpiring: trialExpiring.slice(0, 20),
        attention,
        activeByAccess,
        inactiveByAccess: noAccess7Days
          .sort((a: any, b: any) => dateMs(a.lastAccessAt) - dateMs(b.lastAccessAt))
          .slice(0, 20),
        neverAccessed: neverAccessed.slice(0, 20),
        paidThisMonth: paidThisMonth.slice(0, 20),
        commercialLeads,
      },
      analytics: {
        cityHeatmap,
        stateHeatmap,
        statusBreakdown,
        activityBreakdown,
        signupTrend,
        accessTrend,
        orderTrend,
        representativeLeadStages,
      },
    });
  } catch (error) {
    console.error("admin-dashboard error", error);
    const message = error instanceof Error ? error.message : "Erro ao carregar painel interno.";
    return json({ ok: false, error: message }, 500);
  }
});

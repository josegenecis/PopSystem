// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

const json = (data: Record<string, unknown>, status = 200) => new Response(JSON.stringify(data), { status, headers: corsHeaders });
const clean = (value: unknown, max = 5000) => String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
const digits = (value: unknown) => String(value || "").replace(/\D/g, "");

function normalizeBrazilPhone(value: unknown) {
  const valueDigits = digits(value);
  if (valueDigits.startsWith("55") && [12, 13].includes(valueDigits.length)) return valueDigits;
  if ([10, 11].includes(valueDigits.length)) return `55${valueDigits}`;
  return "";
}

async function lookupPostalCode(value: unknown) {
  const postalCode = digits(value);
  if (postalCode.length !== 8) throw new Error("Informe um CEP válido com 8 números.");
  const response = await fetch(`https://viacep.com.br/ws/${postalCode}/json/`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error("Não foi possível consultar o CEP.");
  const location = await response.json();
  if (location?.erro || !location?.localidade || !location?.uf) throw new Error("CEP não encontrado.");
  return {
    postalCode,
    city: clean(location.localidade, 100),
    state: clean(location.uf, 2).toUpperCase(),
    neighborhood: clean(location.bairro, 120),
    street: clean(location.logradouro, 180),
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authorization = req.headers.get("authorization") || "";
    const jwt = authorization.replace(/^Bearer\s+/i, "").trim();
    if (!jwt) return json({ ok: false, error: "Entre com sua conta de representante." }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const { data: authData, error: authError } = await supabase.auth.getUser(jwt);
    if (authError || !authData.user?.id) return json({ ok: false, error: "Sessão expirada. Entre novamente." }, 401);

    const { data: representative } = await supabase
      .from("internal_admin_members")
      .select("id,email,display_name,role,active")
      .eq("auth_user_id", authData.user.id)
      .eq("role", "representative")
      .eq("active", true)
      .maybeSingle();
    if (!representative) return json({ ok: false, error: "Esta conta não possui acesso de representante." }, 403);

    await supabase.from("internal_admin_members").update({ last_access_at: new Date().toISOString() }).eq("id", representative.id);
    const body = await req.json().catch(() => ({}));
    const action = clean(body?.action || "list", 40);

    if (action === "profile") return json({ ok: true, representative });

    if (action === "list") {
      const [{ data: leads, error: leadsError }, { data: visits, error: visitsError }] = await Promise.all([
        supabase.from("commercial_leads").select("*").eq("representative_member_id", representative.id).order("updated_at", { ascending: false }).limit(1000),
        supabase.from("representative_visits").select("id,lead_id,visited_at,outcome,notes").eq("representative_member_id", representative.id).order("visited_at", { ascending: false }).limit(2000),
      ]);
      if (leadsError || visitsError) throw leadsError || visitsError;
      return json({ ok: true, representative, leads: leads || [], visits: visits || [] });
    }

    if (action === "lookup_postal_code") {
      return json({ ok: true, location: await lookupPostalCode(body?.postalCode) });
    }

    if (action === "register_visit") {
      const restaurantName = clean(body?.restaurantName, 160);
      const ownerName = clean(body?.ownerName, 120);
      const ownerPhone = normalizeBrazilPhone(body?.ownerPhone);
      const email = clean(body?.email, 255).toLowerCase() || null;
      const submittedStreet = clean(body?.street, 180);
      const submittedNeighborhood = clean(body?.neighborhood, 120);
      const streetNumber = clean(body?.streetNumber, 30) || null;
      const complement = clean(body?.complement, 120) || null;
      const notes = clean(body?.notes, 5000) || null;
      const interestLevel = clean(body?.interestLevel || "warm", 20);
      const outcome = clean(body?.outcome || "registered", 30);
      const marketingConsent = body?.marketingConsent === true;
      if (restaurantName.length < 2 || ownerName.length < 2 || !ownerPhone) {
        return json({ ok: false, error: "Restaurante, proprietário e WhatsApp válido são obrigatórios." }, 400);
      }
      if (!["cold", "warm", "hot"].includes(interestLevel)) return json({ ok: false, error: "Nível de interesse inválido." }, 400);
      if (!["registered", "interested", "demo_scheduled", "follow_up", "not_interested", "closed"].includes(outcome)) {
        return json({ ok: false, error: "Resultado da visita inválido." }, 400);
      }

      const location = await lookupPostalCode(body?.postalCode);
      const street = submittedStreet || location.street;
      if (!street) {
        return json({ ok: false, error: "Informe o endereço ou a rua do estabelecimento." }, 400);
      }
      const { data: existing } = await supabase.from("commercial_leads").select("id,representative_member_id,marketing_consent,marketing_consent_at,commercial_stage").eq("owner_phone", ownerPhone).maybeSingle();
      if (existing && existing.representative_member_id !== representative.id) {
        return json({ ok: false, error: "Este contato já está cadastrado no funil comercial." }, 409);
      }

      const hasMarketingConsent = existing?.marketing_consent === true || marketingConsent;
      const stageByOutcome: Record<string, string> = {
        interested: "contacting",
        follow_up: "contacting",
        demo_scheduled: "demo_scheduled",
        closed: "won",
        not_interested: "lost",
      };
      const leadPayload = {
        representative_member_id: representative.id,
        restaurant_name: restaurantName,
        owner_name: ownerName,
        owner_phone: ownerPhone,
        email,
        postal_code: location.postalCode,
        city: location.city,
        state: location.state,
        neighborhood: submittedNeighborhood || location.neighborhood || null,
        street,
        street_number: streetNumber,
        complement,
        interest_level: interestLevel,
        commercial_stage: stageByOutcome[outcome] || existing?.commercial_stage || "new",
        marketing_consent: hasMarketingConsent,
        marketing_consent_at: hasMarketingConsent ? existing?.marketing_consent_at || new Date().toISOString() : null,
        marketing_consent_source: hasMarketingConsent ? "representative_visit" : null,
        marketing_status: hasMarketingConsent ? "enrolled" : "awaiting_consent",
        last_visit_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const leadQuery = existing
        ? supabase.from("commercial_leads").update(leadPayload).eq("id", existing.id).select("*").single()
        : supabase.from("commercial_leads").insert(leadPayload).select("*").single();
      const { data: lead, error: leadError } = await leadQuery;
      if (leadError || !lead) throw leadError || new Error("Lead não cadastrado.");

      const { data: visit, error: visitError } = await supabase.from("representative_visits").insert({
        lead_id: lead.id,
        representative_member_id: representative.id,
        visited_at: body?.visitedAt || new Date().toISOString(),
        outcome,
        notes,
        latitude: Number.isFinite(Number(body?.latitude)) ? Number(body.latitude) : null,
        longitude: Number.isFinite(Number(body?.longitude)) ? Number(body.longitude) : null,
      }).select("*").single();
      if (visitError) throw visitError;

      return json({ ok: true, lead, visit });
    }

    return json({ ok: false, error: "Ação inválida." }, 400);
  } catch (error) {
    console.error("representative-portal error", error);
    return json({ ok: false, error: error instanceof Error ? error.message : "Erro interno." }, 500);
  }
});

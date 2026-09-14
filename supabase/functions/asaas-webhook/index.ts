import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, access_token, asaas-access-token, x-asaas-token",
};

const paidEvents = new Set([
  "PAYMENT_RECEIVED",
  "PAYMENT_CONFIRMED",
  "PAYMENT_APPROVED_BY_RISK_ANALYSIS",
]);

const overdueEvents = new Set([
  "PAYMENT_OVERDUE",
  "PAYMENT_AWAITING_RISK_ANALYSIS",
]);

const canceledEvents = new Set([
  "PAYMENT_REPROVED_BY_RISK_ANALYSIS",
  "PAYMENT_CREDIT_CARD_CAPTURE_REFUSED",
  "PAYMENT_DELETED",
  "PAYMENT_REFUNDED",
  "PAYMENT_CHARGEBACK_REQUESTED",
  "PAYMENT_CHARGEBACK_DISPUTE",
]);

const addMonths = (date: Date, months: number) => {
  const result = new Date(date);
  const originalDay = result.getDate();
  result.setDate(1);
  result.setMonth(result.getMonth() + months);
  const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(originalDay, lastDay));
  return result;
};

const tokenFromHeaders = (req: Request) => {
  const authorization = req.headers.get("authorization") || "";
  return req.headers.get("asaas-access-token")
    || req.headers.get("x-asaas-token")
    || req.headers.get("access_token")
    || authorization.replace(/^Bearer\s+/i, "");
};

const getAsaasBaseUrl = () => {
  const env = (Deno.env.get("ASAAS_ENVIRONMENT") || "production").toLowerCase();
  return env === "sandbox" || env === "homologacao" || env === "homologação"
    ? "https://sandbox.asaas.com/api/v3"
    : "https://api.asaas.com/v3";
};

const cancelAsaasSubscription = async (subscriptionId: string) => {
  const apiKey = Deno.env.get("ASAAS_API_KEY");
  if (!apiKey) throw new Error("ASAAS_API_KEY não configurada para cancelar a assinatura anterior.");
  const response = await fetch(`${getAsaasBaseUrl()}/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    method: "DELETE",
    headers: { access_token: apiKey },
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`Asaas respondeu HTTP ${response.status} ao cancelar a assinatura anterior.`);
  }
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const expectedToken = Deno.env.get("ASAAS_WEBHOOK_TOKEN");
    if (expectedToken && tokenFromHeaders(req) !== expectedToken) {
      return new Response(JSON.stringify({ ok: false, error: "Webhook não autorizado." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 401,
      });
    }

    const payload = await req.json();
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    const event = String(payload.event || "");
    const payment = payload.payment || {};
    const subscriptionId = payment.subscription || payload.subscription?.id || null;
    const externalReference = String(payment.externalReference || "");

    await supabase.from("asaas_webhook_events").insert({
      event_id: payload.id || payment.id || crypto.randomUUID(),
      event_type: event,
      asaas_payment_id: payment.id || null,
      asaas_subscription_id: subscriptionId,
      payload,
    });

    const upgradeIdFromReference = externalReference.startsWith("subscription-upgrade:")
      ? externalReference.replace("subscription-upgrade:", "")
      : null;
    const initialSubscriptionIdFromReference = externalReference.startsWith("subscription-initial:")
      ? externalReference.split(":").at(-1) || null
      : null;
    const { data: planChange } = upgradeIdFromReference
      ? await supabase.from("subscription_plan_changes").select("*").eq("id", upgradeIdFromReference).maybeSingle()
      : payment.id
        ? await supabase.from("subscription_plan_changes").select("*").eq("asaas_payment_id", payment.id).maybeSingle()
        : { data: null };

    let invoiceUserId = String(planChange?.user_id || "");
    let localSubscriptionId: string | null = null;
    if (!invoiceUserId && (subscriptionId || initialSubscriptionIdFromReference || payment.id)) {
      let lookup = supabase.from("subscriptions").select("id,user_id");
      if (subscriptionId || initialSubscriptionIdFromReference) {
        lookup = lookup.eq("asaas_subscription_id", subscriptionId || initialSubscriptionIdFromReference);
      } else {
        lookup = lookup.eq("asaas_payment_id", payment.id);
      }
      const { data: localSubscription } = await lookup.order("updated_at", { ascending: false }).limit(1).maybeSingle();
      invoiceUserId = String(localSubscription?.user_id || "");
      localSubscriptionId = localSubscription?.id || null;
    }
    if (invoiceUserId && payment.id) {
      const paidAt = payment.paymentDate || payment.confirmedDate || payment.clientPaymentDate || null;
      await supabase.from("subscription_invoices").upsert({
        user_id: invoiceUserId,
        subscription_id: localSubscriptionId,
        provider: "asaas",
        provider_payment_id: payment.id,
        provider_subscription_id: subscriptionId,
        status: String(payment.status || event.replace(/^PAYMENT_/, "") || "unknown").toLowerCase(),
        amount: Number(payment.value || 0),
        net_amount: payment.netValue == null ? null : Number(payment.netValue),
        billing_type: payment.billingType || null,
        due_date: payment.dueDate || null,
        paid_at: paidAt ? new Date(paidAt).toISOString() : null,
        invoice_url: payment.invoiceUrl || payment.bankSlipUrl || null,
        last_event_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: "provider,provider_payment_id" });
    }

    if (planChange && paidEvents.has(event) && planChange.status !== "paid") {
      const { data: targetPlan } = await supabase
        .from("subscription_plans")
        .select("included_stores,extra_store_price")
        .eq("id", planChange.to_plan_id)
        .maybeSingle();
      const storeCount = Math.max(1, Number(planChange.to_store_count || 1));
      const includedStores = Math.max(1, Number(targetPlan?.included_stores || 1));
      const billingMonths = Math.max(1, Number(planChange.to_billing_months || 1));
      const periodStart = new Date();
      const periodEnd = addMonths(periodStart, billingMonths);

      const { error: activateError } = await supabase
        .from("subscriptions")
        .update({
          plan_id: planChange.to_plan_id,
          status: "active",
          billing_provider: "asaas",
          asaas_customer_id: planChange.new_asaas_customer_id,
          asaas_subscription_id: planChange.new_asaas_subscription_id,
          asaas_payment_id: payment.id || planChange.asaas_payment_id,
          store_count: storeCount,
          additional_store_count: Math.max(0, storeCount - includedStores),
          extra_store_price: Number(targetPlan?.extra_store_price || 0),
          billing_cycle: String(planChange.to_billing_cycle || "MONTHLY"),
          billing_months: billingMonths,
          billing_discount_percent: Number(planChange.billing_discount_percent || 0),
          billing_amount: Number(planChange.to_billing_amount || planChange.new_monthly_value || 0),
          installment_count: Math.max(1, Number(planChange.to_installment_count || 1)),
          payment_method: planChange.payment_method,
          current_period_start: periodStart.toISOString(),
          current_period_end: periodEnd.toISOString(),
          access_override_until: null,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", planChange.user_id);
      if (activateError) throw activateError;

      await supabase
        .from("subscription_plan_changes")
        .update({ status: "paid", completed_at: new Date().toISOString() })
        .eq("id", planChange.id);

      if (planChange.old_asaas_subscription_id) {
        await cancelAsaasSubscription(planChange.old_asaas_subscription_id).catch((cancelError) => {
          console.error("Falha ao cancelar assinatura anterior do upgrade:", cancelError);
        });
      }
    } else if (planChange && canceledEvents.has(event)) {
      await supabase
        .from("subscription_plan_changes")
        .update({ status: "canceled" })
        .eq("id", planChange.id);
      if (planChange.status === "paid") {
        await supabase
          .from("subscriptions")
          .update({ status: "canceled", updated_at: new Date().toISOString() })
          .eq("user_id", planChange.user_id)
          .eq("asaas_subscription_id", planChange.new_asaas_subscription_id);
        if (planChange.new_asaas_subscription_id) {
          await cancelAsaasSubscription(planChange.new_asaas_subscription_id).catch((cancelError) => {
            console.error("Falha ao cancelar assinatura após estorno ou chargeback:", cancelError);
          });
        }
      }
    }

    if (!subscriptionId && !planChange && (payment.id || initialSubscriptionIdFromReference)) {
      const directPaymentStatus = paidEvents.has(event)
        ? "active"
        : overdueEvents.has(event)
          ? "past_due"
          : canceledEvents.has(event)
            ? "canceled"
            : null;

      if (directPaymentStatus) {
        let directSubscriptionQuery = supabase
          .from("subscriptions")
          .select("id,billing_months");
        directSubscriptionQuery = initialSubscriptionIdFromReference
          ? directSubscriptionQuery.eq("asaas_subscription_id", initialSubscriptionIdFromReference)
          : directSubscriptionQuery.eq("asaas_payment_id", payment.id);
        const { data: directSubscription } = await directSubscriptionQuery.maybeSingle();

        if (directSubscription) {
          const directUpdate: Record<string, unknown> = {
            status: directPaymentStatus,
            updated_at: new Date().toISOString(),
          };
          if (paidEvents.has(event)) {
            const periodStart = new Date();
            directUpdate.current_period_start = periodStart.toISOString();
            directUpdate.current_period_end = addMonths(
              periodStart,
              Math.max(1, Number(directSubscription.billing_months || 1)),
            ).toISOString();
            directUpdate.access_override_until = null;
          }
          await supabase.from("subscriptions").update(directUpdate).eq("id", directSubscription.id);
        }
      }
    }

    if (subscriptionId) {
      const status = paidEvents.has(event)
        ? "active"
        : overdueEvents.has(event)
          ? "past_due"
          : canceledEvents.has(event)
            ? "canceled"
            : null;

      if (status) {
        const updatePayload: Record<string, unknown> = {
          status,
          asaas_payment_id: payment.id || null,
          updated_at: new Date().toISOString(),
        };

        if (paidEvents.has(event)) {
          const { data: currentSubscription } = await supabase
            .from("subscriptions")
            .select("billing_months")
            .eq("asaas_subscription_id", subscriptionId)
            .maybeSingle();
          const periodStart = new Date();
          const periodEnd = addMonths(periodStart, Math.max(1, Number(currentSubscription?.billing_months || 1)));
          updatePayload.current_period_start = periodStart.toISOString();
          updatePayload.current_period_end = periodEnd.toISOString();
          updatePayload.access_override_until = null;
        }

        await supabase
          .from("subscriptions")
          .update(updatePayload)
          .eq("asaas_subscription_id", subscriptionId);
      }
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error("asaas-webhook error:", error);
    return new Response(JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : "Erro no webhook do Asaas.",
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});

// Mercado Pago: suscripciones (preapproval) y compra de paquetes de créditos (Checkout Pro). Solo servidor.
// Basado en el flujo de Kubbo3D. Nada de lo que manda el navegador se cree: todo se vuelve a leer de Mercado Pago.
import { db } from "./server";

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const paymentsConfigured = () => Boolean(process.env.MP_ACCESS_TOKEN && usdRate());

/** Pesos por dólar: Mercado Pago solo cobra en la moneda del país del vendedor (MXN en México). */
export const usdRate = () => Number(process.env.MP_USD_RATE) || 0;
export const chargeCurrency = () => process.env.MP_CURRENCY || "MXN";
/** Precio en la moneda de cobro, redondeado a pesos enteros. */
export const chargeAmount = (priceUsd: number) => Math.round(priceUsd * usdRate());

export const siteUrl = (req: Request) => (process.env.SITE_URL || new URL(req.url).origin).replace(/\/+$/, "");

export function mercadoPago(path: string, init?: RequestInit) {
  return fetch(`https://api.mercadopago.com${path}`, {
    ...init,
    cache: "no-store",
    headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`, "Content-Type": "application/json", ...init?.headers },
  });
}

type Sync = "ok" | "ignored" | "retry";
const STATUSES = ["pending", "authorized", "paused", "cancelled"] as const;

/**
 * Lee una suscripción de Mercado Pago, la guarda y da los créditos de cada cobro aprobado.
 * external_reference = "<user id>:<plan id>". Al autorizarse una nueva, se cancela la anterior.
 */
export async function syncPreapproval(id: string): Promise<Sync> {
  if (!/^[\w-]{6,64}$/.test(id)) return "ignored";
  const res = await mercadoPago(`/preapproval/${id}`);
  if (res.status === 404) return "ignored";
  if (!res.ok) return "retry";
  const pre = await res.json();
  const [userId, planId] = String(pre.external_reference ?? "").split(":");
  if (!UUID.test(userId ?? "") || !planId) return "ignored";

  const plan = await db().from("plans").select("id, credits").eq("id", planId).maybeSingle();
  if (plan.error) return "retry";
  if (!plan.data) return "ignored";

  const status = STATUSES.includes(pre.status) ? (pre.status as (typeof STATUSES)[number]) : "pending";
  const next = pre.next_payment_date ?? null;
  const saved = await db().from("subscriptions").select("paid_until").eq("mp_preapproval_id", id).maybeSingle();
  if (saved.error) return "retry";
  // Mientras está activa, tiene acceso hasta el siguiente cobro; si se cancela, conserva lo ya pagado.
  const paidUntil = status === "authorized" && next ? next : (saved.data?.paid_until ?? null);

  const up = await db().from("subscriptions").upsert(
    {
      user_id: userId,
      plan_id: planId,
      source: "mercadopago",
      mp_preapproval_id: id,
      status,
      amount: Number(pre.auto_recurring?.transaction_amount) || 0,
      currency: pre.auto_recurring?.currency_id ?? chargeCurrency(),
      payer_email: pre.payer_email ?? "",
      next_payment_date: next,
      paid_until: paidUntil,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "mp_preapproval_id" },
  );
  if (up.error) return "retry";

  // Créditos de cada cobro aprobado de esta suscripción (una sola vez por cobro).
  const charges = await mercadoPago(`/authorized_payments/search?preapproval_id=${encodeURIComponent(id)}`);
  if (charges.ok) {
    const list = (await charges.json())?.results ?? [];
    for (const c of list) {
      if (c?.payment?.status !== "approved") continue;
      const g = await db().rpc("grant_payment", {
        p_mp_id: `ap:${c.id}`,
        p_user: userId,
        p_kind: "suscripcion",
        p_ref: planId,
        p_amount: Number(c.transaction_amount) || 0,
        p_currency: c.currency_id ?? chargeCurrency(),
        p_credits: plan.data.credits,
      });
      if (g.error) return "retry";
    }
  } else if (charges.status >= 500) {
    return "retry";
  }

  if (status === "authorized") {
    const others = await db()
      .from("subscriptions")
      .select("mp_preapproval_id")
      .eq("source", "mercadopago")
      .eq("user_id", userId)
      .neq("mp_preapproval_id", id)
      .in("status", ["authorized", "paused"]);
    if (others.error) return "retry";
    for (const o of others.data) {
      const cancel = await mercadoPago(`/preapproval/${o.mp_preapproval_id}`, { method: "PUT", body: JSON.stringify({ status: "cancelled" }) });
      if (!cancel.ok) return "retry";
      await db()
        .from("subscriptions")
        .update({ status: "cancelled", paid_until: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("mp_preapproval_id", o.mp_preapproval_id);
    }
  }
  return "ok";
}

/** Cobro de una suscripción (webhook subscription_authorized_payment): sincroniza su suscripción. */
export async function syncAuthorizedPayment(id: string): Promise<Sync> {
  const res = await mercadoPago(`/authorized_payments/${encodeURIComponent(id)}`);
  if (res.status === 404) return "ignored";
  if (!res.ok) return "retry";
  const pre = String((await res.json())?.preapproval_id ?? "");
  return pre ? syncPreapproval(pre) : "ignored";
}

/** Pago de un paquete de créditos. external_reference = "pack:<user id>:<pack id>". */
export async function syncPayment(id: string): Promise<Sync> {
  if (!/^\d{4,20}$/.test(id)) return "ignored";
  const res = await mercadoPago(`/v1/payments/${id}`);
  if (res.status === 404) return "ignored";
  if (!res.ok) return "retry";
  const p = await res.json();
  const [tag, userId, packId] = String(p.external_reference ?? "").split(":");
  if (tag !== "pack" || !UUID.test(userId ?? "") || !packId) return "ignored";
  if (p.status !== "approved") return "ok";

  const pack = await db().from("credit_packs").select("id, credits, price_usd").eq("id", packId).maybeSingle();
  if (pack.error) return "retry";
  if (!pack.data) return "ignored";
  // Que lo pagado corresponda al paquete (tolera cambios del tipo de cambio de hasta 10 %).
  const paid = Number(p.transaction_amount) || 0;
  if (paid < chargeAmount(Number(pack.data.price_usd)) * 0.9) {
    console.error("Pago de paquete con monto menor al esperado", id, paid);
    return "ignored";
  }
  const g = await db().rpc("grant_payment", {
    p_mp_id: `pay:${id}`,
    p_user: userId,
    p_kind: "paquete",
    p_ref: packId,
    p_amount: paid,
    p_currency: p.currency_id ?? chargeCurrency(),
    p_credits: pack.data.credits,
  });
  return g.error ? "retry" : "ok";
}

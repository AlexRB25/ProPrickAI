import { NextResponse } from "next/server";
import { chargeAmount, chargeCurrency, mercadoPago, paymentsConfigured, siteUrl } from "@/lib/mercadopago";
import { authUser, db, dbConfigured, fail } from "@/lib/server";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Inicia una suscripción (mensual o anual): la crea en Mercado Pago como pendiente y responde con la
 * página donde se pone la tarjeta. Mercado Pago avisa por webhook cuando queda autorizada.
 */
export async function POST(req: Request) {
  if (!dbConfigured() || !paymentsConfigured()) return fail("Los pagos todavía no están configurados.", 503);
  const user = await authUser(req);
  if (!user) return fail("Entra con tu cuenta para suscribirte.", 401);

  const body = await req.json().catch(() => null);
  const email = String(body?.email ?? user.email ?? "").trim();
  if (!EMAIL.test(email)) return fail("Escribe el correo de tu cuenta de Mercado Pago.");

  const plan = await db().from("plans").select("id, name, price_usd, months").eq("id", String(body?.plan ?? "")).eq("active", true).maybeSingle();
  if (plan.error) return fail("No se pudo leer el plan. Intenta de nuevo.", 502);
  if (!plan.data) return fail("Ese plan no existe.");

  const res = await mercadoPago("/preapproval", {
    method: "POST",
    body: JSON.stringify({
      reason: `ProPicksAI · Plan ${plan.data.name}`,
      external_reference: `${user.id}:${plan.data.id}`,
      payer_email: email,
      auto_recurring: {
        frequency: plan.data.months,
        frequency_type: "months",
        transaction_amount: chargeAmount(Number(plan.data.price_usd)),
        currency_id: chargeCurrency(),
      },
      back_url: `${siteUrl(req)}/planes`,
      status: "pending",
    }),
  });
  const pre = await res.json().catch(() => null);
  if (!res.ok || !pre?.init_point) {
    console.error("Mercado Pago no creó la suscripción", res.status, pre);
    return fail(`Mercado Pago no aceptó la suscripción${pre?.message ? `: ${pre.message}` : "."} Revisa el correo de tu cuenta de Mercado Pago.`, 502);
  }
  return NextResponse.json({ url: pre.init_point });
}

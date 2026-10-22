import { NextResponse } from "next/server";
import { hasAccess } from "@/lib/billing";
import { chargeAmount, chargeCurrency, mercadoPago, paymentsConfigured, siteUrl } from "@/lib/mercadopago";
import { authUser, db, dbConfigured, fail } from "@/lib/server";

/** Compra de un paquete de créditos (pago único con Checkout Pro). Solo para suscriptores. */
export async function POST(req: Request) {
  if (!dbConfigured() || !paymentsConfigured()) return fail("Los pagos todavía no están configurados.", 503);
  const user = await authUser(req);
  if (!user) return fail("Entra con tu cuenta.", 401);
  if (!(await hasAccess(user))) return fail("Los paquetes de créditos son para suscriptores. Primero elige un plan.", 402);

  const body = await req.json().catch(() => null);
  const pack = await db().from("credit_packs").select("id, name, credits, price_usd").eq("id", String(body?.pack ?? "")).eq("active", true).maybeSingle();
  if (pack.error) return fail("No se pudo leer el paquete.", 502);
  if (!pack.data) return fail("Ese paquete no existe.");

  const site = siteUrl(req);
  const res = await mercadoPago("/checkout/preferences", {
    method: "POST",
    body: JSON.stringify({
      items: [
        {
          id: pack.data.id,
          title: `ProPicksAI · ${pack.data.name}`,
          quantity: 1,
          unit_price: chargeAmount(Number(pack.data.price_usd)),
          currency_id: chargeCurrency(),
        },
      ],
      external_reference: `pack:${user.id}:${pack.data.id}`,
      payer: { email: user.email },
      back_urls: { success: `${site}/planes`, pending: `${site}/planes`, failure: `${site}/planes` },
      auto_return: "approved",
      notification_url: `${site}/api/mercadopago/webhook`,
    }),
  });
  const pref = await res.json().catch(() => null);
  if (!res.ok || !pref?.init_point) {
    console.error("Mercado Pago no creó la preferencia", res.status, pref);
    return fail(`Mercado Pago no aceptó la compra${pref?.message ? `: ${pref.message}` : "."}`, 502);
  }
  return NextResponse.json({ url: pref.init_point });
}

import { NextResponse } from "next/server";
import { paymentsConfigured, syncPayment } from "@/lib/mercadopago";
import { authUser, fail } from "@/lib/server";

/** Al volver de Mercado Pago con ?payment_id=…: acredita el paquete sin esperar el webhook. */
export async function POST(req: Request) {
  if (!paymentsConfigured()) return fail("Los pagos todavía no están configurados.", 503);
  const user = await authUser(req);
  if (!user) return fail("Entra con tu cuenta.", 401);
  const body = await req.json().catch(() => null);
  const result = await syncPayment(String(body?.payment_id ?? ""));
  return NextResponse.json({ ok: result === "ok" }, { status: result === "retry" ? 502 : 200 });
}

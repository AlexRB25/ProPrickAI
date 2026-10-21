import { NextResponse } from "next/server";
import { mercadoPago, paymentsConfigured, syncPreapproval } from "@/lib/mercadopago";
import { authUser, db, fail } from "@/lib/server";

/**
 * Suscripción del usuario:
 * { action: "sync", id } al volver de Mercado Pago (activa sin esperar el webhook; solo si es suya);
 * { action: "cancel" } detiene los cobros; el acceso sigue hasta el final del periodo pagado.
 */
export async function POST(req: Request) {
  if (!paymentsConfigured()) return fail("Los pagos todavía no están configurados.", 503);
  const user = await authUser(req);
  if (!user) return fail("Entra con tu cuenta.", 401);
  const body = await req.json().catch(() => null);

  if (body?.action === "sync") {
    const result = await syncPreapproval(String(body.id ?? ""));
    return NextResponse.json({ ok: result === "ok" }, { status: result === "retry" ? 502 : 200 });
  }

  if (body?.action === "cancel") {
    const active = await db()
      .from("subscriptions")
      .select("mp_preapproval_id")
      .eq("user_id", user.id)
      .eq("source", "mercadopago")
      .in("status", ["authorized", "paused", "pending"]);
    if (active.error) return fail("No se pudo leer tu suscripción.", 502);
    for (const { mp_preapproval_id: id } of active.data) {
      if (!id) continue;
      const cancel = await mercadoPago(`/preapproval/${id}`, { method: "PUT", body: JSON.stringify({ status: "cancelled" }) });
      if (!cancel.ok) return fail("Mercado Pago no respondió. Intenta de nuevo en un momento.", 502);
      await syncPreapproval(id);
    }
    return NextResponse.json({ ok: true });
  }

  return fail("Acción desconocida.");
}

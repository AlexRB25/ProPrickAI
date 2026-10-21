import { NextResponse } from "next/server";
import { getTarifas } from "@/lib/billing";
import { chargeAmount, chargeCurrency, paymentsConfigured } from "@/lib/mercadopago";
import { authUser, db, dbConfigured, fail } from "@/lib/server";

export const dynamic = "force-dynamic";

/**
 * Precios (público) y, con sesión, la cuenta: créditos, suscripción e historial.
 * ?historial=1 agrega las últimas consultas y movimientos de créditos.
 */
export async function GET(req: Request) {
  if (!dbConfigured()) return fail("Falta configurar Supabase.", 500);
  const [plans, packs, tarifas] = await Promise.all([
    db().from("plans").select("id, name, price_usd, months, credits").eq("active", true).order("sort"),
    db().from("credit_packs").select("id, name, credits, price_usd").eq("active", true).order("sort"),
    getTarifas(),
  ]);
  const pagos = paymentsConfigured();
  const precio = (usd: number) => (pagos ? { monto: chargeAmount(usd), moneda: chargeCurrency() } : null);
  const publico = {
    plans: (plans.data ?? []).map((p) => ({ ...p, cobro: precio(Number(p.price_usd)) })),
    packs: (packs.data ?? []).map((p) => ({ ...p, cobro: precio(Number(p.price_usd)) })),
    tarifas,
    pagos,
  };

  const user = await authUser(req);
  if (!user) return NextResponse.json({ ...publico, user: null });

  const [profile, subs] = await Promise.all([
    db().from("profiles").select("credits").eq("id", user.id).maybeSingle(),
    db()
      .from("subscriptions")
      .select("id, plan_id, source, status, paid_until, next_payment_date, amount, currency")
      .eq("user_id", user.id)
      .order("paid_until", { ascending: false, nullsFirst: false })
      .limit(5),
  ]);
  const now = Date.now();
  const vigente = (subs.data ?? []).find((s) => ["authorized", "cancelled", "paused"].includes(s.status) && s.paid_until && Date.parse(s.paid_until) > now) ?? null;

  let historial = null;
  if (new URL(req.url).searchParams.get("historial")) {
    const [consultas, moves] = await Promise.all([
      db().from("consultas").select("id, tipo, titulo, creditos, cache, ok, error, created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(50),
      db().from("credit_moves").select("id, delta, balance_after, reason, ref, created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(50),
    ]);
    historial = { consultas: consultas.data ?? [], movimientos: moves.data ?? [] };
  }

  return NextResponse.json({
    ...publico,
    user: {
      email: user.email,
      isAdmin: user.isAdmin,
      credits: Number(profile.data?.credits ?? 0),
      activa: user.isAdmin || Boolean(vigente),
      suscripcion: vigente ?? (subs.data ?? []).find((s) => s.status === "pending") ?? null,
    },
    historial,
  });
}

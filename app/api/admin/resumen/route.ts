import { NextResponse } from "next/server";
import { usdRate } from "@/lib/mercadopago";
import { db, requireAdmin } from "@/lib/server";

export const dynamic = "force-dynamic";

// Lo que queda de cada peso cobrado después de comisión de Mercado Pago e IVA (estimado conservador).
const NETO = 0.8;

/** Números del negocio de los últimos 30 días y si las tarifas dejan ganancia. */
export async function GET(req: Request) {
  const admin = await requireAdmin(req);
  if (admin instanceof NextResponse) return admin;
  const desde = new Date(Date.now() - 30 * 86400000).toISOString();
  const now = new Date().toISOString();

  const [users, nuevos, subs, pagos, consultas, creditos, plans, packs, bugs] = await Promise.all([
    db().from("profiles").select("id", { count: "exact", head: true }),
    db().from("profiles").select("id", { count: "exact", head: true }).gte("created_at", desde),
    db().from("subscriptions").select("plan_id, source").in("status", ["authorized", "cancelled", "paused"]).gt("paid_until", now),
    db().from("payments").select("kind, amount, currency, credits").gte("created_at", desde).limit(20000),
    db().from("consultas").select("tipo, creditos, costo_usd, cache, ok").gte("created_at", desde).limit(50000),
    db().from("profiles").select("credits").gt("credits", 0).limit(50000),
    db().from("plans").select("id, price_usd, credits"),
    db().from("credit_packs").select("id, price_usd, credits"),
    db().from("bug_reports").select("id", { count: "exact", head: true }).eq("estado", "nuevo"),
  ]);

  const rate = usdRate() || 1;
  const toUsd = (amount: number, currency: string) => (currency === "USD" ? amount : amount / rate);
  const ingresos = (pagos.data ?? []).reduce((n, p) => n + toUsd(Number(p.amount), p.currency), 0);
  const ingresosPorTipo = { suscripcion: 0, paquete: 0 };
  for (const p of pagos.data ?? []) ingresosPorTipo[p.kind as "suscripcion" | "paquete"] += toUsd(Number(p.amount), p.currency);

  const cs = consultas.data ?? [];
  const costo = cs.reduce((n, c) => n + Number(c.costo_usd), 0);
  const porTipo = ["analisis", "parlay", "captura", "calificacion"].map((tipo) => {
    const rows = cs.filter((c) => c.tipo === tipo && c.ok);
    const nuevas = rows.filter((c) => !c.cache);
    const cred = rows.reduce((n, c) => n + c.creditos, 0);
    const cost = rows.reduce((n, c) => n + Number(c.costo_usd), 0);
    return {
      tipo,
      consultas: rows.length,
      deCache: rows.length - nuevas.length,
      creditos: cred,
      costo: Math.round(cost * 100) / 100,
      costoPromedioNueva: nuevas.length ? Math.round((nuevas.reduce((n, c) => n + Number(c.costo_usd), 0) / nuevas.length) * 1000) / 1000 : null,
      costoPorCredito: cred ? Math.round((cost / cred) * 10000) / 10000 : null,
    };
  });

  // El crédito más barato que vendemos (después de comisiones): contra eso se compara el costo por crédito.
  const porCredito = [...(plans.data ?? []), ...(packs.data ?? [])]
    .filter((p) => p.credits > 0)
    .map((p) => Number(p.price_usd) / p.credits);
  const valorCreditoNeto = porCredito.length ? Math.round(Math.min(...porCredito) * NETO * 10000) / 10000 : null;
  const creditosCobrados = cs.reduce((n, c) => n + c.creditos, 0);
  const costoConsultas = cs.filter((c) => c.tipo !== "calificacion").reduce((n, c) => n + Number(c.costo_usd), 0);
  const costoPorCredito = creditosCobrados ? costoConsultas / creditosCobrados : null;

  const subsPorPlan: Record<string, number> = {};
  for (const s of subs.data ?? []) subsPorPlan[`${s.plan_id}${s.source === "admin" ? " (regalada)" : ""}`] = (subsPorPlan[`${s.plan_id}${s.source === "admin" ? " (regalada)" : ""}`] ?? 0) + 1;

  return NextResponse.json({
    usuarios: users.count ?? 0,
    nuevos30: nuevos.count ?? 0,
    suscripcionesActivas: (subs.data ?? []).length,
    subsPorPlan,
    ingresos30: Math.round(ingresos * 100) / 100,
    ingresosPorTipo: { suscripcion: Math.round(ingresosPorTipo.suscripcion * 100) / 100, paquete: Math.round(ingresosPorTipo.paquete * 100) / 100 },
    ingresosNetos30: Math.round(ingresos * NETO * 100) / 100,
    costoIa30: Math.round(costo * 100) / 100,
    ganancia30: Math.round((ingresos * NETO - costo) * 100) / 100,
    creditosEnCirculacion: (creditos.data ?? []).reduce((n, p) => n + p.credits, 0),
    consultas30: cs.length,
    porTipo,
    valorCreditoNeto,
    costoPorCredito: costoPorCredito == null ? null : Math.round(costoPorCredito * 10000) / 10000,
    bugsNuevos: bugs.count ?? 0,
    tipoCambio: usdRate() || null,
  });
}

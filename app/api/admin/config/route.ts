import { NextResponse } from "next/server";
import { clearTarifasCache } from "@/lib/billing";
import { db, fail, requireAdmin } from "@/lib/server";

export const dynamic = "force-dynamic";

/** Planes, paquetes de créditos y tarifas por acción (todos, incluso los inactivos). */
export async function GET(req: Request) {
  const admin = await requireAdmin(req);
  if (admin instanceof NextResponse) return admin;
  const [plans, packs, tarifas] = await Promise.all([
    db().from("plans").select("*").order("sort"),
    db().from("credit_packs").select("*").order("sort"),
    db().from("tarifas").select("*").order("accion"),
  ]);
  return NextResponse.json({ plans: plans.data ?? [], packs: packs.data ?? [], tarifas: tarifas.data ?? [] });
}

const num = (v: unknown, min: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= min ? n : null;
};

/**
 * Guarda cambios de precios. { plans: [...], packs: [...], tarifas: [...] } (cada lista es opcional).
 * Los cambios de precio aplican a las suscripciones nuevas; las ya creadas en Mercado Pago siguen con su monto.
 */
export async function POST(req: Request) {
  const admin = await requireAdmin(req);
  if (admin instanceof NextResponse) return admin;
  const b = await req.json().catch(() => null);

  for (const p of Array.isArray(b?.plans) ? b.plans : []) {
    const price = num(p.price_usd, 0.5);
    const credits = num(p.credits, 0);
    const months = num(p.months, 1);
    if (!p.id || price == null || credits == null || months == null) return fail(`Plan inválido: ${p.id}`);
    const { error } = await db()
      .from("plans")
      .upsert({ id: String(p.id), name: String(p.name ?? p.id), price_usd: price, credits: Math.trunc(credits), months: Math.trunc(months), active: p.active !== false, sort: Math.trunc(Number(p.sort) || 0) });
    if (error) return fail(error.message, 500);
  }
  for (const p of Array.isArray(b?.packs) ? b.packs : []) {
    const price = num(p.price_usd, 0.5);
    const credits = num(p.credits, 1);
    if (!p.id || price == null || credits == null) return fail(`Paquete inválido: ${p.id}`);
    const { error } = await db()
      .from("credit_packs")
      .upsert({ id: String(p.id), name: String(p.name ?? p.id), price_usd: price, credits: Math.trunc(credits), active: p.active !== false, sort: Math.trunc(Number(p.sort) || 0) });
    if (error) return fail(error.message, 500);
  }
  for (const t of Array.isArray(b?.tarifas) ? b.tarifas : []) {
    const creditos = num(t.creditos, 0);
    if (!t.accion || creditos == null) return fail(`Tarifa inválida: ${t.accion}`);
    const { error } = await db().from("tarifas").update({ creditos: Math.trunc(creditos) }).eq("accion", String(t.accion));
    if (error) return fail(error.message, 500);
  }
  clearTarifasCache();
  return NextResponse.json({ ok: true });
}

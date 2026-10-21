import { NextResponse } from "next/server";
import { mercadoPago, paymentsConfigured, syncPreapproval } from "@/lib/mercadopago";
import { db, fail, requireAdmin } from "@/lib/server";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Detalle de un usuario: perfil, suscripciones, pagos, consultas y movimientos de créditos. ?id= */
export async function GET(req: Request) {
  const admin = await requireAdmin(req);
  if (admin instanceof NextResponse) return admin;
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!UUID.test(id)) return fail("Usuario inválido");

  const [profile, subs, pagos, consultas, moves] = await Promise.all([
    db().from("profiles").select("id, email, credits, is_admin, blocked, created_at").eq("id", id).maybeSingle(),
    db().from("subscriptions").select("*").eq("user_id", id).order("created_at", { ascending: false }),
    db().from("payments").select("*").eq("user_id", id).order("created_at", { ascending: false }).limit(100),
    db().from("consultas").select("id, tipo, titulo, creditos, costo_usd, cache, ok, error, created_at").eq("user_id", id).order("created_at", { ascending: false }).limit(200),
    db().from("credit_moves").select("id, delta, balance_after, reason, ref, created_at").eq("user_id", id).order("created_at", { ascending: false }).limit(200),
  ]);
  if (!profile.data) return fail("No existe ese usuario", 404);
  return NextResponse.json({
    profile: profile.data,
    suscripciones: subs.data ?? [],
    pagos: pagos.data ?? [],
    consultas: consultas.data ?? [],
    movimientos: moves.data ?? [],
  });
}

/**
 * Acciones del admin sobre un usuario:
 * { id, action: "creditos", delta, motivo }            agrega (+) o quita (−) créditos
 * { id, action: "dar_suscripcion", plan_id, meses }    regala una suscripción (sin cobro)
 * { id, action: "quitar_suscripcion", subscription_id } la termina hoy (si es de Mercado Pago, también la cancela allá)
 * { id, action: "bloquear", blocked }                   bloquea o desbloquea la cuenta
 * { id, action: "admin", is_admin }                     da o quita permisos de admin
 */
export async function POST(req: Request) {
  const admin = await requireAdmin(req);
  if (admin instanceof NextResponse) return admin;
  const b = await req.json().catch(() => null);
  const id = String(b?.id ?? "");
  if (!UUID.test(id)) return fail("Usuario inválido");

  switch (b?.action) {
    case "creditos": {
      const delta = Math.trunc(Number(b.delta));
      if (!delta || Math.abs(delta) > 100000) return fail("Cantidad inválida");
      const { data, error } = await db().rpc("move_credits", {
        p_user: id,
        p_delta: delta,
        p_reason: "admin",
        p_ref: String(b.motivo ?? "").slice(0, 200) || null,
        p_admin: admin.id,
      });
      if (error) return fail(/saldo_insuficiente/.test(error.message) ? "No puede quedar con saldo negativo." : error.message, 400);
      return NextResponse.json({ ok: true, credits: data });
    }
    case "dar_suscripcion": {
      const meses = Math.min(36, Math.max(1, Math.trunc(Number(b.meses) || 1)));
      const plan = await db().from("plans").select("id, credits, months").eq("id", String(b.plan_id ?? "")).maybeSingle();
      if (!plan.data) return fail("Ese plan no existe.");
      const until = new Date();
      until.setMonth(until.getMonth() + meses);
      const { error } = await db().from("subscriptions").insert({
        user_id: id,
        plan_id: plan.data.id,
        source: "admin",
        status: "authorized",
        paid_until: until.toISOString(),
      });
      if (error) return fail(error.message, 500);
      // Los créditos del plan proporcionales a los meses regalados.
      const creditos = b.con_creditos === false ? 0 : Math.round((plan.data.credits / plan.data.months) * meses);
      if (creditos > 0) {
        await db().rpc("move_credits", { p_user: id, p_delta: creditos, p_reason: "admin", p_ref: `suscripción regalada ${plan.data.id} ${meses}m`, p_admin: admin.id });
      }
      return NextResponse.json({ ok: true });
    }
    case "quitar_suscripcion": {
      const sub = await db().from("subscriptions").select("id, source, mp_preapproval_id").eq("id", String(b.subscription_id ?? "")).eq("user_id", id).maybeSingle();
      if (!sub.data) return fail("No existe esa suscripción.");
      if (sub.data.source === "mercadopago" && sub.data.mp_preapproval_id && paymentsConfigured()) {
        const cancel = await mercadoPago(`/preapproval/${sub.data.mp_preapproval_id}`, { method: "PUT", body: JSON.stringify({ status: "cancelled" }) });
        if (!cancel.ok) return fail("Mercado Pago no canceló la suscripción. Intenta de nuevo.", 502);
        await syncPreapproval(sub.data.mp_preapproval_id);
      }
      const { error } = await db()
        .from("subscriptions")
        .update({ status: "cancelled", paid_until: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", sub.data.id);
      return error ? fail(error.message, 500) : NextResponse.json({ ok: true });
    }
    case "bloquear": {
      if (id === admin.id) return fail("No puedes bloquearte a ti mismo.");
      const { error } = await db().from("profiles").update({ blocked: Boolean(b.blocked) }).eq("id", id);
      return error ? fail(error.message, 500) : NextResponse.json({ ok: true });
    }
    case "admin": {
      if (id === admin.id) return fail("No puedes quitarte tus propios permisos.");
      const { error } = await db().from("profiles").update({ is_admin: Boolean(b.is_admin) }).eq("id", id);
      return error ? fail(error.message, 500) : NextResponse.json({ ok: true });
    }
    default:
      return fail("Acción desconocida.");
  }
}

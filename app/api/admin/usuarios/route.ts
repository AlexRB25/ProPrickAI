import { NextResponse } from "next/server";
import { db, requireAdmin } from "@/lib/server";

export const dynamic = "force-dynamic";

const PAGE = 50;

/** Usuarios registrados con créditos, suscripción vigente y última consulta. ?q=correo&page= */
export async function GET(req: Request) {
  const admin = await requireAdmin(req);
  if (admin instanceof NextResponse) return admin;
  const params = new URL(req.url).searchParams;
  const q = (params.get("q") ?? "").trim();
  const page = Math.max(0, Number(params.get("page")) || 0);

  let query = db()
    .from("profiles")
    .select("id, email, credits, is_admin, blocked, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(page * PAGE, page * PAGE + PAGE - 1);
  if (q) query = query.ilike("email", `%${q.replace(/[%_]/g, "")}%`);
  const { data, count, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const ids = (data ?? []).map((u) => u.id);
  const [subs, last] = await Promise.all([
    ids.length
      ? db().from("subscriptions").select("user_id, plan_id, status, source, paid_until").in("user_id", ids).gt("paid_until", new Date().toISOString()).in("status", ["authorized", "cancelled", "paused"])
      : Promise.resolve({ data: [] as { user_id: string; plan_id: string; status: string; source: string; paid_until: string }[] }),
    ids.length
      ? db().from("consultas").select("user_id, created_at").in("user_id", ids).order("created_at", { ascending: false }).limit(2000)
      : Promise.resolve({ data: [] as { user_id: string; created_at: string }[] }),
  ]);

  const users = (data ?? []).map((u) => {
    const s = (subs.data ?? []).find((x) => x.user_id === u.id) ?? null;
    const l = (last.data ?? []).find((x) => x.user_id === u.id);
    return { ...u, suscripcion: s, ultimaConsulta: l?.created_at ?? null };
  });
  return NextResponse.json({ users, total: count ?? 0, hayMas: (count ?? 0) > (page + 1) * PAGE });
}

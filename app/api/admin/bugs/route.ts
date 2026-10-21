import { NextResponse } from "next/server";
import { db, fail, requireAdmin } from "@/lib/server";

export const dynamic = "force-dynamic";

const ESTADOS = ["nuevo", "revisado", "resuelto"];

/** Reportes de fallas, más recientes primero. ?estado= */
export async function GET(req: Request) {
  const admin = await requireAdmin(req);
  if (admin instanceof NextResponse) return admin;
  const estado = new URL(req.url).searchParams.get("estado") ?? "";
  let query = db().from("bug_reports").select("*").order("created_at", { ascending: false }).limit(300);
  if (ESTADOS.includes(estado)) query = query.eq("estado", estado);
  const { data, error } = await query;
  return error ? fail(error.message, 500) : NextResponse.json({ bugs: data ?? [] });
}

/** Cambia el estado o la nota de un reporte. { id, estado, nota } */
export async function POST(req: Request) {
  const admin = await requireAdmin(req);
  if (admin instanceof NextResponse) return admin;
  const b = await req.json().catch(() => null);
  const update: Record<string, string> = {};
  if (ESTADOS.includes(b?.estado)) update.estado = b.estado;
  if (typeof b?.nota === "string") update.nota_admin = b.nota.slice(0, 2000);
  if (!Object.keys(update).length) return fail("Nada que cambiar");
  const { error } = await db().from("bug_reports").update(update).eq("id", Number(b?.id));
  return error ? fail(error.message, 500) : NextResponse.json({ ok: true });
}

import { NextResponse } from "next/server";
import { authUser, db, fail } from "@/lib/server";

const ESTADOS = ["pendiente", "ganada", "perdida", "push", "anulada"];

// Corrección manual de un pick (solo administradores).
export async function POST(req: Request) {
  const user = await authUser(req);
  if (!user?.isAdmin) return fail("No autorizado", 401);
  const { id, status } = await req.json().catch(() => ({}));
  if (typeof id !== "string" || !ESTADOS.includes(status)) return fail("Datos inválidos");
  const graded = status !== "pendiente";
  const { error } = await db()
    .from("picks")
    .update({
      status,
      graded_by: graded ? "admin" : null,
      graded_at: graded ? new Date().toISOString() : null,
      resultado: graded ? "Corregido por el administrador" : null,
    })
    .eq("id", id);
  return error ? fail(error.message, 500) : NextResponse.json({ ok: true });
}

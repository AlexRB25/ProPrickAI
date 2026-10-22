// Sección pública "Apuestas": votos, comentarios y estado de los parlays. Solo servidor.
import { db } from "./server";

export type Target = "pick" | "parlay";
export type Estado = "pendiente" | "ganada" | "perdida" | "push" | "anulada";

export interface Tally {
  si: number; // "le entra"
  no: number; // "no le entra"
}

/** Nombre público: el alias, o el inicio del correo con asteriscos. */
export function nombrePublico(email: string | null, alias: string | null) {
  if (alias?.trim()) return alias.trim();
  const local = (email ?? "").split("@")[0];
  return local ? `${local.slice(0, 3)}***` : "anónimo";
}

export async function tallies(type: Target, ids: string[]): Promise<Map<string, Tally>> {
  const out = new Map<string, Tally>(ids.map((id) => [id, { si: 0, no: 0 }]));
  if (!ids.length) return out;
  const { data } = await db().from("votos").select("target_id, valor").eq("target_type", type).in("target_id", ids).limit(100000);
  for (const v of data ?? []) {
    const t = out.get(v.target_id);
    if (t) v.valor > 0 ? t.si++ : t.no++;
  }
  return out;
}

export async function myVotes(userId: string | null, type: Target, ids: string[]): Promise<Map<string, number>> {
  if (!userId || !ids.length) return new Map();
  const { data } = await db().from("votos").select("target_id, valor").eq("user_id", userId).eq("target_type", type).in("target_id", ids);
  return new Map((data ?? []).map((v) => [v.target_id, v.valor]));
}

export async function commentCounts(type: Target, ids: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!ids.length) return out;
  const { data } = await db().from("comentarios").select("target_id").eq("target_type", type).eq("oculto", false).in("target_id", ids).limit(100000);
  for (const c of data ?? []) out.set(c.target_id, (out.get(c.target_id) ?? 0) + 1);
  return out;
}

/** Estado del parlay a partir de sus piernas: una perdida lo tumba; las anuladas o push no cuentan. */
export function parlayEstado(legs: Estado[]): Estado {
  if (legs.includes("perdida")) return "perdida";
  if (legs.includes("pendiente")) return "pendiente";
  if (legs.includes("ganada")) return "ganada";
  return legs.every((l) => l === "anulada") ? "anulada" : "push";
}

/** Estado de cada pick (para armar el de los parlays). */
export async function pickStatuses(ids: string[]): Promise<Map<string, Estado>> {
  if (!ids.length) return new Map();
  const { data } = await db().from("picks").select("id, status").in("id", ids);
  return new Map((data ?? []).map((p) => [p.id, p.status as Estado]));
}

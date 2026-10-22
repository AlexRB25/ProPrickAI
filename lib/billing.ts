// Créditos, acceso por suscripción e historial de consultas. Solo servidor.
import { db, type User } from "./server";

export type Accion =
  | "analisis"
  | "analisis_extendido"
  | "analisis_cache"
  | "parlay_partido"
  | "parlay_cache"
  | "ganador_partido"
  | "ganador_cache"
  | "captura";

const DEFAULT_TARIFAS: Record<Accion, number> = {
  analisis: 15,
  analisis_extendido: 5,
  analisis_cache: 3,
  parlay_partido: 10,
  parlay_cache: 2,
  ganador_partido: 3,
  ganador_cache: 1,
  captura: 15,
};

let tarifasCache: { at: number; value: Record<Accion, number> } | null = null;

/** Créditos por acción (tabla tarifas, editable en /admin). Se guardan 60 s en memoria. */
export async function getTarifas(): Promise<Record<Accion, number>> {
  if (tarifasCache && Date.now() - tarifasCache.at < 60000) return tarifasCache.value;
  const { data } = await db().from("tarifas").select("accion, creditos");
  const value = { ...DEFAULT_TARIFAS };
  for (const t of data ?? []) if (t.accion in value) value[t.accion as Accion] = Number(t.creditos);
  tarifasCache = { at: Date.now(), value };
  return value;
}

export const clearTarifasCache = () => (tarifasCache = null);

/** ¿Puede usar la IA? Admin siempre; los demás con suscripción vigente. */
export async function hasAccess(user: User): Promise<boolean> {
  if (user.isAdmin) return true;
  const { data, error } = await db().rpc("has_active_subscription", { p_user: user.id });
  if (error) throw new Error(`No se pudo revisar tu suscripción: ${error.message}`);
  return Boolean(data);
}

export async function balance(userId: string): Promise<number> {
  const { data } = await db().from("profiles").select("credits").eq("id", userId).maybeSingle();
  return Number(data?.credits ?? 0);
}

export type Charge = { ok: true; saldo: number | null } | { ok: false; saldo: number; necesita: number };

/** Cobra créditos antes de llamar a la IA. Los admins no pagan (saldo null = sin límite). */
export async function charge(user: User, creditos: number, ref: string): Promise<Charge> {
  if (user.isAdmin || creditos <= 0) return { ok: true, saldo: user.isAdmin ? null : await balance(user.id) };
  const { data, error } = await db().rpc("move_credits", { p_user: user.id, p_delta: -creditos, p_reason: "consulta", p_ref: ref.slice(0, 200) });
  if (error) {
    if (/saldo_insuficiente/.test(error.message)) return { ok: false, saldo: await balance(user.id), necesita: creditos };
    throw new Error(`No se pudieron cobrar los créditos: ${error.message}`);
  }
  return { ok: true, saldo: Number(data) };
}

/** Devuelve los créditos si la IA falló. */
export async function refund(user: User, creditos: number, ref: string): Promise<number | null> {
  if (user.isAdmin || creditos <= 0) return null;
  const { data } = await db().rpc("move_credits", { p_user: user.id, p_delta: creditos, p_reason: "reembolso", p_ref: ref.slice(0, 200) });
  return data == null ? null : Number(data);
}

export async function logConsulta(c: {
  userId: string | null;
  tipo: "analisis" | "parlay" | "ganadores" | "captura" | "calificacion";
  titulo: string;
  creditos: number;
  costo: number;
  cache?: boolean;
  ok?: boolean;
  error?: string;
}) {
  const { error } = await db()
    .from("consultas")
    .insert({
      user_id: c.userId,
      tipo: c.tipo,
      titulo: c.titulo.slice(0, 300),
      creditos: c.creditos,
      costo_usd: Math.round(c.costo * 10000) / 10000,
      cache: c.cache ?? false,
      ok: c.ok ?? true,
      error: c.error?.slice(0, 500) ?? null,
    });
  if (error) console.error("No se guardó la consulta:", error.message);
}

export const sinCreditos = (c: { saldo: number; necesita: number }) =>
  `Te faltan créditos: esto cuesta ${c.necesita} y tienes ${c.saldo}. Compra un paquete en Planes.`;

export const SIN_SUSCRIPCION = "Necesitas una suscripción activa para usar la IA. Elige un plan en Planes.";

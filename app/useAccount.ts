"use client";

import type { Session } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";
import type { Accion } from "@/lib/billing";
import { authFetch } from "@/lib/supabase-browser";

export interface Precio {
  monto: number;
  moneda: string;
}

export interface Plan {
  id: string;
  name: string;
  price_usd: number;
  months: number;
  credits: number;
  cobro: Precio | null;
}

export interface Pack {
  id: string;
  name: string;
  credits: number;
  price_usd: number;
  cobro: Precio | null;
}

export interface Suscripcion {
  id: string;
  plan_id: string;
  source: "mercadopago" | "admin";
  status: "pending" | "authorized" | "paused" | "cancelled";
  paid_until: string | null;
  next_payment_date: string | null;
}

export interface Account {
  plans: Plan[];
  packs: Pack[];
  tarifas: Record<Accion, number>;
  pagos: boolean;
  user: null | {
    email: string;
    isAdmin: boolean;
    credits: number;
    activa: boolean;
    suscripcion: Suscripcion | null;
  };
  historial: null | {
    consultas: { id: number; tipo: string; titulo: string; creditos: number; cache: boolean; ok: boolean; error: string | null; created_at: string }[];
    movimientos: { id: number; delta: number; balance_after: number; reason: string; ref: string | null; created_at: string }[];
  };
}

/** Cuenta del usuario (créditos, suscripción) y precios. Se recarga al entrar o salir. */
export function useAccount(session: Session | null, conHistorial = false) {
  const [account, setAccount] = useState<Account | null>(null);
  const reload = useCallback(async () => {
    try {
      const res = await authFetch(`/api/me${conHistorial ? "?historial=1" : ""}`, { cache: "no-store" });
      if (res.ok) setAccount(await res.json());
    } catch {
      // sin conexión: se queda lo último que hubo
    }
  }, [conHistorial]);
  useEffect(() => {
    reload();
  }, [reload, session?.user.id]);
  // Actualiza el saldo sin volver a pedir todo (después de una consulta).
  const setCredits = (n: number | null | undefined) =>
    n != null && setAccount((a) => (a?.user ? { ...a, user: { ...a.user, credits: n } } : a));
  return { account, reload, setCredits };
}

export const money = (p: Precio | null, usd: number) =>
  p ? `$${p.monto.toLocaleString("es-MX")} ${p.moneda}` : `US$${Number(usd).toFixed(2)}`;

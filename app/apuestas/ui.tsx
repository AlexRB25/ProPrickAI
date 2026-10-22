"use client";

import { sportInfo } from "@/lib/espn";
import { authFetch } from "@/lib/supabase-browser";

export interface Tally {
  si: number;
  no: number;
}

export type Estado = "pendiente" | "ganada" | "perdida" | "push" | "anulada";

const BADGE: Record<Estado, string> = {
  pendiente: "⏳ Pendiente",
  ganada: "✅ Ganada",
  perdida: "❌ Perdida",
  push: "↩️ Push",
  anulada: "🚫 Anulada",
};

export function EstadoTag({ estado }: { estado: Estado }) {
  return <span className={`tag ${estado === "ganada" ? "good" : estado === "perdida" ? "bad" : ""}`}>{BADGE[estado]}</span>;
}

export const fechaCorta = (iso: string) =>
  new Date(iso).toLocaleString("es-MX", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export const deporte = (s: string) => `${sportInfo(s).emoji} ${sportInfo(s).label}`;

/** Barra de votos: azul = le entra, naranja = no le entra, con porcentajes y conteos. */
export function VoteBar({ votos, ia, compact = false }: { votos: Tally; ia?: number; compact?: boolean }) {
  const total = votos.si + votos.no;
  const si = total ? Math.round((votos.si / total) * 100) : 0;
  return (
    <div className="votebar-wrap">
      {!compact && (
        <div className="legend small">
          <span><i style={{ background: "var(--s1)" }} /> Le entra</span>
          <span><i style={{ background: "var(--s2)" }} /> No le entra</span>
        </div>
      )}
      {total ? (
        <div className="votebar" role="img" aria-label={`${si}% dice que le entra, ${100 - si}% que no, de ${total} votos`}>
          {votos.si > 0 && <div style={{ width: `${si}%`, background: "var(--s1)" }} title={`Le entra: ${votos.si} votos`} />}
          {votos.no > 0 && <div style={{ width: `${100 - si}%`, background: "var(--s2)" }} title={`No le entra: ${votos.no} votos`} />}
        </div>
      ) : (
        <div className="votebar empty" />
      )}
      <div className="row small muted" style={{ justifyContent: "space-between" }}>
        <span>{total ? `${si}% le entra (${votos.si})` : "Sin votos todavía"}</span>
        {ia != null && <span>IA: {ia}%</span>}
        {total > 0 && <span>{100 - si}% no ({votos.no})</span>}
      </div>
    </div>
  );
}

/** Botones de voto. Devuelve el resultado al padre; pide sesión si hace falta. */
export function VoteButtons({
  type,
  id,
  miVoto,
  abierta,
  onChange,
  onNeedLogin,
  small = false,
}: {
  type: "pick" | "parlay";
  id: string;
  miVoto: number;
  abierta: boolean;
  onChange: (r: { votos: Tally; miVoto: number }) => void;
  onNeedLogin: () => void;
  small?: boolean;
}) {
  async function votar(valor: number) {
    const res = await authFetch("/api/votar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target_type: type, target_id: id, valor: miVoto === valor ? 0 : valor }),
    });
    if (res.status === 401) return onNeedLogin();
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return alert(d.error ?? "No se pudo votar.");
    onChange(d);
  }
  if (!abierta) return <span className="small muted">Votación cerrada</span>;
  return (
    <div className="row" style={{ gap: 6 }} onClick={(e) => e.preventDefault()}>
      <button className={`vote ${miVoto === 1 ? "on-si" : ""} ${small ? "sm" : ""}`} onClick={() => votar(1)}>👍 Le entra</button>
      <button className={`vote ${miVoto === -1 ? "on-no" : ""} ${small ? "sm" : ""}`} onClick={() => votar(-1)}>👎 No le entra</button>
    </div>
  );
}

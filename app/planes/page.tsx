"use client";

import { useEffect, useState } from "react";
import { authFetch, supabase } from "@/lib/supabase-browser";
import { LoginModal, useSession } from "../Auth";
import { money, useAccount, type Plan } from "../useAccount";

const ACCIONES: Record<string, string> = {
  analisis: "Análisis nuevo de un partido",
  analisis_extendido: "Extra con más de 3 mercados de estadísticas",
  analisis_cache: "Análisis que ya estaba en el caché",
  parlay_partido: "Parlay: cada partido nuevo",
  parlay_cache: "Parlay: cada partido en caché",
  ganador_partido: "Ganadores: cada partido nuevo",
  ganador_cache: "Ganadores: cada partido en caché",
  captura: "Captura de pantalla (ventana flotante)",
};

const MOTIVO: Record<string, string> = {
  suscripcion: "Suscripción",
  paquete: "Paquete",
  consulta: "Consulta",
  reembolso: "Devolución",
  admin: "Ajuste",
};

const fecha = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" }) : "—");
const fechaHora = (iso: string) => new Date(iso).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export default function Planes() {
  const { session } = useSession();
  const { account, reload } = useAccount(session, true);
  const [loginOpen, setLoginOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [planElegido, setPlanElegido] = useState<Plan | null>(null);
  const [mpEmail, setMpEmail] = useState("");
  const [tab, setTab] = useState<"consultas" | "movimientos">("consultas");

  const user = account?.user;

  // Al volver de Mercado Pago: activar sin esperar el webhook.
  useEffect(() => {
    if (!session) return;
    const q = new URLSearchParams(location.search);
    const pre = q.get("preapproval_id");
    const pay = q.get("payment_id") ?? q.get("collection_id");
    if (!pre && !pay) return;
    (async () => {
      setMsg("Confirmando tu pago con Mercado Pago…");
      if (pre) await authFetch("/api/suscripcion", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "sync", id: pre }) });
      if (pay) await authFetch("/api/creditos/sincronizar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ payment_id: pay }) });
      await reload();
      setMsg(q.get("status") === "rejected" ? "Mercado Pago rechazó el pago." : "¡Listo! Si tu pago fue aprobado, ya ves tus créditos. Si fue en efectivo o transferencia, se acreditan cuando Mercado Pago lo confirme.");
      history.replaceState(null, "", "/planes");
    })();
  }, [session, reload]);

  async function post(url: string, body: unknown) {
    setErr("");
    const res = await authFetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error ?? `Error ${res.status}`);
    return d;
  }

  async function suscribir() {
    if (!planElegido) return;
    setBusy(planElegido.id);
    try {
      const d = await post("/api/suscribir", { plan: planElegido.id, email: mpEmail });
      location.href = d.url;
    } catch (e) {
      setErr((e as Error).message);
      setBusy("");
    }
  }

  async function comprar(pack: string) {
    if (!session) return setLoginOpen(true);
    setBusy(pack);
    try {
      const d = await post("/api/creditos/comprar", { pack });
      location.href = d.url;
    } catch (e) {
      setErr((e as Error).message);
      setBusy("");
    }
  }

  async function cancelar() {
    if (!confirm("¿Cancelar tu suscripción? Ya no se cobrará; conservas el acceso hasta el final del periodo pagado y tus créditos.")) return;
    setBusy("cancel");
    try {
      await post("/api/suscripcion", { action: "cancel" });
      await reload();
      setMsg("Suscripción cancelada.");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  const sub = user?.suscripcion;
  const mensual = account?.plans.find((p) => p.months === 1);

  return (
    <div className="wrap">
      <div className="top">
        <a className="brand" href="/" style={{ textDecoration: "none", color: "inherit" }}>Pronósticos <span>IA</span></a>
        <div className="tabs">
          <a className="btn" href="/">← Volver</a>
          {session ? (
            <button className="btn" onClick={() => supabase().auth.signOut()}>Salir</button>
          ) : (
            <button className="btn primary" onClick={() => setLoginOpen(true)}>Entrar</button>
          )}
        </div>
      </div>

      <h1 style={{ fontSize: 22, margin: "0 0 4px" }}>💎 Planes y créditos</h1>
      <div className="muted small" style={{ marginBottom: 14 }}>
        Con tu suscripción usas la plataforma y recibes créditos cada periodo. Cada consulta a la IA gasta créditos; si se te acaban, compra un paquete.
      </div>

      {msg && <div className="warn small" style={{ marginBottom: 12 }}>{msg}</div>}
      {err && <div className="err small" style={{ marginBottom: 12 }}>{err}</div>}
      {account && !account.pagos && <div className="warn small" style={{ marginBottom: 12 }}>Los pagos todavía no están configurados en el servidor.</div>}

      {user && (
        <div className="tiles" style={{ marginBottom: 16 }}>
          <div className="tile">
            <div className="small muted">Tus créditos</div>
            <div className="tile-value">{user.isAdmin ? "∞" : user.credits}</div>
            <div className="small muted">{user.isAdmin ? "admin: consultas sin costo" : "no caducan"}</div>
          </div>
          <div className="tile">
            <div className="small muted">Suscripción</div>
            <div className="tile-value" style={{ fontSize: 20 }}>
              {user.activa ? (sub ? (account?.plans.find((p) => p.id === sub.plan_id)?.name ?? sub.plan_id) : "Admin") : sub?.status === "pending" ? "Pendiente de pago" : "Sin suscripción"}
            </div>
            <div className="small muted">
              {sub && user.activa && (sub.status === "authorized" && sub.source === "mercadopago" ? `Próximo cobro: ${fecha(sub.next_payment_date)}` : `Acceso hasta el ${fecha(sub.paid_until)}${sub.status === "cancelled" ? " (cancelada)" : ""}${sub.source === "admin" ? " · regalada" : ""}`)}
            </div>
            {sub?.status === "authorized" && sub.source === "mercadopago" && (
              <button className="link small" style={{ marginTop: 6 }} disabled={busy === "cancel"} onClick={cancelar}>Cancelar suscripción</button>
            )}
          </div>
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <h2>Suscripción</h2>
        <div className="plans">
          {account?.plans.map((p) => {
            const ahorro = mensual && p.months > 1 ? Math.round((1 - Number(p.price_usd) / (Number(mensual.price_usd) * p.months)) * 100) : 0;
            return (
              <div key={p.id} className={`plan ${p.months > 1 ? "featured" : ""}`}>
                <div className="row">
                  <b style={{ fontSize: 18 }}>{p.name}</b>
                  {ahorro > 0 && <span className="tag good" style={{ marginLeft: "auto" }}>Ahorras {ahorro}%</span>}
                </div>
                <div className="price">US${Number(p.price_usd).toFixed(2)} <span className="small muted">/ {p.months === 1 ? "mes" : p.months === 12 ? "año" : `${p.months} meses`}</span></div>
                {p.cobro && <div className="small muted">Se cobra {money(p.cobro, p.price_usd)}</div>}
                <ul className="reasons small">
                  <li><b>{p.credits} créditos</b> {p.months === 1 ? "cada mes" : `cada ${p.months === 12 ? "año" : `${p.months} meses`} (${Math.round(p.credits / p.months)} al mes)`}</li>
                  <li>Análisis de 30+ deportes, parlays y ventana flotante</li>
                  <li>Los créditos que no uses se acumulan</li>
                  <li>Cancela cuando quieras</li>
                </ul>
                <button
                  className="btn primary"
                  disabled={!account?.pagos || Boolean(busy) || (user?.activa && sub?.plan_id === p.id && sub.status === "authorized")}
                  onClick={() => {
                    if (!session) return setLoginOpen(true);
                    setPlanElegido(p);
                    setMpEmail(user?.email ?? "");
                  }}
                >
                  {user?.activa && sub?.plan_id === p.id && sub.status === "authorized" ? "Tu plan actual" : user?.activa ? "Cambiar a este plan" : "Suscribirme"}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2>Paquetes de créditos</h2>
        {!user?.activa && <div className="small muted" style={{ marginBottom: 8 }}>Disponibles con una suscripción activa.</div>}
        <div className="plans">
          {account?.packs.map((p) => (
            <div key={p.id} className="plan">
              <b style={{ fontSize: 18 }}>{p.credits} créditos</b>
              <div className="price">US${Number(p.price_usd).toFixed(2)}</div>
              <div className="small muted">
                {p.cobro ? `Se cobra ${money(p.cobro, p.price_usd)} · ` : ""}US${(Number(p.price_usd) / p.credits).toFixed(3)} por crédito
              </div>
              <button className="btn" disabled={!account?.pagos || !user?.activa || Boolean(busy)} onClick={() => comprar(p.id)}>
                {busy === p.id ? "Abriendo Mercado Pago…" : "Comprar"}
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="grid" style={{ marginBottom: 16 }}>
        <div className="card">
          <h2>¿Cuánto cuesta cada consulta?</h2>
          <table className="tbl small">
            <tbody>
              {account &&
                Object.entries(account.tarifas).map(([k, v]) => (
                  <tr key={k}>
                    <td>{ACCIONES[k] ?? k}</td>
                    <td style={{ textAlign: "right" }}><b>{v}</b> créditos</td>
                  </tr>
                ))}
            </tbody>
          </table>
          <div className="small muted" style={{ marginTop: 8 }}>
            Si alguien ya analizó ese partido hace poco, la respuesta sale del caché compartido y cuesta mucho menos. Si la IA falla, se te devuelven los créditos.
          </div>
        </div>

        {account?.historial && (
          <div className="card">
            <div className="row" style={{ marginBottom: 8 }}>
              <h2 style={{ margin: 0 }}>Tu historial</h2>
              <div className="row" style={{ marginLeft: "auto", gap: 6 }}>
                <button className={`mini ${tab === "consultas" ? "on" : ""}`} style={{ marginTop: 0 }} onClick={() => setTab("consultas")}>Consultas</button>
                <button className={`mini ${tab === "movimientos" ? "on" : ""}`} style={{ marginTop: 0 }} onClick={() => setTab("movimientos")}>Créditos</button>
              </div>
            </div>
            <div className="hist">
              {tab === "consultas"
                ? account.historial.consultas.map((c) => (
                    <div key={c.id} className="hist-row small">
                      <span className="muted">{fechaHora(c.created_at)}</span>
                      <span className="hist-title">{c.ok ? "" : "⚠ "}{c.titulo}{c.cache ? " · caché" : ""}</span>
                      <span>{c.creditos ? `−${c.creditos}` : "0"}</span>
                    </div>
                  ))
                : account.historial.movimientos.map((m) => (
                    <div key={m.id} className="hist-row small">
                      <span className="muted">{fechaHora(m.created_at)}</span>
                      <span className="hist-title">{MOTIVO[m.reason] ?? m.reason}{m.ref && m.reason !== "consulta" ? ` · ${m.ref}` : ""}</span>
                      <span className={m.delta > 0 ? "good" : ""}>{m.delta > 0 ? `+${m.delta}` : m.delta} → {m.balance_after}</span>
                    </div>
                  ))}
              {!(tab === "consultas" ? account.historial.consultas : account.historial.movimientos).length && <div className="muted small">Todavía no hay nada aquí.</div>}
            </div>
          </div>
        )}
      </div>

      {planElegido && (
        <div className="modal-bg" onClick={() => setPlanElegido(null)}>
          <div className="card modal stack" onClick={(e) => e.stopPropagation()}>
            <div className="row">
              <h2 style={{ margin: 0 }}>Plan {planElegido.name}</h2>
              <button className="x" style={{ marginLeft: "auto" }} aria-label="Cerrar" onClick={() => setPlanElegido(null)}>×</button>
            </div>
            <div className="small muted">
              Mercado Pago cobra {money(planElegido.cobro, planElegido.price_usd)} {planElegido.months === 1 ? "cada mes" : planElegido.months === 12 ? "cada año" : `cada ${planElegido.months} meses`} a tu tarjeta. Escribe el correo de tu cuenta de Mercado Pago:
            </div>
            <input className="field" type="email" value={mpEmail} onChange={(e) => setMpEmail(e.target.value)} placeholder="correo@mercadopago" />
            {user?.activa && <div className="warn small">Al autorizar el nuevo plan, el anterior se cancela.</div>}
            <button className="btn primary" disabled={Boolean(busy) || !mpEmail} onClick={suscribir}>{busy ? "Abriendo Mercado Pago…" : "Continuar a Mercado Pago"}</button>
          </div>
        </div>
      )}

      <div className="disclaimer">Precios en dólares; Mercado Pago cobra en pesos al tipo de cambio indicado. Apuesta solo lo que puedas perder. +18.</div>
      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />
    </div>
  );
}

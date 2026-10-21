"use client";

import { useCallback, useEffect, useState } from "react";
import { authFetch } from "@/lib/supabase-browser";
import { LoginModal, useSession } from "../Auth";
import { useAccount } from "../useAccount";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Tab = "resumen" | "usuarios" | "consultas" | "bugs" | "precios";

const usd = (n: number | null | undefined) => (n == null ? "—" : `US$${Number(n).toFixed(2)}`);
const fechaHora = (iso: string | null) => (iso ? new Date(iso).toLocaleString("es-MX", { day: "numeric", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");
const fecha = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" }) : "—");

async function api(url: string, body?: unknown) {
  const res = await authFetch(url, body === undefined ? { cache: "no-store" } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error ?? `Error ${res.status}`);
  return d;
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "bad" }) {
  return (
    <div className="tile">
      <div className="small muted">{label}</div>
      <div className={`tile-value ${tone ?? ""}`}>{value}</div>
      {sub && <div className="small muted">{sub}</div>}
    </div>
  );
}

function Resumen() {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    api("/api/admin/resumen").then(setD).catch((e) => setErr(e.message));
  }, []);
  if (err) return <div className="err small">{err}</div>;
  if (!d) return <div className="muted">Cargando…</div>;
  const margenOk = d.costoPorCredito == null || d.valorCreditoNeto == null || d.costoPorCredito <= d.valorCreditoNeto * 0.5;
  return (
    <div className="stack">
      <div className="tiles">
        <Tile label="Usuarios registrados" value={String(d.usuarios)} sub={`${d.nuevos30} nuevos en 30 días`} />
        <Tile label="Suscripciones activas" value={String(d.suscripcionesActivas)} sub={Object.entries(d.subsPorPlan).map(([k, v]) => `${k}: ${v}`).join(" · ") || "—"} />
        <Tile label="Ingresos (30 días)" value={usd(d.ingresos30)} sub={`suscripciones ${usd(d.ingresosPorTipo.suscripcion)} · paquetes ${usd(d.ingresosPorTipo.paquete)}`} />
        <Tile label="Costo de la IA (30 días)" value={usd(d.costoIa30)} sub={`${d.consultas30} consultas`} />
        <Tile label="Ganancia estimada (30 días)" value={usd(d.ganancia30)} sub={`ingreso neto ${usd(d.ingresosNetos30)} (−20% comisión e IVA) − IA`} tone={d.ganancia30 >= 0 ? "good" : "bad"} />
        <Tile label="Créditos sin usar" value={String(d.creditosEnCirculacion)} sub="de todos los usuarios" />
      </div>

      <div className={margenOk ? "warn small" : "err small"}>
        {d.costoPorCredito == null
          ? "Todavía no hay consultas cobradas para medir el margen."
          : `Cada crédito cobrado nos costó en IA ${usd(d.costoPorCredito)} en promedio; el crédito más barato que vendemos deja ${usd(d.valorCreditoNeto)} neto. ${margenOk ? "Margen sano (el costo es menos de la mitad)." : "⚠ El costo pasa de la mitad del valor del crédito: sube las tarifas o los precios en la pestaña Precios."}`}
      </div>

      <div className="card">
        <h2>Costo por tipo de consulta (30 días)</h2>
        <table className="tbl small">
          <thead>
            <tr><th>Tipo</th><th>Consultas</th><th>Del caché</th><th>Créditos cobrados</th><th>Costo IA</th><th>Costo prom. nueva</th><th>Costo por crédito</th></tr>
          </thead>
          <tbody>
            {d.porTipo.map((t: any) => (
              <tr key={t.tipo}>
                <td>{t.tipo}</td>
                <td>{t.consultas}</td>
                <td>{t.deCache}</td>
                <td>{t.creditos}</td>
                <td>{usd(t.costo)}</td>
                <td>{t.costoPromedioNueva == null ? "—" : `US$${t.costoPromedioNueva}`}</td>
                <td>{t.costoPorCredito == null ? "—" : `US$${t.costoPorCredito}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="small muted" style={{ marginTop: 6 }}>
          "calificacion" es la IA calificando picks para Efectividad: no se cobra al usuario. Tipo de cambio: {d.tipoCambio ? `${d.tipoCambio} MXN por dólar` : "sin configurar"}.
        </div>
      </div>
    </div>
  );
}

function UserDetail({ id, onClose, plans }: { id: string; onClose: () => void; plans: { id: string; name: string }[] }) {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [delta, setDelta] = useState("");
  const [motivo, setMotivo] = useState("");
  const [plan, setPlan] = useState(plans[0]?.id ?? "mensual");
  const [meses, setMeses] = useState("1");
  const [tab, setTab] = useState<"consultas" | "movimientos" | "pagos">("consultas");

  const load = useCallback(() => api(`/api/admin/usuario?id=${id}`).then(setD).catch((e) => setErr(e.message)), [id]);
  useEffect(() => {
    load();
  }, [load]);

  async function act(body: any, done: string) {
    setErr("");
    setOk("");
    try {
      await api("/api/admin/usuario", { id, ...body });
      setOk(done);
      await load();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  const now = Date.now();
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="card modal stack" style={{ maxWidth: 820, maxHeight: "92vh", overflow: "auto" }} onClick={(e) => e.stopPropagation()}>
        <div className="row">
          <h2 style={{ margin: 0 }}>{d?.profile.email ?? "Usuario"}</h2>
          <button className="x" style={{ marginLeft: "auto" }} aria-label="Cerrar" onClick={onClose}>×</button>
        </div>
        {err && <div className="err small">{err}</div>}
        {ok && <div className="warn small">{ok}</div>}
        {!d ? (
          <div className="muted">Cargando…</div>
        ) : (
          <>
            <div className="tiles">
              <Tile label="Créditos" value={String(d.profile.credits)} />
              <Tile label="Registrado" value={fecha(d.profile.created_at)} sub={`${d.profile.is_admin ? "admin · " : ""}${d.profile.blocked ? "BLOQUEADO" : "activo"}`} />
              <Tile label="Pagado en total" value={`${d.pagos.reduce((n: number, p: any) => n + Number(p.amount), 0).toLocaleString("es-MX")} ${d.pagos[0]?.currency ?? ""}`} sub={`${d.pagos.length} pagos`} />
            </div>

            <div className="card">
              <h2>Créditos</h2>
              <div className="row">
                <input className="field" style={{ width: 110 }} type="number" placeholder="+50 o −20" value={delta} onChange={(e) => setDelta(e.target.value)} />
                <input className="field" style={{ flex: 1, minWidth: 160 }} placeholder="Motivo (opcional)" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
                <button className="btn primary" disabled={!Number(delta)} onClick={() => act({ action: "creditos", delta: Number(delta), motivo }, `Créditos ${Number(delta) > 0 ? "agregados" : "quitados"}.`).then(() => { setDelta(""); setMotivo(""); })}>
                  Aplicar
                </button>
              </div>
            </div>

            <div className="card">
              <h2>Suscripciones</h2>
              <div className="stack" style={{ gap: 6 }}>
                {d.suscripciones.map((s: any) => {
                  const vigente = ["authorized", "cancelled", "paused"].includes(s.status) && s.paid_until && Date.parse(s.paid_until) > now;
                  return (
                    <div key={s.id} className="hist-row small" style={{ gridTemplateColumns: "minmax(0,1fr) auto" }}>
                      <span>
                        <b>{s.plan_id}</b> · {s.source === "admin" ? "regalada" : "Mercado Pago"} · {s.status} · hasta {fecha(s.paid_until)} {vigente ? <span className="good">· vigente</span> : <span className="muted">· vencida</span>}
                      </span>
                      {vigente && <button className="link" onClick={() => confirm("¿Terminar esta suscripción hoy?") && act({ action: "quitar_suscripcion", subscription_id: s.id }, "Suscripción terminada.")}>Quitar</button>}
                    </div>
                  );
                })}
                {!d.suscripciones.length && <div className="muted small">Sin suscripciones.</div>}
              </div>
              <div className="row" style={{ marginTop: 10 }}>
                <span className="small">Regalar</span>
                <select className="field" style={{ width: "auto" }} value={plan} onChange={(e) => setPlan(e.target.value)}>
                  {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <span className="small">por</span>
                <input className="field" style={{ width: 70 }} type="number" min={1} max={36} value={meses} onChange={(e) => setMeses(e.target.value)} />
                <span className="small">meses</span>
                <button className="btn" onClick={() => act({ action: "dar_suscripcion", plan_id: plan, meses: Number(meses) }, "Suscripción regalada (con sus créditos).")}>Dar suscripción</button>
              </div>
            </div>

            <div className="row">
              <button className="btn danger" onClick={() => act({ action: "bloquear", blocked: !d.profile.blocked }, d.profile.blocked ? "Cuenta desbloqueada." : "Cuenta bloqueada.")}>
                {d.profile.blocked ? "Desbloquear cuenta" : "Bloquear cuenta"}
              </button>
              <button className="btn" onClick={() => act({ action: "admin", is_admin: !d.profile.is_admin }, "Permisos actualizados.")}>
                {d.profile.is_admin ? "Quitar admin" : "Hacer admin"}
              </button>
            </div>

            <div className="card">
              <div className="row" style={{ marginBottom: 8 }}>
                <h2 style={{ margin: 0 }}>Historial</h2>
                <div className="row" style={{ marginLeft: "auto", gap: 6 }}>
                  {(["consultas", "movimientos", "pagos"] as const).map((t) => (
                    <button key={t} className={`mini ${tab === t ? "on" : ""}`} style={{ marginTop: 0 }} onClick={() => setTab(t)}>{t}</button>
                  ))}
                </div>
              </div>
              <div className="hist">
                {tab === "consultas" &&
                  d.consultas.map((c: any) => (
                    <div key={c.id} className="hist-row small" style={{ gridTemplateColumns: "auto minmax(0,1fr) auto auto" }}>
                      <span className="muted">{fechaHora(c.created_at)}</span>
                      <span className="hist-title" title={c.error ?? c.titulo}>{c.ok ? "" : "⚠ "}{c.tipo} · {c.titulo}{c.cache ? " · caché" : ""}</span>
                      <span>{c.creditos} cr</span>
                      <span className="muted">${Number(c.costo_usd).toFixed(3)}</span>
                    </div>
                  ))}
                {tab === "movimientos" &&
                  d.movimientos.map((m: any) => (
                    <div key={m.id} className="hist-row small">
                      <span className="muted">{fechaHora(m.created_at)}</span>
                      <span className="hist-title">{m.reason}{m.ref ? ` · ${m.ref}` : ""}</span>
                      <span className={m.delta > 0 ? "good" : ""}>{m.delta > 0 ? `+${m.delta}` : m.delta} → {m.balance_after}</span>
                    </div>
                  ))}
                {tab === "pagos" &&
                  d.pagos.map((p: any) => (
                    <div key={p.mp_id} className="hist-row small">
                      <span className="muted">{fechaHora(p.created_at)}</span>
                      <span className="hist-title">{p.kind} · {p.ref} · {p.mp_id}</span>
                      <span>{Number(p.amount).toLocaleString("es-MX")} {p.currency} · +{p.credits} cr</span>
                    </div>
                  ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Usuarios({ plans }: { plans: { id: string; name: string }[] }) {
  const [q, setQ] = useState("");
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const load = useCallback(() => api(`/api/admin/usuarios?q=${encodeURIComponent(q)}`).then(setD).catch((e) => setErr(e.message)), [q]);
  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
  }, [load]);
  return (
    <div className="stack">
      <input className="field" placeholder="Buscar por correo…" value={q} onChange={(e) => setQ(e.target.value)} />
      {err && <div className="err small">{err}</div>}
      {d && <div className="small muted">{d.total} usuarios</div>}
      <div className="card" style={{ overflowX: "auto" }}>
        <table className="tbl small">
          <thead>
            <tr><th>Correo</th><th>Créditos</th><th>Suscripción</th><th>Última consulta</th><th>Registro</th></tr>
          </thead>
          <tbody>
            {d?.users.map((u: any) => (
              <tr key={u.id} className="clickable" onClick={() => setSel(u.id)}>
                <td>{u.email}{u.is_admin ? " · admin" : ""}{u.blocked ? " · 🚫" : ""}</td>
                <td>{u.credits}</td>
                <td>{u.suscripcion ? <span className="good">{u.suscripcion.plan_id}{u.suscripcion.source === "admin" ? " (regalada)" : ""} · hasta {fecha(u.suscripcion.paid_until)}</span> : <span className="muted">—</span>}</td>
                <td>{fechaHora(u.ultimaConsulta)}</td>
                <td>{fecha(u.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sel && <UserDetail id={sel} plans={plans} onClose={() => { setSel(null); load(); }} />}
    </div>
  );
}

function Consultas() {
  const [tipo, setTipo] = useState("");
  const [rows, setRows] = useState<any[]>([]);
  const [page, setPage] = useState(0);
  const [hayMas, setHayMas] = useState(false);
  const [err, setErr] = useState("");
  const load = useCallback(
    (p: number) =>
      api(`/api/admin/consultas?tipo=${tipo}&page=${p}`)
        .then((d) => {
          setRows((r) => (p === 0 ? d.consultas : [...r, ...d.consultas]));
          setHayMas(d.hayMas);
          setPage(p);
        })
        .catch((e) => setErr(e.message)),
    [tipo],
  );
  useEffect(() => {
    load(0);
  }, [load]);
  return (
    <div className="stack">
      <div className="row" style={{ gap: 6 }}>
        {["", "analisis", "parlay", "captura", "calificacion"].map((t) => (
          <button key={t} className={`mini ${tipo === t ? "on" : ""}`} style={{ marginTop: 0 }} onClick={() => setTipo(t)}>{t || "todas"}</button>
        ))}
      </div>
      {err && <div className="err small">{err}</div>}
      <div className="card" style={{ overflowX: "auto" }}>
        <table className="tbl small">
          <thead>
            <tr><th>Fecha</th><th>Usuario</th><th>Tipo</th><th>Consulta</th><th>Créditos</th><th>Costo IA</th></tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td>{fechaHora(c.created_at)}</td>
                <td>{c.email}</td>
                <td>{c.tipo}{c.cache ? " · caché" : ""}</td>
                <td title={c.error ?? ""}>{c.ok ? "" : "⚠ "}{c.titulo}</td>
                <td>{c.creditos}</td>
                <td>${Number(c.costo_usd).toFixed(3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {hayMas && <button className="btn" style={{ marginTop: 10 }} onClick={() => load(page + 1)}>Ver más</button>}
      </div>
    </div>
  );
}

function Bugs() {
  const [estado, setEstado] = useState("nuevo");
  const [bugs, setBugs] = useState<any[]>([]);
  const [err, setErr] = useState("");
  const load = useCallback(() => api(`/api/admin/bugs?estado=${estado}`).then((d) => setBugs(d.bugs)).catch((e) => setErr(e.message)), [estado]);
  useEffect(() => {
    load();
  }, [load]);
  async function cambiar(id: number, body: any) {
    try {
      await api("/api/admin/bugs", { id, ...body });
      load();
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  return (
    <div className="stack">
      <div className="row" style={{ gap: 6 }}>
        {["nuevo", "revisado", "resuelto", ""].map((e) => (
          <button key={e} className={`mini ${estado === e ? "on" : ""}`} style={{ marginTop: 0 }} onClick={() => setEstado(e)}>{e || "todos"}</button>
        ))}
      </div>
      {err && <div className="err small">{err}</div>}
      {!bugs.length && <div className="muted">No hay reportes.</div>}
      {bugs.map((b) => (
        <div key={b.id} className="card stack" style={{ gap: 6 }}>
          <div className="small muted">{fechaHora(b.created_at)} · {b.email || "sin correo"} · {b.pagina || "—"}</div>
          <div style={{ whiteSpace: "pre-wrap" }}>{b.mensaje}</div>
          <div className="small muted" title={b.user_agent}>{(b.user_agent ?? "").slice(0, 90)}</div>
          <div className="row">
            <select className="field" style={{ width: "auto" }} value={b.estado} onChange={(e) => cambiar(b.id, { estado: e.target.value })}>
              <option value="nuevo">Nuevo</option>
              <option value="revisado">Revisado</option>
              <option value="resuelto">Resuelto</option>
            </select>
            <input className="field" style={{ flex: 1, minWidth: 160 }} placeholder="Nota interna" defaultValue={b.nota_admin ?? ""} onBlur={(e) => e.target.value !== (b.nota_admin ?? "") && cambiar(b.id, { nota: e.target.value })} />
          </div>
        </div>
      ))}
    </div>
  );
}

function Precios() {
  const [d, setD] = useState<any>(null);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  useEffect(() => {
    api("/api/admin/config").then(setD).catch((e) => setErr(e.message));
  }, []);
  const edit = (list: "plans" | "packs" | "tarifas", i: number, key: string, v: any) =>
    setD((x: any) => ({ ...x, [list]: x[list].map((r: any, j: number) => (j === i ? { ...r, [key]: v } : r)) }));
  async function guardar() {
    setMsg("");
    setErr("");
    try {
      await api("/api/admin/config", d);
      setMsg("Precios guardados. Aplican a compras y consultas nuevas.");
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  if (!d) return err ? <div className="err small">{err}</div> : <div className="muted">Cargando…</div>;
  const num = (v: string) => (v === "" ? "" : Number(v));
  return (
    <div className="stack">
      <div className="card" style={{ overflowX: "auto" }}>
        <h2>Planes de suscripción</h2>
        <table className="tbl small">
          <thead><tr><th>Id</th><th>Nombre</th><th>Precio US$</th><th>Cada (meses)</th><th>Créditos por cobro</th><th>US$/crédito</th><th>Activo</th></tr></thead>
          <tbody>
            {d.plans.map((p: any, i: number) => (
              <tr key={p.id}>
                <td>{p.id}</td>
                <td><input className="field" value={p.name} onChange={(e) => edit("plans", i, "name", e.target.value)} /></td>
                <td><input className="field" type="number" step="0.01" value={p.price_usd} onChange={(e) => edit("plans", i, "price_usd", num(e.target.value))} /></td>
                <td><input className="field" type="number" value={p.months} onChange={(e) => edit("plans", i, "months", num(e.target.value))} /></td>
                <td><input className="field" type="number" value={p.credits} onChange={(e) => edit("plans", i, "credits", num(e.target.value))} /></td>
                <td>{p.credits ? (p.price_usd / p.credits).toFixed(3) : "—"}</td>
                <td><input type="checkbox" checked={p.active} onChange={(e) => edit("plans", i, "active", e.target.checked)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card" style={{ overflowX: "auto" }}>
        <h2>Paquetes de créditos</h2>
        <table className="tbl small">
          <thead><tr><th>Id</th><th>Nombre</th><th>Créditos</th><th>Precio US$</th><th>US$/crédito</th><th>Activo</th></tr></thead>
          <tbody>
            {d.packs.map((p: any, i: number) => (
              <tr key={p.id}>
                <td>{p.id}</td>
                <td><input className="field" value={p.name} onChange={(e) => edit("packs", i, "name", e.target.value)} /></td>
                <td><input className="field" type="number" value={p.credits} onChange={(e) => edit("packs", i, "credits", num(e.target.value))} /></td>
                <td><input className="field" type="number" step="0.01" value={p.price_usd} onChange={(e) => edit("packs", i, "price_usd", num(e.target.value))} /></td>
                <td>{p.credits ? (p.price_usd / p.credits).toFixed(3) : "—"}</td>
                <td><input type="checkbox" checked={p.active} onChange={(e) => edit("packs", i, "active", e.target.checked)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card">
        <h2>Créditos por acción</h2>
        <table className="tbl small">
          <tbody>
            {d.tarifas.map((t: any, i: number) => (
              <tr key={t.accion}>
                <td>{t.descripcion}</td>
                <td style={{ width: 120 }}><input className="field" type="number" value={t.creditos} onChange={(e) => edit("tarifas", i, "creditos", num(e.target.value))} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {msg && <div className="warn small">{msg}</div>}
      {err && <div className="err small">{err}</div>}
      <button className="btn primary" onClick={guardar}>Guardar precios</button>
      <div className="small muted">Las suscripciones ya creadas en Mercado Pago siguen cobrando el monto con el que se crearon.</div>
    </div>
  );
}

export default function Admin() {
  const { session } = useSession();
  const { account } = useAccount(session);
  const [tab, setTab] = useState<Tab>("resumen");
  const [loginOpen, setLoginOpen] = useState(false);
  const isAdmin = account?.user?.isAdmin;

  return (
    <div className="wrap">
      <div className="top">
        <a className="brand" href="/" style={{ textDecoration: "none", color: "inherit" }}>Pronósticos <span>IA</span> · Admin</a>
        <div className="tabs">
          {(["resumen", "usuarios", "consultas", "bugs", "precios"] as Tab[]).map((t) => (
            <button key={t} className={`btn ${tab === t ? "on" : ""}`} onClick={() => setTab(t)}>
              {{ resumen: "Resumen", usuarios: "Usuarios", consultas: "Consultas", bugs: "Fallas", precios: "Precios" }[t]}
            </button>
          ))}
          <a className="btn" href="/">← App</a>
        </div>
      </div>
      {!session ? (
        <div className="card stack">
          <div>Entra con una cuenta de administrador.</div>
          <button className="btn primary" onClick={() => setLoginOpen(true)}>Entrar</button>
        </div>
      ) : !account ? (
        <div className="muted">Cargando…</div>
      ) : !isAdmin ? (
        <div className="err small">Tu cuenta no es de administrador.</div>
      ) : (
        <>
          {tab === "resumen" && <Resumen />}
          {tab === "usuarios" && <Usuarios plans={account.plans} />}
          {tab === "consultas" && <Consultas />}
          {tab === "bugs" && <Bugs />}
          {tab === "precios" && <Precios />}
        </>
      )}
      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />
    </div>
  );
}

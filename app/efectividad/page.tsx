"use client";

import { useCallback, useEffect, useState } from "react";
import { sportInfo } from "@/lib/espn";
import type { Group, PickPublic, Stats, Status } from "@/lib/efectividad";
import { authFetch, supabase, supabaseConfigured } from "@/lib/supabase-browser";
import { LoginModal, useSession } from "../Auth";
import { BlockingLoader } from "../BlockingLoader";

interface Data {
  stats: Stats;
  picks: PickPublic[];
  hayMas: boolean;
  totalLista: number;
  filtros: { sports: string[]; leagues: string[] };
}

const ESTADOS: { id: "" | Status; label: string }[] = [
  { id: "", label: "Todos" },
  { id: "pendiente", label: "⏳ Pendientes" },
  { id: "ganada", label: "✅ Ganadas" },
  { id: "perdida", label: "❌ Perdidas" },
  { id: "push", label: "↩️ Push" },
  { id: "anulada", label: "🚫 Anuladas" },
];

const BADGE: Record<Status, string> = {
  pendiente: "⏳ Pendiente",
  ganada: "✅ Ganada",
  perdida: "❌ Perdida",
  push: "↩️ Push",
  anulada: "🚫 Anulada",
};

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

const pctTxt = (n: number | null) => (n == null ? "—" : `${n}%`);

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="tile">
      <div className="small muted">{label}</div>
      <div className="tile-value">{value}</div>
      {sub && <div className="small muted">{sub}</div>}
    </div>
  );
}

// Calibración: por tramo de probabilidad, lo que dijo la IA (promedio) vs lo que pasó (% real).
function Calibration({ rows }: { rows: Stats["calibracion"] }) {
  const H = 160;
  return (
    <div>
      <div className="legend small">
        <span><i style={{ background: "var(--s1)" }} /> Lo que dijo la IA</span>
        <span><i style={{ background: "var(--s2)" }} /> Lo que pasó</span>
      </div>
      <div className="calib" role="img" aria-label="Calibración: probabilidad que dio la IA contra porcentaje que se cumplió, por tramo">
        {rows.map((r) => (
          <div key={r.key} className="calib-col">
            <div className="calib-bars" style={{ height: H }}>
              {r.decididas ? (
                <>
                  <div className="bar-v" style={{ height: `${((r.esperado ?? 0) / 100) * H}px`, background: "var(--s1)" }} title={`${r.key}: la IA dijo ${r.esperado}% en promedio (${r.decididas} picks)`}>
                    <span>{Math.round(r.esperado ?? 0)}</span>
                  </div>
                  <div className="bar-v" style={{ height: `${((r.acierto ?? 0) / 100) * H}px`, background: "var(--s2)" }} title={`${r.key}: se cumplió el ${r.acierto}% (${r.ganadas} de ${r.decididas})`}>
                    <span>{Math.round(r.acierto ?? 0)}</span>
                  </div>
                </>
              ) : (
                <div className="small muted" style={{ alignSelf: "center" }}>sin datos</div>
              )}
            </div>
            <div className="small">{r.key}</div>
            <div className="small muted">{r.decididas} picks</div>
          </div>
        ))}
      </div>
      <div className="small muted" style={{ marginTop: 6 }}>
        Si las dos barras de cada tramo miden parecido, los porcentajes de la IA son confiables.
      </div>
    </div>
  );
}

function GroupTable({ title, rows, label }: { title: string; rows: Group[]; label: (k: string) => string }) {
  if (!rows.length) return null;
  return (
    <div className="card">
      <h2>{title}</h2>
      <table className="tbl small">
        <thead>
          <tr><th></th><th>Picks</th><th>Acierto</th><th>Esperado</th></tr>
        </thead>
        <tbody>
          {rows.map((g) => (
            <tr key={g.key}>
              <td>{label(g.key)}</td>
              <td>{g.decididas}</td>
              <td className={g.acierto != null && g.esperado != null ? (g.acierto >= g.esperado ? "good" : "bad") : ""}>{pctTxt(g.acierto)}</td>
              <td className="muted">{pctTxt(g.esperado)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Efectividad() {
  const { session } = useSession();
  const [isAdmin, setIsAdmin] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [sport, setSport] = useState("");
  const [league, setLeague] = useState("");
  const [status, setStatus] = useState<"" | Status>("");
  const [page, setPage] = useState(0);
  const [data, setData] = useState<Data | null>(null);
  const [list, setList] = useState<PickPublic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [grading, setGrading] = useState("");

  useEffect(() => {
    if (!session || !supabaseConfigured) return setIsAdmin(false);
    supabase()
      .from("profiles")
      .select("is_admin")
      .eq("id", session.user.id)
      .maybeSingle()
      .then(({ data: p }) => setIsAdmin(Boolean(p?.is_admin)));
  }, [session]);

  const load = useCallback(
    async (p: number) => {
      setLoading(true);
      setError("");
      try {
        const q = new URLSearchParams({ sport, league, status, page: String(p) });
        const res = await fetch(`/api/efectividad?${q}`, { cache: "no-store" });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error ?? `Error ${res.status}`);
        setData(d);
        setList((prev) => (p === 0 ? d.picks : [...prev, ...d.picks]));
        setPage(p);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [sport, league, status],
  );

  useEffect(() => {
    load(0);
  }, [load]);

  async function calificar() {
    setGrading("Calificando partidos terminados…");
    const res = await authFetch("/api/cron/calificar", { method: "POST" });
    const d = await res.json().catch(() => ({}));
    setGrading(res.ok ? `Listo: ${d.calificados} picks calificados en ${d.partidos} partidos${d.errores?.length ? ` (${d.errores.length} con error)` : ""}.` : d.error ?? "Error");
    load(0);
  }

  async function corregir(id: string, st: Status) {
    const res = await authFetch("/api/admin/pick", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: st }),
    });
    if (res.ok) setList((l) => l.map((p) => (p.id === id ? { ...p, status: st } : p)));
  }

  const s = data?.stats;
  const decididas = s ? s.ganadas + s.perdidas : 0;

  return (
    <div className="wrap">
      <div className="top">
        <a className="brand" href="/" style={{ textDecoration: "none", color: "inherit" }}>ProPicks<span>AI</span></a>
        <div className="tabs">
          <a className="btn" href="/">← Volver</a>
          <a className="btn" href="/apuestas">🗳️ Apuestas</a>
          {isAdmin && <button className="btn" onClick={calificar}>Calificar ahora</button>}
          {session ? (
            <button className="btn" onClick={() => supabase().auth.signOut()}>Salir</button>
          ) : (
            <button className="btn primary" onClick={() => setLoginOpen(true)}>Entrar</button>
          )}
        </div>
      </div>

      <h1 style={{ fontSize: 22, margin: "0 0 4px" }}>📊 Efectividad</h1>
      <div className="muted small" style={{ marginBottom: 14 }}>
        Todos los picks que ha dado la IA y cómo terminaron. Se califican solos cuando acaba cada partido.
      </div>

      <div className="card row" style={{ marginBottom: 14 }}>
        <select className="field" style={{ width: "auto" }} value={sport} onChange={(e) => { setSport(e.target.value); setLeague(""); }}>
          <option value="">Todos los deportes</option>
          {data?.filtros.sports.map((sp) => <option key={sp} value={sp}>{sportInfo(sp).emoji} {sportInfo(sp).label}</option>)}
        </select>
        <select className="field" style={{ width: "auto" }} value={league} onChange={(e) => setLeague(e.target.value)}>
          <option value="">Todas las ligas</option>
          {data?.filtros.leagues.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <div className="row" style={{ gap: 6 }}>
          {ESTADOS.map((e) => (
            <button key={e.id} className={`mini ${status === e.id ? "on" : ""}`} style={{ marginTop: 0 }} onClick={() => setStatus(e.id)}>{e.label}</button>
          ))}
        </div>
      </div>

      {grading && <div className="warn small" style={{ marginBottom: 12 }}>{grading}</div>}
      {error && <div className="err small" style={{ marginBottom: 12 }}>{error}</div>}

      {s && (
        <div className="stack">
          <div className="tiles">
            <Tile label="Acierto" value={pctTxt(s.acierto)} sub={s.esperado != null ? `la IA esperaba ${s.esperado}%` : "aún sin picks calificados"} />
            <Tile label="Ganadas / perdidas" value={`${s.ganadas} / ${s.perdidas}`} sub={`${s.push} push · ${s.anuladas} anuladas`} />
            <Tile label="Pendientes" value={String(s.pendientes)} sub="esperando resultado" />
            <Tile
              label="Rendimiento (ROI)"
              value={s.roi == null ? "—" : `${s.roi > 0 ? "+" : ""}${s.roi}%`}
              sub={s.conMomio ? `apostando lo mismo a ${s.conMomio} picks con momio` : "sin picks con momio"}
            />
          </div>
          {decididas > 0 && decididas < 100 && (
            <div className="warn small">Solo hay {decididas} picks calificados con este filtro: con menos de ~100 los porcentajes todavía cambian mucho.</div>
          )}

          <div className="grid">
            <div className="card">
              <h2>Calibración</h2>
              <Calibration rows={s.calibracion} />
            </div>
            <div className="stack">
              <GroupTable title="Por deporte" rows={s.porDeporte} label={(k) => `${sportInfo(k).emoji} ${sportInfo(k).label}`} />
              <GroupTable title="Por mercado" rows={s.porMercado} label={(k) => k} />
            </div>
          </div>

          <div className="card">
            <h2>Picks más recientes {data && <span className="muted small">({data.totalLista})</span>}</h2>
            {!list.length && !loading && <div className="muted">Todavía no hay picks con este filtro.</div>}
            <div className="stack" style={{ gap: 8 }}>
              {list.map((p) => (
                <div key={p.id} className={`pickrow st-${p.status}`}>
                  <div style={{ minWidth: 0 }}>
                    <div className="small muted">
                      {sportInfo(p.sport).emoji} {p.league_name} · {fmtDate(p.game_date)} · {p.title}
                    </div>
                    <div><b>{p.seleccion}</b> <span className="muted small">({p.mercado})</span></div>
                    {p.resultado && <div className="small muted">{p.resultado}{p.graded_by === "web" ? " · calificado con búsqueda web" : ""}</div>}
                  </div>
                  <div className="pickrow-side">
                    <div className="small">{p.probabilidad}%{p.cuota ? ` · ${p.cuota}${p.cuota_estimada ? "~" : ""}` : ""}</div>
                    {isAdmin ? (
                      <select className="field small" style={{ width: "auto", padding: "4px 6px" }} value={p.status} onChange={(e) => corregir(p.id, e.target.value as Status)}>
                        {ESTADOS.filter((e) => e.id).map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
                      </select>
                    ) : (
                      <span className={`tag ${p.status === "ganada" ? "good" : p.status === "perdida" ? "bad" : ""}`}>{BADGE[p.status]}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {data?.hayMas && (
              <button className="btn" style={{ marginTop: 12 }} disabled={loading} onClick={() => load(page + 1)}>
                {loading ? "Cargando…" : "Ver más"}
              </button>
            )}
          </div>
        </div>
      )}
      {loading && !s && <div className="muted">Cargando…</div>}

      <div className="disclaimer">Resultados pasados no garantizan resultados futuros. Apuesta solo lo que puedas perder. +18.</div>
      <BlockingLoader show={grading === "Calificando partidos terminados…"} quick title="Calificando partidos terminados…" detail="Comparando cada pick con el resultado oficial" />
      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />
    </div>
  );
}

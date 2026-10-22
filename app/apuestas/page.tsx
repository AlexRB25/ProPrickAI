"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SPORTS } from "@/lib/espn";
import { authFetch, supabase } from "@/lib/supabase-browser";
import { LoginModal, useSession } from "../Auth";
import { deporte, EstadoTag, fechaCorta, VoteBar, VoteButtons, type Estado, type Tally } from "./ui";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Tipo = "individual" | "parlay";
type Orden = "recientes" | "votadas" | "proximas";

const ORDENES: { id: Orden; label: string }[] = [
  { id: "recientes", label: "Más recientes" },
  { id: "votadas", label: "Más votadas" },
  { id: "proximas", label: "Próximas a jugarse" },
];

export default function Apuestas() {
  const { session } = useSession();
  const [loginOpen, setLoginOpen] = useState(false);
  const [tipo, setTipo] = useState<Tipo>("individual");
  const [sport, setSport] = useState("");
  const [orden, setOrden] = useState<Orden>("recientes");
  const [items, setItems] = useState<any[]>([]);
  const [page, setPage] = useState(0);
  const [hayMas, setHayMas] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const reqId = useRef(0);

  const load = useCallback(
    async (p: number) => {
      const mine = ++reqId.current;
      setLoading(true);
      setError("");
      try {
        const q = new URLSearchParams({ tipo, sport, orden, page: String(p) });
        const res = await authFetch(`/api/apuestas?${q}`, { cache: "no-store" });
        const d = await res.json();
        if (mine !== reqId.current) return; // llegó tarde: ya se pidió otra pestaña o filtro
        if (!res.ok) throw new Error(d.error ?? `Error ${res.status}`);
        setItems((prev) => (p === 0 ? d.items : [...prev, ...d.items]));
        setHayMas(d.hayMas);
        setPage(p);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        if (mine === reqId.current) setLoading(false);
      }
    },
    [tipo, sport, orden],
  );

  useEffect(() => {
    setItems([]);
    load(0);
  }, [load, session?.user.id]);

  const update = (id: string, r: { votos: Tally; miVoto: number }) => setItems((l) => l.map((x) => (x.id === id ? { ...x, ...r } : x)));

  return (
    <div className="wrap">
      <div className="top">
        <a className="brand" href="/" style={{ textDecoration: "none", color: "inherit" }}>ProPicks<span>AI</span></a>
        <div className="tabs">
          <a className="btn" href="/">← Volver</a>
          <a className="btn" href="/efectividad">📊 Efectividad</a>
          {session ? (
            <button className="btn" onClick={() => supabase().auth.signOut()}>Salir</button>
          ) : (
            <button className="btn primary" onClick={() => setLoginOpen(true)}>Entrar</button>
          )}
        </div>
      </div>

      <h1 style={{ fontSize: 22, margin: "0 0 4px" }}>🗳️ Apuestas de la comunidad</h1>
      <div className="muted small" style={{ marginBottom: 14 }}>
        Todas las apuestas y parlays que la IA ha dado. Vota si crees que le entra y comenta; las votaciones cierran cuando empieza el partido.
      </div>

      <div className="card row" style={{ marginBottom: 14 }}>
        <div className="row" style={{ gap: 6 }}>
          <button className={`btn ${tipo === "individual" ? "on" : ""}`} onClick={() => setTipo("individual")}>Individuales</button>
          <button className={`btn ${tipo === "parlay" ? "on" : ""}`} onClick={() => setTipo("parlay")}>Parlays</button>
        </div>
        <select className="field" style={{ width: "auto" }} value={sport} onChange={(e) => setSport(e.target.value)}>
          <option value="">Todos los deportes</option>
          {SPORTS.map((s) => <option key={s.id} value={s.id}>{s.emoji} {s.label}</option>)}
        </select>
        <div className="row" style={{ gap: 6 }}>
          {ORDENES.map((o) => (
            <button key={o.id} className={`mini ${orden === o.id ? "on" : ""}`} style={{ marginTop: 0 }} onClick={() => setOrden(o.id)}>{o.label}</button>
          ))}
        </div>
      </div>

      {error && <div className="err small" style={{ marginBottom: 12 }}>{error}</div>}
      {!loading && !items.length && !error && <div className="muted">Todavía no hay apuestas aquí.</div>}

      <div className="cards">
        {items.map((it) =>
          !Array.isArray(it.piernas) ? (
            <a key={it.id} className="bet-card" href={`/apuestas/pick/${it.id}`}>
              <div className="small muted">{deporte(it.sport)} · {it.league_name} · {fechaCorta(it.game_date)}</div>
              <div className="small">{it.title}</div>
              <div className="pick-head">
                <div>
                  <div className="small muted">{it.mercado}</div>
                  <div className="pick-sel">{it.seleccion}</div>
                </div>
                <div className="pct">{it.probabilidad}%</div>
              </div>
              <div className="row small">
                {it.cuota && <span className="tag">Momio {it.cuota}{it.cuota_estimada ? "~" : ""}</span>}
                <EstadoTag estado={it.status as Estado} />
                <span className="muted">💬 {it.comentarios}</span>
              </div>
              <VoteBar votos={it.votos} compact />
              <VoteButtons type="pick" id={it.id} miVoto={it.miVoto} abierta={it.abierta} small onChange={(r) => update(it.id, r)} onNeedLogin={() => setLoginOpen(true)} />
            </a>
          ) : (
            <a key={it.id} className="bet-card" href={`/apuestas/parlay/${it.id}`}>
              <div className="small muted">{(it.sports ?? []).map(deporte).join(" · ")} · desde {fechaCorta(it.first_game)}</div>
              <div className="pick-head">
                <div>
                  <div className="small muted">Parlay {it.tipo === "Valor" ? "de valor" : "seguro"}</div>
                  <div className="pick-sel">{it.apuestas} apuestas{it.partidos !== it.apuestas ? ` · ${it.partidos} partidos` : ""}</div>
                </div>
                <div className="pct">{Number(it.probabilidad)}%</div>
              </div>
              <ol className="reasons small" style={{ margin: 0 }}>
                {it.piernas.slice(0, 4).map((l: any, i: number) => (
                  <li key={i}><b>{(l.selecciones ?? []).map((s: any) => s.seleccion).join(" + ")}</b> <span className="muted">· {l.partido}</span></li>
                ))}
                {it.piernas.length > 4 && <li className="muted">y {it.piernas.length - 4} más…</li>}
              </ol>
              <div className="row small">
                {it.cuota_americana && <span className="tag">Momio {it.cuota_americana}</span>}
                <EstadoTag estado={it.estado as Estado} />
                <span className="muted">💬 {it.comentarios}</span>
              </div>
              <VoteBar votos={it.votos} compact />
              <VoteButtons type="parlay" id={it.id} miVoto={it.miVoto} abierta={it.abierta} small onChange={(r) => update(it.id, r)} onNeedLogin={() => setLoginOpen(true)} />
            </a>
          ),
        )}
      </div>
      {loading && <div className="muted" style={{ marginTop: 12 }}>Cargando…</div>}
      {hayMas && !loading && <button className="btn" style={{ marginTop: 14 }} onClick={() => load(page + 1)}>Ver más</button>}

      <div className="disclaimer">Las probabilidades son estimaciones, no garantías. Apuesta solo lo que puedas perder. +18.</div>
      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />
    </div>
  );
}

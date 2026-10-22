"use client";

import { useState } from "react";
import type { CacheInfo, Winner } from "@/lib/ai";
import type { Accion } from "@/lib/billing";
import { sportInfo, type Game } from "@/lib/espn";
import { authFetch } from "@/lib/supabase-browser";

type Resultado = Winner & { fecha: string; sport: string; liga: string };

interface Data {
  juegos: Resultado[];
  advertencias: string[];
  cache?: CacheInfo;
  restantes?: number | null;
}

const fecha = (iso: string) => new Date(iso).toLocaleString("es-MX", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** Solo quién gana: el boleto (compartido con Parlay), el botón y la lista ordenada por probabilidad. */
export function GanadoresPanel({
  legs,
  onRemove,
  onClear,
  tarifas,
  logged,
  onNeedLogin,
  onCredits,
}: {
  legs: Game[];
  onRemove: (g: Game) => void;
  onClear: () => void;
  tarifas?: Record<Accion, number>;
  logged: boolean;
  onNeedLogin: () => void;
  onCredits: (n: number | null | undefined) => void;
}) {
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [abierto, setAbierto] = useState<string | null>(null);

  async function analizar(refresh = false) {
    if (!logged) return onNeedLogin();
    setBusy(true);
    setError("");
    try {
      const res = await authFetch("/api/ganadores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ games: legs, refresh }),
      });
      const d = await res.json().catch(() => ({ error: `Error ${res.status}` }));
      if (res.status === 401) onNeedLogin();
      if (!res.ok) throw new Error(d.error ?? `Error ${res.status}`);
      setData(d);
      onCredits(d.restantes);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const ids = new Set(legs.map((l) => l.id));
  const juegos = (data?.juegos ?? []).filter((j) => ids.has(j.id));
  const faltan = data ? legs.filter((l) => !data.juegos.some((j) => j.id === l.id)).length : 0;

  return (
    <div className="stack">
      <div className="card stack">
        <div className="row">
          <h2 style={{ margin: 0 }}>🏆 ¿Quién gana? ({legs.length})</h2>
          {legs.length > 0 && <button className="btn" style={{ marginLeft: "auto" }} onClick={() => { onClear(); setData(null); }}>Vaciar</button>}
        </div>
        <div className="small muted">
          Elige los partidos de la lista. La IA te dice solo quién gana cada uno y con qué probabilidad, ordenados del más seguro al menos seguro. No arma parlays: tú decides cuáles meter.
        </div>
        {legs.map((l) => (
          <div key={l.id} className="leg">
            <div style={{ minWidth: 0 }}>
              <div className="small muted">{l.leagueName} · {fecha(l.date)}</div>
              <b>{sportInfo(l.sport).emoji} {l.title}</b>
            </div>
            <button className="x" aria-label="Quitar" onClick={() => onRemove(l)}>×</button>
          </div>
        ))}
        <button className="btn primary big" disabled={busy || !legs.length} onClick={() => analizar()}>
          {busy ? "Analizando…" : legs.length ? `🏆 Ver ganadores de ${legs.length} partido${legs.length === 1 ? "" : "s"}` : "Agrega partidos de la lista"}
        </button>
        {tarifas && legs.length > 0 && (
          <div className="small muted">
            Hasta {legs.length * tarifas.ganador_partido} créditos ({tarifas.ganador_partido} por partido nuevo, {tarifas.ganador_cache} si ya está en caché)
          </div>
        )}
      </div>

      <div className="card">
        {busy && (
          <div className="row muted">
            <span className="spinner" /> La IA está revisando {legs.length} partidos (1-2 min)…
          </div>
        )}
        {error && !busy && (
          <div className="err small">
            {error} {/suscripci|créditos/i.test(error) && <a href="/planes">Ver planes →</a>}
          </div>
        )}
        {!busy && faltan > 0 && <div className="warn small" style={{ marginBottom: 10 }}>Agregaste {faltan} partido(s) después. Dale “Ver ganadores” otra vez para incluirlos.</div>}
        {!busy && data?.cache && (
          <div className="row small muted" style={{ marginBottom: 10 }}>
            <span>
              {data.cache.nuevos === 0 ? "⚡ Todo salió del caché compartido" : data.cache.deCache ? `⚡ ${data.cache.deCache} del caché · 🆕 ${data.cache.nuevos} analizados ahora` : "🆕 Análisis nuevo"}
            </span>
            {data.restantes !== undefined && <span>· {data.restantes === null ? "admin: sin costo" : `te quedan ${data.restantes} créditos`}</span>}
            {Boolean(data.cache.deCache) && <button className="link" style={{ marginLeft: "auto" }} onClick={() => analizar(true)}>Actualizar</button>}
          </div>
        )}
        {!busy && juegos.length > 0 && (
          <div className="stack" style={{ gap: 8 }}>
            {juegos.map((j, i) => {
              const level = j.probabilidad >= 60 ? "" : j.probabilidad >= 45 ? "mid" : "low";
              const open = abierto === j.id;
              const p = j.probabilidades;
              return (
                <div key={j.id} className="pick winner" onClick={() => setAbierto(open ? null : j.id)}>
                  <div className="pick-head">
                    <div style={{ minWidth: 0 }}>
                      <div className="small muted">#{i + 1} · {sportInfo(j.sport).emoji} {j.liga.split(" · ")[0]} · {fecha(j.fecha)}</div>
                      <div className="small">{j.partido}</div>
                      <div className="pick-sel">🏆 {j.ganador}</div>
                    </div>
                    <div className="pct">{j.probabilidad}%</div>
                  </div>
                  <div className={`bar ${level}`}><i style={{ width: `${j.probabilidad}%` }} /></div>
                  <div className="row small">
                    <span className="tag">Confianza {j.confianza}</span>
                    {j.cuota && <span className="tag">Momio {j.cuota}</span>}
                    {p && p.empate > 0 && <span className="muted">Local {p.local}% · Empate {p.empate}% · Visita {p.visitante}%</span>}
                    {p && p.empate === 0 && p.local + p.visitante > 0 && <span className="muted">Local {p.local}% · Visita {p.visitante}%</span>}
                    <span className="muted" style={{ marginLeft: "auto" }}>{open ? "▲ ocultar" : "▼ por qué"}</span>
                  </div>
                  {open && <div className="small" style={{ marginTop: 6 }}>{j.razon}</div>}
                </div>
              );
            })}
          </div>
        )}
        {!busy && data && data.advertencias.length > 0 && (
          <div className="warn small" style={{ marginTop: 10 }}>{data.advertencias.map((w, k) => <div key={k}>⚠ {w}</div>)}</div>
        )}
        {!busy && !data && !error && <div className="muted">Aquí aparecerán los ganadores ordenados por probabilidad.</div>}
      </div>
    </div>
  );
}

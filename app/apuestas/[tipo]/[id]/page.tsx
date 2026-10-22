"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { authFetch, supabase } from "@/lib/supabase-browser";
import { LoginModal, useSession } from "../../../Auth";
import { deporte, EstadoTag, fechaCorta, VoteBar, VoteButtons, type Estado, type Tally } from "../../ui";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Gráfica de votos por pierna: cuánta gente cree que entra cada apuesta del parlay, junto a lo que dijo la IA.
function LegsChart({ piernas }: { piernas: any[] }) {
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="legend small">
        <span><i style={{ background: "var(--s1)" }} /> % de la gente que dice que entra</span>
        <span><i className="mark-key" /> lo que dio la IA</span>
      </div>
      {piernas.map((l, i) => {
        const total = l.votos.si + l.votos.no;
        const gente = total ? Math.round((l.votos.si / total) * 100) : null;
        return (
          <div key={i} className="leg-chart">
            <div className="small hist-title"><b>{i + 1}.</b> {l.selecciones.map((s: any) => s.seleccion).join(" + ")}</div>
            <div className="hbar" title={`${gente == null ? "Sin votos" : `${gente}% de ${total} votos dice que entra`} · IA: ${l.probabilidad}%`}>
              <div style={{ width: `${gente ?? 0}%`, background: "var(--s1)" }} />
              <i className="mark" style={{ left: `${l.probabilidad}%` }} />
              <span>{gente == null ? "sin votos" : `${gente}% (${total})`} · IA {l.probabilidad}%</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function Detalle() {
  const params = useParams<{ tipo: string; id: string }>();
  const tipo = params.tipo === "parlay" ? "parlay" : "pick";
  const id = params.id;
  const { session } = useSession();
  const [loginOpen, setLoginOpen] = useState(false);
  const [d, setD] = useState<any>(null);
  const [error, setError] = useState("");
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [nombre, setNombre] = useState<string | null>(null);
  const [editNombre, setEditNombre] = useState(false);
  const [nuevoNombre, setNuevoNombre] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await authFetch(`/api/apuestas/detalle?tipo=${tipo}&id=${id}`, { cache: "no-store" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? `Error ${res.status}`);
      setD(j);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [tipo, id]);

  useEffect(() => {
    load();
  }, [load, session?.user.id]);

  useEffect(() => {
    if (!session) return setNombre(null);
    authFetch("/api/alias").then((r) => r.json()).then((j) => setNombre(j.nombre ?? null)).catch(() => {});
  }, [session]);

  async function comentar() {
    setEnviando(true);
    const res = await authFetch("/api/comentar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target_type: tipo, target_id: id, texto }),
    });
    const j = await res.json().catch(() => ({}));
    setEnviando(false);
    if (res.status === 401) return setLoginOpen(true);
    if (!res.ok) return alert(j.error ?? "No se pudo comentar.");
    setTexto("");
    setD((x: any) => ({ ...x, comentarios: [j, ...x.comentarios] }));
  }

  async function guardarNombre() {
    const res = await authFetch("/api/alias", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ alias: nuevoNombre }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return alert(j.error ?? "No se pudo guardar.");
    setNombre(j.nombre);
    setEditNombre(false);
  }

  async function ocultar(cid: number, oculto: boolean) {
    const res = await authFetch("/api/admin/comentario", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: cid, oculto }) });
    if (res.ok) setD((x: any) => ({ ...x, comentarios: x.comentarios.map((c: any) => (c.id === cid ? { ...c, oculto } : c)) }));
  }

  const a = d?.apuesta;
  const setVotos = (r: { votos: Tally; miVoto: number }) => setD((x: any) => ({ ...x, ...r }));
  const setLeg = (pickId: string, r: { votos: Tally; miVoto: number }) =>
    setD((x: any) => ({ ...x, apuesta: { ...x.apuesta, piernas: x.apuesta.piernas.map((l: any) => (l.pick_id === pickId ? { ...l, ...r } : l)) } }));

  return (
    <div className="wrap">
      <div className="top">
        <a className="brand" href="/" style={{ textDecoration: "none", color: "inherit" }}>Pronósticos <span>IA</span></a>
        <div className="tabs">
          <a className="btn" href="/apuestas">← Apuestas</a>
          {session ? (
            <button className="btn" onClick={() => supabase().auth.signOut()}>Salir</button>
          ) : (
            <button className="btn primary" onClick={() => setLoginOpen(true)}>Entrar</button>
          )}
        </div>
      </div>

      {error && <div className="err small">{error}</div>}
      {!a && !error && <div className="muted">Cargando…</div>}

      {a && (
        <div className="grid">
          <div className="stack">
            <div className="card stack">
              {tipo === "pick" ? (
                <>
                  <div className="small muted">{deporte(a.sport)} · {a.league_name} · {fechaCorta(a.game_date)}</div>
                  <h2 style={{ margin: 0 }}>{a.title}</h2>
                  <div className="pick-head">
                    <div>
                      <div className="small muted">{a.mercado}</div>
                      <div className="pick-sel" style={{ fontSize: 20 }}>{a.seleccion}</div>
                    </div>
                    <div className="pct">{a.probabilidad}%</div>
                  </div>
                  <div className="row small">
                    {a.cuota && <span className="tag">Momio {a.cuota}{a.cuota_estimada ? "~" : ""}</span>}
                    <EstadoTag estado={a.status as Estado} />
                  </div>
                  {a.resultado && <div className="small muted">Resultado: {a.resultado}</div>}
                  {a.razones?.length > 0 && (
                    <div>
                      <b className="small">Por qué lo dice la IA</b>
                      <ul className="reasons small">{a.razones.map((r: string, i: number) => <li key={i}>{r}</li>)}</ul>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="small muted">{a.sports.map(deporte).join(" · ")} · desde {fechaCorta(a.first_game)}</div>
                  <div className="pick-head">
                    <div>
                      <div className="small muted">Parlay {a.tipo === "Valor" ? "de valor" : "seguro"}</div>
                      <div className="pick-sel" style={{ fontSize: 20 }}>{a.apuestas} apuestas{a.partidos !== a.apuestas ? ` · ${a.partidos} partidos` : ""}</div>
                    </div>
                    <div className="pct">{Number(a.probabilidad)}%</div>
                  </div>
                  <div className="row small">
                    {a.cuota_americana && <span className="tag">Momio {a.cuota_americana}</span>}
                    <EstadoTag estado={a.estado as Estado} />
                  </div>
                  <div className="stack" style={{ gap: 8 }}>
                    {a.piernas.map((l: any, i: number) => (
                      <div key={i} className="pick">
                        <div className="small muted">{deporte(l.sport)} · {l.partido} · {fechaCorta(l.game_date)}</div>
                        <div className="pick-head">
                          <div className="pick-sel" style={{ fontSize: 15 }}>
                            {i + 1}. {l.selecciones.map((s: any) => s.seleccion).join(" + ")}
                            {l.selecciones.length > 1 && <span className="tag" style={{ marginLeft: 6 }}>Mismo partido</span>}
                          </div>
                          <div style={{ fontWeight: 700 }}>{l.probabilidad}%</div>
                        </div>
                        {l.razon && <div className="small muted">{l.razon}</div>}
                        <div className="row small" style={{ marginTop: 6 }}>
                          <EstadoTag estado={l.estado as Estado} />
                          {l.cuota && <span className="tag">{l.cuota}{l.cuota_estimada ? "~" : ""}</span>}
                        </div>
                        <VoteBar votos={l.votos} compact />
                        <VoteButtons type="pick" id={l.pick_id} miVoto={l.miVoto} abierta={l.abierta} small onChange={(r) => setLeg(l.pick_id, r)} onNeedLogin={() => setLoginOpen(true)} />
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="stack">
            <div className="card stack">
              <h2 style={{ margin: 0 }}>{tipo === "parlay" ? "¿Le entra el parlay completo?" : "¿Le entra?"}</h2>
              <VoteBar votos={d.votos} ia={tipo === "pick" ? a.probabilidad : Number(a.probabilidad)} />
              <VoteButtons type={tipo} id={id} miVoto={d.miVoto} abierta={a.abierta} onChange={setVotos} onNeedLogin={() => setLoginOpen(true)} />
            </div>

            {tipo === "parlay" && (
              <div className="card">
                <h2>Votos por apuesta</h2>
                <LegsChart piernas={a.piernas} />
              </div>
            )}

            <div className="card stack">
              <h2 style={{ margin: 0 }}>Comentarios ({d.comentarios.filter((c: any) => !c.oculto).length})</h2>
              {session ? (
                <>
                  <textarea className="field" rows={3} maxLength={1000} placeholder="¿Qué opinas de esta apuesta?" value={texto} onChange={(e) => setTexto(e.target.value)} />
                  <div className="row small">
                    {editNombre ? (
                      <>
                        <input className="field" style={{ width: 180 }} placeholder="Tu nombre público" value={nuevoNombre} onChange={(e) => setNuevoNombre(e.target.value)} />
                        <button className="link" onClick={guardarNombre}>Guardar</button>
                      </>
                    ) : (
                      <span className="muted">Comentas como <b>{nombre ?? "…"}</b> · <button className="link" onClick={() => { setEditNombre(true); setNuevoNombre(""); }}>cambiar</button></span>
                    )}
                    <button className="btn primary" style={{ marginLeft: "auto" }} disabled={enviando || !texto.trim()} onClick={comentar}>{enviando ? "Enviando…" : "Comentar"}</button>
                  </div>
                </>
              ) : (
                <button className="btn" onClick={() => setLoginOpen(true)}>Entra para comentar y votar</button>
              )}
              {d.comentarios.map((c: any) => (
                <div key={c.id} className={`comment ${c.oculto ? "hidden" : ""}`}>
                  <div className="small muted">
                    <b>{c.autor}</b> · {fechaCorta(c.created_at)}
                    {c.oculto && " · oculto"}
                    {d.isAdmin && <button className="link" style={{ marginLeft: 8 }} onClick={() => ocultar(c.id, !c.oculto)}>{c.oculto ? "mostrar" : "ocultar"}</button>}
                  </div>
                  <div style={{ whiteSpace: "pre-wrap" }}>{c.texto}</div>
                </div>
              ))}
              {!d.comentarios.length && <div className="muted small">Sé el primero en comentar.</div>}
            </div>
          </div>
        </div>
      )}
      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />
    </div>
  );
}

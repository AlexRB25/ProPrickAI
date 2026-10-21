"use client";

import { useState } from "react";
import { authFetch } from "@/lib/supabase-browser";

/** Botón fijo para reportar una falla desde cualquier página. */
export function BugButton() {
  const [open, setOpen] = useState(false);
  const [mensaje, setMensaje] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  async function enviar() {
    setBusy(true);
    setErr("");
    const res = await authFetch("/api/bugs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mensaje, email, pagina: location.pathname }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setErr(d.error ?? "No se pudo enviar.");
    setMsg("¡Gracias! Lo revisaremos pronto.");
    setMensaje("");
  }

  return (
    <>
      <button className="bug-fab" onClick={() => { setOpen(true); setMsg(""); }} title="Reportar una falla">🐞 Reportar falla</button>
      {open && (
        <div className="modal-bg" onClick={() => setOpen(false)}>
          <div className="card modal stack" onClick={(e) => e.stopPropagation()}>
            <div className="row">
              <h2 style={{ margin: 0 }}>Reportar una falla</h2>
              <button className="x" style={{ marginLeft: "auto" }} aria-label="Cerrar" onClick={() => setOpen(false)}>×</button>
            </div>
            <textarea className="field" rows={5} placeholder="¿Qué pasó? ¿Qué estabas haciendo?" value={mensaje} onChange={(e) => setMensaje(e.target.value)} />
            <input className="field" type="email" placeholder="Tu correo (si no has iniciado sesión)" value={email} onChange={(e) => setEmail(e.target.value)} />
            {err && <div className="err small">{err}</div>}
            {msg && <div className="warn small">{msg}</div>}
            <button className="btn primary" disabled={busy || mensaje.trim().length < 5} onClick={enviar}>{busy ? "Enviando…" : "Enviar"}</button>
          </div>
        </div>
      )}
    </>
  );
}

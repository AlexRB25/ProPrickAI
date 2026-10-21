"use client";

import type { Session } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { authErrorMessage, supabase, supabaseConfigured } from "@/lib/supabase-browser";

export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [recovery, setRecovery] = useState(false);
  useEffect(() => {
    if (!supabaseConfigured) return;
    supabase().auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase().auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);
  return { session, recovery, endRecovery: () => setRecovery(false) };
}

type Mode = "entrar" | "registro" | "olvide" | "nueva";

export function LoginModal({ open, onClose, recovery = false }: { open: boolean; onClose: () => void; recovery?: boolean }) {
  const [mode, setMode] = useState<Mode>(recovery ? "nueva" : "entrar");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    if (recovery) setMode("nueva");
  }, [recovery]);

  if (!open && !recovery) return null;

  async function submit() {
    setBusy(true);
    setErr("");
    setMsg("");
    const auth = supabase().auth;
    try {
      if (mode === "entrar") {
        const { error } = await auth.signInWithPassword({ email, password });
        if (error) throw error;
        onClose();
      } else if (mode === "registro") {
        const { data, error } = await auth.signUp({ email, password, options: { emailRedirectTo: location.origin } });
        if (error) throw error;
        if (data.session) onClose();
        else setMsg("Te enviamos un correo para confirmar tu cuenta. Ábrelo y luego entra aquí.");
      } else if (mode === "olvide") {
        const { error } = await auth.resetPasswordForEmail(email, { redirectTo: location.origin });
        if (error) throw error;
        setMsg("Te enviamos un correo con el enlace para cambiar tu contraseña.");
      } else {
        const { error } = await auth.updateUser({ password });
        if (error) throw error;
        setMsg("Contraseña actualizada.");
        onClose();
      }
    } catch (e) {
      setErr(authErrorMessage(e as { code?: string; message: string }));
    } finally {
      setBusy(false);
    }
  }

  const titles: Record<Mode, string> = {
    entrar: "Entrar",
    registro: "Crear cuenta",
    olvide: "Recuperar contraseña",
    nueva: "Nueva contraseña",
  };

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="card modal stack" onClick={(e) => e.stopPropagation()}>
        <div className="row">
          <h2 style={{ margin: 0 }}>{titles[mode]}</h2>
          <button className="x" style={{ marginLeft: "auto" }} aria-label="Cerrar" onClick={onClose}>×</button>
        </div>
        {!supabaseConfigured && <div className="err small">Falta configurar Supabase (PB_SUPABASE_URL y PB_SUPABASE_PUBLISHABLE_KEY).</div>}
        {mode !== "nueva" && (
          <input className="field" type="email" placeholder="Correo" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        )}
        {mode !== "olvide" && (
          <input
            className="field"
            type="password"
            placeholder={mode === "nueva" ? "Nueva contraseña (mínimo 8)" : "Contraseña"}
            autoComplete={mode === "entrar" ? "current-password" : "new-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
        )}
        {err && <div className="err small">{err}</div>}
        {msg && <div className="warn small">{msg}</div>}
        <button className="btn primary" disabled={busy || (mode !== "nueva" && !email) || (mode !== "olvide" && password.length < 6)} onClick={submit}>
          {busy ? "Un momento…" : titles[mode]}
        </button>
        <div className="row small">
          {mode === "entrar" && (
            <>
              <button className="link" onClick={() => setMode("registro")}>Crear cuenta</button>
              <button className="link" style={{ marginLeft: "auto" }} onClick={() => setMode("olvide")}>Olvidé mi contraseña</button>
            </>
          )}
          {(mode === "registro" || mode === "olvide") && (
            <button className="link" onClick={() => setMode("entrar")}>Ya tengo cuenta</button>
          )}
        </div>
      </div>
    </div>
  );
}

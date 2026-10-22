"use client";

import { useEffect, useState } from "react";

const PASOS = [
  "Revisando lesiones y alineaciones…",
  "Leyendo estadísticas de los últimos partidos…",
  "Comparando con los momios de las casas…",
  "Calculando probabilidades…",
  "Escribiendo las razones…",
];

/**
 * Pantalla completa mientras la IA trabaja: bloquea clics, teclado y scroll para que el usuario
 * no lance otra consulta ni cambie de partido a la mitad.
 */
export function BlockingLoader({ show, title, detail, quick = false }: { show: boolean; title: string; detail?: string; quick?: boolean }) {
  const [secs, setSecs] = useState(0);

  useEffect(() => {
    if (!show) return;
    setSecs(0);
    const t = setInterval(() => setSecs((s) => s + 1), 1000);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Evita que el teclado active botones detrás de la pantalla (Enter, espacio, Tab).
    const block = (e: KeyboardEvent) => {
      if (["Enter", " ", "Tab"].includes(e.key)) e.preventDefault();
    };
    window.addEventListener("keydown", block, true);
    (document.activeElement as HTMLElement | null)?.blur();
    return () => {
      clearInterval(t);
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", block, true);
    };
  }, [show]);

  if (!show) return null;
  const paso = PASOS[Math.floor(secs / 12) % PASOS.length];
  const tiempo = secs < 60 ? `${secs} s` : `${Math.floor(secs / 60)} min ${String(secs % 60).padStart(2, "0")} s`;

  return (
    <div className="blocking" role="alertdialog" aria-modal="true" aria-busy="true" aria-live="polite" aria-label={title}>
      <div className="blocking-box">
        <div className="big-spinner" />
        <div className="blocking-title">{title}</div>
        {detail && <div className="muted">{detail}</div>}
        {!quick && <div className="blocking-step">{paso}</div>}
        <div className="small muted">{quick ? tiempo : `${tiempo} · suele tardar de 1 a 3 minutos`}</div>
        <div className="small muted">No cierres ni recargues la página.</div>
      </div>
    </div>
  );
}

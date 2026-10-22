# ProPicksAI

Web app de pronósticos con IA para más de 30 deportes y eventos. Con calendario automático de ESPN: fútbol (20 ligas), NFL/NCAA/CFL/UFL, MLB, NBA/WNBA/NCAA/FIBA, tenis ATP/WTA, NHL, UFC/PFL, F1/NASCAR/IndyCar, golf PGA/LPGA, rugby, NRL, AFL, voleibol, lacrosse y hockey sobre césped. El resto (box, eSports, snooker, dardos, caballos, galgos, ciclismo, política, etc.) se agrega como evento manual y la IA lo investiga en la web.

- **Partidos**: elige deporte y liga, ve los próximos partidos con momios (ESPN, sin llave) y pide el pronóstico. Puedes preguntar algo específico: "¿Dak Prescott pasa de 250.5 yardas?".
- **🏆 Ganadores**: eliges varios partidos (comparten el boleto con Parlay) y la IA dice solo quién gana cada uno, con su probabilidad (local/empate/visitante), confianza y por qué, ordenados del más seguro al menos seguro. No arma parlays. Cuesta 3 créditos por partido nuevo (~US$0.04 de IA) y 1 si ya está en caché; cada pronóstico entra a Efectividad y a Apuestas.
- **Ventana flotante**: comparte la pestaña de tu casa de apuestas o quiniela, abre la ventana flotante (queda encima de todo) y pulsa **Analizar**. La IA lee la captura, busca lesiones y estadísticas actuales en la web y te da probabilidad, valor contra el momio y razones.
- **Armar parlay**: agrega partidos de cualquier deporte al boleto (hasta 20), elige un rango de 2 a 20 apuestas y la IA arma los parlays "Más probable" y "Mejor valor" con su probabilidad de acertar, momio combinado y pago. Puede usar varias apuestas del mismo partido (ej. Cowboys ganan + Dak más de 224.5 yardas) con su probabilidad conjunta.
- **Mercados a elegir**: en el análisis de un partido y en el parlay escoges qué mercados considerar: córners, tarjetas, faltas, tiros, goleador, goles de campo, yardas, props de NBA, etc.
- **Datos reales**: antes de llamar a la IA se bajan los box scores de los últimos 5 partidos de cada equipo desde ESPN (córners, faltas, tarjetas, goles de campo, yardas y números de jugadores) y se le pasan como datos verificados.
- **Caché compartido**: cada análisis se guarda en Supabase y se reutiliza para cualquier usuario mientras siga vigente (12 h si faltan más de 2 días, 3 h si faltan más de 6 h, 45 min cerca del partido). En parlays se guarda por partido.
- **Suscripción y créditos** (Mercado Pago): plan mensual (US$9.99, 60 créditos) o anual (US$99.99, 720 créditos) y paquetes de créditos para suscriptores. Cada consulta cobra créditos según la tabla `tarifas` (menos si sale del caché); si la IA falla se devuelven. Todo editable en `/admin`.
- **Panel de administración** (`/admin`): resumen del negocio (ingresos, costo real de la IA, ganancia, margen por crédito), usuarios con historial de consultas, pagos y créditos; agregar o quitar créditos, regalar o quitar suscripciones, bloquear; historial global de consultas; reportes de fallas; precios.
- **Apuestas de la comunidad** (`/apuestas`, pública): cada pick de un análisis individual y cada parlay armado se publica una sola vez. La gente vota "le entra / no le entra" (en parlays, completo o por cada apuesta), comenta y ve la gráfica de votos junto a lo que dijo la IA. Las votaciones cierran al empezar el partido; los admins pueden ocultar comentarios.
- **Parlays variados**: cada parlay castiga las apuestas que ya salieron en los anteriores, para que una sola apuesta fallida no tumbe a todos.
- **Reportar falla**: botón fijo en todas las páginas.
- **Efectividad** (pública, en `/efectividad`): cada pick se guarda una vez y se califica solo cuando acaba el partido (ESPN + IA, o búsqueda web en eventos sin ESPN). Muestra acierto contra lo esperado, ROI, calibración, por deporte y por mercado, con filtros por deporte, liga y estado.

## Arranque

```bash
npm install
cp .env.example .env.local   # pon tu ANTHROPIC_API_KEY
npm run dev                  # http://localhost:3000
```

La ventana flotante usa Document Picture-in-Picture: solo Chrome o Edge de escritorio.
Cada análisis usa Claude Opus 5.5 con búsqueda web; tarda 1-2 minutos y cuesta centavos de dólar.
`AI_EFFORT=high` da análisis más profundos a cambio de más costo y tiempo.

Las probabilidades parten del momio de la casa (sin margen) y solo se mueven con evidencia; no son garantías.

## Supabase

1. Crea un proyecto en supabase.com.
2. SQL Editor → pega `supabase/schema.sql` completo → Run.
3. Authentication → URL Configuration: pon tu dominio de Vercel en *Site URL* y en *Redirect URLs* (y `http://localhost:3000` para pruebas).
4. Project Settings → API: copia la URL, la *publishable key* y la *secret key* a las variables de entorno.
5. Regístrate en la app y hazte admin (las consultas de los admins no cobran créditos): `update public.profiles set is_admin = true where email = tu@correo.com;`

## Mercado Pago

1. En Mercado Pago → Tus integraciones, crea una aplicación y copia el *Access Token* de producción a `MP_ACCESS_TOKEN`.
2. Webhooks: URL `https://TU-DOMINIO/api/mercadopago/webhook`, eventos **Pagos**, **Planes y suscripciones** (suscripciones y pagos autorizados). Copia la clave secreta a `MP_WEBHOOK_SECRET`.
3. `MP_USD_RATE` = pesos por dólar con los que se cobra (los precios están en US$).
4. Para probar sin dinero real usa las credenciales y usuarios de prueba de Mercado Pago.

Las suscripciones dan sus créditos en cada cobro aprobado (una vez por cobro). Los paquetes se acreditan cuando el pago queda aprobado (al volver a /planes o por el webhook).

## Deploy en Vercel

Agrega en Settings → Environment Variables todas las de `.env.example`. Los análisis tienen tope de 300 s por solicitud.

La calificación corre con Vercel Cron una vez al día (límite del plan Hobby; ver `vercel.json`). Para calificar más seguido, un admin puede usar "Calificar ahora" en Efectividad, o un cron externo (p. ej. cron-job.org) puede llamar cada hora `GET /api/cron/calificar` con el encabezado `Authorization: Bearer <CRON_SECRET>`.

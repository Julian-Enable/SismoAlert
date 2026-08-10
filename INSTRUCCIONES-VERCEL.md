# SismoAlert — despliegue en Vercel (gratis)

Estructura lista para Vercel:

- `public/` → la PWA (interfaz, service worker, iconos)
- `api/` → funciones serverless: config, events, subscribe, cron, test
- `cron-job.org` dispara `/api/cron` cada minuto (Vercel gratis NO permite cron frecuente)
- Estado guardado en Redis (Upstash free vía Marketplace de Vercel)

---

## Paso 1 — Cuenta y proyecto en Vercel (2 min)

1. Cuenta en https://vercel.com (entra con GitHub, gratis).
2. **Add New... → Project → Import** desde tu repositorio GitHub
   (si no tienes repo: Vercel también permite subir el proyecto con la CLI).
3. Framework: deja **Other**. Build: **vacío** (no hay build). Vercel publicará `public/` y `api/` solos.
4. Nombre del proyecto: `sismoalert`. Se crea la URL `https://sismoalert.vercel.app`.

## Paso 2 — Variables de entorno (3 min)

En el proyecto → **Settings → Environment Variables**, agrega (valores en tu `.env` local):

| Nombre | Valor (desde .env) |
|---|---|
| `VAPID_PUBLIC_KEY` | `BCCtpYGEf3L6...` |
| `VAPID_PRIVATE_KEY` | `7IxXZIPwMsc4-...` |
| `VAPID_SUBJECT` | `mailto:contacto@sismoalert.co` |
| `CRON_SECRET` | `f5d3cf86deea...` (el que esté en tu .env) |

Marca **Production**. Luego **Deploy** (o se auto-despliega al conectarse el repo).

Opcionales: `MIN_MAG` (umbral, por defecto 4.0) y las cuatro coordenadas `MIN_LAT/MAX_LAT/MIN_LON/MAX_LON`.

## Paso 3 — Redis gratis (Upstash) (3 min)

1. En Vercel: **Marketplace → Redis → Upstash Redis** → **Add** (plan gratis, sin tarjeta).
2. Crea una base pequeña (free tier: 256 MB de RAM, 5000 req/día — suficiente para esta app:
   ~1 lectura/escritura por minuto = ~4.320 al día).
3. La integración inyecta solas las variables `UPSTASH_REDIS_REST_URL` y `UPSTASH_REDIS_REST_TOKEN`.
4. Vuelve a desplegar (el proyecto debe redeployarse para que las funciones lean las variables).

## Paso 4 — Cron cada minuto (cron-job.org gratis) (3 min)

1. Cuenta en https://cron-job.org (entra con GitHub/Google — gratis, sin tarjeta).
2. **Add cronjob**:
   - URL: `https://sismoalert.vercel.app/api/cron?secret=TU_CRON_SECRET`
   - Schedule: cada 1 minuto
   - Request method: GET
3. Salva y verifica que las ejecuciones devuelvan HTTP 200.
   La función revisa USGS + EMSC, filtra magnitud/región, deduplica y dispara los web push.

## Paso 5 — Verificar (2 min)

1. Abre `https://sismoalert.vercel.app`:
   - **iPhone**: Safari → Compartir → *Agregar a pantalla de inicio* → abrir la app → **Activar alertas**.
   - **Android**: Chrome → menú → *Instalar aplicación* → **Activar alertas**.
2. Simulacro real (dispara un push de prueba a todos los suscritos):
   `https://sismoalert.vercel.app/api/test?secret=TU_CRON_SECRET&mag=5.2&place=Prueba`
3. El historial se ve en `https://sismoalert.vercel.app/api/events`.

## Notas

- **Límite Hobby**: 100 GB de transferencia/mes y ~1M invocaciones — para una alerta por sismo
  y 1 cron por minuto (43.200 invocaciones/mes) estás muy por debajo.
- **Sin gasto**: todo usa los niveles gratis de Vercel, Upstash y cron-job.org.
- **Actualizar la app**: cada `git push` redepliega automáticamente.
- Para depurar: Vercel → proyecto → **Logs**.
- Si crece a miles de suscriptores (envíos de push en lote), el cron de 1 minuto sigue sirviendo;
  el único cambio sería partir el envío en chunks (futuro, no necesario hoy).
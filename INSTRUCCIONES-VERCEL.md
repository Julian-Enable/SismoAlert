# SismoAlert — despliegue en Vercel (gratis)

Estructura lista para Vercel:

- `public/` → la PWA (interfaz, service worker, iconos)
- `api/` → funciones serverless: config, events, subscribe, cron, test
- `cron-job.org` dispara `/api/cron` cada minuto (Vercel gratis NO permite cron frecuente)
- GitHub Actions (`.github/workflows/tick.yml`) dispara el mismo endpoint cada 10 min como respaldo
- Estado guardado en Redis (Upstash free vía Marketplace de Vercel), todo en la clave `state`

## Fuentes sísmicas

| Fuente | Qué aporta | Retardo típico |
|---|---|---|
| **SGC** (Red Sismológica Nacional) | Sismos de Colombia localizados con estaciones locales | minutos |
| USGS | Cobertura global, revisión | ~30 min para M4-5 en Colombia |
| EMSC | Cobertura global, revisión | ~30 min para M4-5 en Colombia |

El SGC es la fuente que manda: llega primero y su solución se queda como oficial en la fila
del historial. Cuando USGS o EMSC publican el mismo sismo más tarde **no se vuelve a notificar**
(se deduplica por tiempo + epicentro); solo se avisa de nuevo si alguna red corrige la magnitud
medio grado o más hacia arriba.

Variables opcionales:

| Nombre | Por defecto | Para qué |
|---|---|---|
| `USE_SGC` | `1` | `0` desactiva el feed del SGC |
| `SGC_FEED_URL` | feed de 5 días M≥2 del SGC | apuntar a otro archivo del feed |

Nota: el feed del SGC está detrás de CloudFront con WAF y solo responde a un `User-Agent`
de navegador; `src/feeds.js` ya lo envía. Ese feed además invierte el orden GeoJSON
(entrega `[lat, lon, profundidad]`).

---

## Paso 1 — Cuenta y proyecto en Vercel (2 min)

1. Cuenta en https://vercel.com (entra con GitHub, gratis).
2. **Add New... → Project → Import** desde tu repositorio GitHub
   (si no tienes repo: Vercel también permite subir el proyecto con la CLI).
3. Framework: deja **Other**. Build: **vacío** (no hay build). Vercel publicará `public/` y `api/` solos.
4. Nombre del proyecto: `sismoalert`. Se crea la URL `https://sismo-alert-pied.vercel.app`.

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
2. Crea una base pequeña. Todo el estado va en una sola clave, así que el cron gasta
   1 GET + 1 SET por minuto = ~2.880 comandos/día (~86.000/mes).
3. La integración inyecta solas las variables `UPSTASH_REDIS_REST_URL` y `UPSTASH_REDIS_REST_TOKEN`.
4. Vuelve a desplegar (el proyecto debe redeployarse para que las funciones lean las variables).

## Paso 4 — Cron cada minuto (cron-job.org gratis) (3 min)

1. Cuenta en https://cron-job.org (entra con GitHub/Google — gratis, sin tarjeta).
2. **Add cronjob**:
   - URL: `https://sismo-alert-pied.vercel.app/api/cron?secret=TU_CRON_SECRET`
   - Schedule: cada 1 minuto
   - Request method: GET
3. Salva y verifica que las ejecuciones devuelvan HTTP 200.
   La función revisa USGS + EMSC, filtra magnitud/región, deduplica y dispara los web push.

## Paso 5 — Verificar (2 min)

1. Abre `https://sismo-alert-pied.vercel.app`:
   - **iPhone**: Safari → Compartir → *Agregar a pantalla de inicio* → abrir la app → **Activar alertas**.
   - **Android**: Chrome → menú → *Instalar aplicación* → **Activar alertas**.
2. Simulacro real (dispara un push de prueba a todos los suscritos):
   `https://sismo-alert-pied.vercel.app/api/test?secret=TU_CRON_SECRET&mag=5.2&place=Prueba`
3. El historial se ve en `https://sismo-alert-pied.vercel.app/api/events`.

## Notas

- **Límite Hobby**: 100 GB de transferencia/mes y ~1M invocaciones — para una alerta por sismo
  y 1 cron por minuto (43.200 invocaciones/mes) estás muy por debajo.
- **Sin gasto**: todo usa los niveles gratis de Vercel, Upstash y cron-job.org.
- **Actualizar la app**: cada `git push` redepliega automáticamente.
- Para depurar: Vercel → proyecto → **Logs**.
- Si crece a miles de suscriptores (envíos de push en lote), el cron de 1 minuto sigue sirviendo;
  el único cambio sería partir el envío en chunks (futuro, no necesario hoy).
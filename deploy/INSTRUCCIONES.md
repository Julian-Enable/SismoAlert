# SismoAlert en Oracle Cloud Always Free ($0 permanente)

Este flujo pone tu SismoAlert en una VM gratis de Oracle que corre 24/7, con dominio
gratis (`tu-sub.duckdns.org`) y HTTPS automático (Caddy). Todo el proceso = 30 minutos.

---

## Paso 1 — Cuenta Oracle Cloud (5 min)

1. Entra a https://www.oracle.com/cloud/free/ y pulsa **Start for free**.
2. Registro normal + verificación de tarjeta (solo se verifica, **no cobra nada**; usa un monto $0).
3. Al crear la cuenta eliges **Home Region** — en América Latina están **Santiago** y **São Paulo**.
   Escoge cualquiera con cupo (si al crear la VM dice *out of capacity*, prueba la otra región).

## Paso 2 — Crear la VM (10 min)

1. Menú ☰ → **Compute → Instances → Create instance**.
2. Nombre: `sismoalert`.
3. **Image**: `Ubuntu 24.04` (Canonical Ubuntu Minimal). **¿No aparece Ubuntu en el buscador?**
   Usa **Plan B**: escoge `Oracle Linux 8` en *Platform images* — el script de instalación
   detecta automáticamente el sistema y funciona perfecto con cualquiera de los dos.
4. **Shape**: `VM.Standard.E2.1.Micro` (Always Free Eligible — 1 OCPU / 1 GB RAM).
5. **Networking**: activa *"Assign a public IPv4 address"* (por defecto está activo).
6. **Add SSH keys**: elige **Generate a key pair for me** → descarga `ssh-key-2026-...key`
   (ese archivo es tu llave privada. Guárdalo en `C:\Users\FarmazionSAS\Documents\Dev\SismoAlert\deploy\`).
7. **Boot volume**: deja el predeterminado.
8. Crea la instancia y espera a que el estado pase a **Running**. Anota la **Public IP**.

## Paso 3 — Abrir puertos 80 y 443 (3 min)

1. En la instancia, entra a **VCN** (red virtual) → **Security Lists** → la lista *default*.
2. **Add Ingress Rules** — agrega DOS reglas:
   - Source CIDR: `0.0.0.0/0` · IP Protocol: **TCP** · Destination Port: **80**
   - Source CIDR: `0.0.0.0/0` · IP Protocol: **TCP** · Destination Port: **443**

## Paso 4 — Dominio gratis en DuckDNS (3 min)

1. Entra a https://www.duckdns.org e inicia sesión (GitHub, Google, Reddit o Twitter).
2. En **Domains** escribe `sismoalert` → **Add domain**. Quedará `sismoalert.duckdns.org`.
   (Cualquier nombre sirve; si está tomado, usa otro, p. ej. `sismoalertcol`.)
3. Copia el **token** de esa página (cadena larga tipo `abc-123-xxxx`).

## Paso 5 — Desplegar (un solo comando en tu PC)

1. Mueve el archivo `.key` descargado en el paso 2 a la carpeta `deploy\`.
2. Abre PowerShell en `C:\Users\FarmazionSAS\Documents\Dev\SismoAlert\deploy\`:

```powershell
.\subir-a-oracle.ps1 -Ip 158.000.000.000 -KeyPath .\ssh-key-2026-xxx.key -Domain sismoalert.duckdns.org -DuckToken TU_TOKEN
```

Reemplaza IP, ruta de llave, dominio y token. El script empaqueta la app (sin `node_modules`),
la sube por SFTP, y en la VM instala Node 24, Caddy, servicios systemd y configura el HTTPS.

## Paso 6 — Verificar (2 min)

1. Espera 2-3 minutos (certificado Let's Encrypt tarda en emitirse la primera vez).
2. Abre `https://sismoalert.duckdns.org` desde cualquier celular:
   - **iPhone**: Safari → Compartir → *Agregar a pantalla de inicio* → abrir la app → **Activar alertas**.
   - **Android**: Chrome → menú → *Instalar aplicación* → **Activar alertas**.
3. En el servidor: `ssh -i .\ssh-key-2026-xxx.key ubuntu@IP 'journalctl -u sismoalert -f'` para logs.

## Notas importantes

- **El dominio DuckDNS apunta a la IP pública**, que es fija mientras la VM esté encendida.
  El script añade un cron que re-apunta la IP cada 5 minutos por si Oracle la cambia.
- **No apagues la VM**: en la capa gratuita, detenerla puede cambiar su IP pública.
- Para mantenerla: los recursos Oracle Free no se eliminan solos, pero conviene revisar
  el correo de Oracle por si piden confirmación anual.
- `TEST_ALERT=1` está activo (endpoint `/api/test` para simulacros en la web).
  Cuando quieras desactivarlo: cambia `TEST_ALERT=0` en el `.env` de la VM
  (`nano ~/sismoalert/.env`) y reinicia: `sudo systemctl restart sismoalert`.

## Para actualizar la app después

Repite el paso 5 con el mismo comando. El script reinstala y reinicia el servicio.
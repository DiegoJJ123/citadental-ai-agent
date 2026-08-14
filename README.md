# CitaDental AI — bot de WhatsApp (demo)

Asistente de IA que hace de recepción de una clínica dental ficticia por WhatsApp, para demostrar el producto "CitaDental AI" a clientes potenciales. Responde por el número **+34 642 06 90 50**.

## Qué hace

Por el mismo número atiende a dos tipos de personas:

- **Dueños de clínica interesados en el producto** (llegan desde el botón de WhatsApp de citadentalai.site): el bot pide nombre, email y teléfono, registra el lead (tabla `demo_leads`) y avisa por WhatsApp al equipo comercial (`SALES_TEAM_PHONE`) para que agende un Google Meet con ellos. El bot no agenda el Meet directamente, solo capta el lead y notifica.
- **Pacientes de la clínica dental ficticia** (demo del producto en sí):
  - Reserva, modifica y cancela citas contra una agenda simulada (SQLite con huecos ficticios de los próximos 14 días laborables).
  - Consulta la próxima cita del paciente.
  - Responde FAQ de la clínica (precios, ubicación, parking, mutuas, financiación) — datos ficticios en `src/services/clinicInfo.js`.

- Escala a un humano cuando el caso lo requiere (marca la conversación y deja de responder automáticamente).
- 24/7, responde en segundos, tono cercano y profesional en español de España.

## Stack

- Node.js + Express (webhook)
- WhatsApp Cloud API (Meta) — credenciales ya provisionadas en twipo-dashboard, modo coexistencia
- OpenAI GPT (function calling) para orquestar las acciones de agenda
- SQLite (better-sqlite3) como "agenda" simulada, persistente en disco

## Configuración

1. Copia `.env.example` a `.env` y rellena:
   - `WHATSAPP_TOKEN`: access token del system user `apiuser01`
   - `WHATSAPP_PHONE_NUMBER_ID`: `1052831911250342`
   - `WHATSAPP_VERIFY_TOKEN`: cualquier cadena que también pondrás en la config del webhook en Meta
   - `OPENAI_API_KEY`: tu API key de OpenAI

2. Instala dependencias y siembra la agenda ficticia:
   ```
   npm install
   npm run seed
   ```

3. Arranca en local:
   ```
   npm start
   ```

## Configurar el webhook en Meta (App ID 2797322497276772)

1. Despliega este servicio en algún host con HTTPS público (Render, Railway, Fly.io...). El Dockerfile incluido sirve para cualquiera de ellos.
2. En el panel de Meta for Developers > tu app > WhatsApp > Configuration:
   - Callback URL: `https://TU-DOMINIO/webhook`
   - Verify token: el mismo valor que pusiste en `WHATSAPP_VERIFY_TOKEN`
3. Suscribe el campo `messages` del WABA `4944851238987440` a este webhook.
4. Como está en modo coexistencia, la app manual de WhatsApp Business sigue funcionando en paralelo sin problema.

## Resetear la demo

Para dejar la agenda limpia antes de una demo, borra el fichero de base de datos y vuelve a sembrar:

```
rm src/db/citadental.sqlite src/db/citadental.sqlite-*
npm run seed
```

## Producción y cómo editar desde cualquier sitio

- El bot corre en producción en Render (`citadental-ai-bot.onrender.com`), no en ningún ordenador local.
- Render tiene **auto-deploy** activado: cada `git push` a la rama `main` de este repo redespliega el bot solo, sin intervención manual.
- Las variables de entorno de producción (tokens, API keys) están guardadas directamente en Render → Environment, no dependen del `.env` local de ninguna máquina.

Para editar el bot desde otro ordenador (o sin instalar nada):

- **Sin clonar nada**: edita los archivos directamente en GitHub (botón del lápiz en cada archivo) y haz commit a `main`. Render despliega solo en cuanto detecta el push.
- **Con git**: `git clone https://github.com/DiegoJJ123/citadental-ai-agent.git`, edita, `git push`. Solo necesitas tener acceso a la cuenta de GitHub `DiegoJJ123`.
- El dashboard (`dashboard.citadentalai.site`) es parte del mismo repo/despliegue — se actualiza igual, con un push a `main`.

## Generar y publicar contenido en Instagram

Genera una imagen con IA (`gpt-image-1`, el mismo motor que usa ChatGPT) y la publica directamente en el feed de Instagram de la clínica.

```
npm run post-instagram -- "foto realista de una clínica dental moderna y luminosa, estilo editorial" "✨ Sonríe con confianza. Pide tu cita hoy mismo. #CitaDentalAI"
```

Requiere configurar en `.env` (y en Render → Environment para producción):

- `BASE_URL`: URL pública del bot (Instagram necesita descargar la imagen desde una URL, no vale un archivo local).
- `IG_BUSINESS_ACCOUNT_ID`: ID de la cuenta de Instagram, que debe ser de tipo **Business o Creator** y estar vinculada a una **Página de Facebook**.
- `IG_ACCESS_TOKEN`: token de acceso de esa Página, de **larga duración**, con permisos `instagram_basic`, `instagram_content_publish` y `pages_show_list`.

Cómo conseguir el ID y el token (una vez, desde [Meta for Developers](https://developers.facebook.com/)):

1. Crea o usa la misma app de Meta que ya usas para WhatsApp (App ID `2797322497276772`) y añade el producto **Instagram Graph API**.
2. Vincula la cuenta de Instagram (Business/Creator) a una Página de Facebook desde la configuración de la propia cuenta de Instagram.
3. Genera un token de usuario con los permisos de arriba en el [Graph API Explorer](https://developers.facebook.com/tools/explorer/), y cámbialo por uno de **Página de larga duración** (no caduca a las 24h) con el endpoint `oauth/access_token` (`grant_type=fb_exchange_token`) y luego `/me/accounts` para sacar el token de la Página concreta.
4. Saca el `IG_BUSINESS_ACCOUNT_ID` con `GET /{page-id}?fields=instagram_business_account&access_token=...`.

Las imágenes generadas se guardan en `public/generated/` (servidas en `/generated/<archivo>.png`) y no se suben al repo.

## Estructura

```
src/
  server.js          punto de entrada (Express)
  routes/webhook.js   verificación + recepción de mensajes de WhatsApp
  services/
    whatsapp.js        envío de mensajes vía Graph API
    agent.js           orquestación con Claude (tool use) + historial por número
    clinic.js          lógica de agenda (reservar/modificar/cancelar/consultar)
    clinicInfo.js       datos ficticios de la clínica (FAQ)
    imageGen.js         genera imágenes con la API de OpenAI (gpt-image-1)
    instagram.js        publica imágenes en Instagram vía Graph API
  scripts/
    publicarInstagram.js  script CLI: genera una imagen y la publica en Instagram
  db/
    db.js              esquema SQLite
    seed.js             genera huecos de agenda ficticios
```

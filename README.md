# CitaDental AI — bot de WhatsApp (demo)

Asistente de IA que hace de recepción de una clínica dental ficticia por WhatsApp, para demostrar el producto "CitaDental AI" a clientes potenciales. Responde por el número **+34 642 06 90 50**.

## Qué hace

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
  db/
    db.js              esquema SQLite
    seed.js             genera huecos de agenda ficticios
```

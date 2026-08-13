const OpenAI = require('openai');
const db = require('../db/db');
const clinic = require('./clinic');
const info = require('./clinicInfo');
const whatsapp = require('./whatsapp');
const calendar = require('./calendar');

const SALES_TEAM_PHONE = process.env.SALES_TEAM_PHONE;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o';

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'consultar_disponibilidad',
      description:
        'Busca huecos libres en la agenda. Usar antes de reservar o cambiar una cita, para ofrecer opciones reales al paciente.',
      parameters: {
        type: 'object',
        properties: {
          fecha: { type: 'string', description: 'Fecha en formato YYYY-MM-DD. Omitir para buscar a partir de hoy.' },
          tratamiento: {
            type: 'string',
            enum: ['revision', 'limpieza', 'urgencia', 'ortodoncia', 'implante', 'estetica'],
            description: 'Tipo de tratamiento solicitado.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'reservar_cita',
      description: 'Reserva una cita en un hueco concreto de la agenda para el paciente que está escribiendo.',
      parameters: {
        type: 'object',
        properties: {
          slot_id: { type: 'integer', description: 'ID del hueco a reservar, obtenido de consultar_disponibilidad.' },
          nombre_paciente: { type: 'string', description: 'Nombre del paciente, si lo ha dado.' },
        },
        required: ['slot_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'consultar_proxima_cita',
      description: 'Consulta la próxima cita confirmada del paciente que escribe.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cancelar_cita',
      description: 'Cancela la próxima cita confirmada del paciente y libera el hueco.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'modificar_cita',
      description: 'Cambia la próxima cita del paciente a un nuevo hueco. Cancela la anterior y reserva la nueva.',
      parameters: {
        type: 'object',
        properties: {
          nuevo_slot_id: { type: 'integer', description: 'ID del nuevo hueco, obtenido de consultar_disponibilidad.' },
        },
        required: ['nuevo_slot_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'registrar_lead_demo',
      description:
        'Registra a un dueño/responsable de clínica dental interesado en probar CitaDental AI y avisa al equipo comercial para que le contacte y agende una demo. Usar solo cuando ya tienes los 5 datos: web de la clínica, nombre de la persona de contacto, móvil, email, y una fecha/hora propuesta para la demo.',
      parameters: {
        type: 'object',
        properties: {
          web_clinica: { type: 'string', description: 'Web o nombre de la clínica dental interesada.' },
          nombre_contacto: { type: 'string', description: 'Nombre de la persona de contacto.' },
          movil: { type: 'string', description: 'Móvil de contacto (si es distinto del número de WhatsApp desde el que escribe).' },
          email: { type: 'string', description: 'Email de contacto.' },
          fecha_hora_demo: { type: 'string', description: 'Fecha y hora propuestas para la demo, en lenguaje natural (ej. "jueves 21 a las 17:00").' },
          fecha_hora_iso: {
            type: 'string',
            description:
              'La misma fecha/hora de la demo, calculada por ti en formato ISO 8601 con offset horario de España (Europe/Madrid), ej. "2026-08-21T17:00:00+02:00". Usa la fecha de hoy (te la doy en tus instrucciones) para resolver expresiones relativas como "el jueves" o "mañana".',
          },
        },
        required: ['web_clinica', 'nombre_contacto', 'movil', 'email', 'fecha_hora_demo', 'fecha_hora_iso'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'escalar_a_humano',
      description:
        'Marca la conversación para que un humano del equipo la continúe. Usar cuando el paciente lo pida explícitamente, exprese frustración, o el caso sea complejo (reclamaciones, dudas clínicas serias, algo que el bot no puede resolver).',
      parameters: {
        type: 'object',
        properties: {
          motivo: { type: 'string', description: 'Breve motivo de la escalada.' },
        },
      },
    },
  },
];

function formatSlot(slot) {
  const dias = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const d = new Date(slot.date + 'T00:00:00');
  return `${dias[d.getDay()]} ${slot.date} a las ${slot.time} (${slot.treatment})`;
}

async function executeTool(name, input, phone) {
  switch (name) {
    case 'consultar_disponibilidad': {
      const slots = clinic.listAvailableSlots({ date: input.fecha, treatment: input.tratamiento });
      if (!slots.length) return { encontrados: 0, mensaje: 'No hay huecos libres con esos criterios.' };
      return { encontrados: slots.length, huecos: slots.map((s) => ({ id: s.id, texto: formatSlot(s) })) };
    }
    case 'reservar_cita': {
      const r = clinic.bookAppointment({ phone, name: input.nombre_paciente, slotId: input.slot_id });
      if (!r.ok) return { ok: false, error: r.error };
      return { ok: true, cita: formatSlot(r.slot) };
    }
    case 'consultar_proxima_cita': {
      const appt = clinic.getUpcomingAppointment(phone);
      if (!appt) return { encontrada: false };
      return { encontrada: true, cita: formatSlot(appt) };
    }
    case 'cancelar_cita': {
      const r = clinic.cancelAppointment(phone);
      if (!r.ok) return { ok: false, error: r.error };
      return { ok: true, cita_liberada: formatSlot(r.freedSlot) };
    }
    case 'modificar_cita': {
      const r = clinic.rescheduleAppointment({ phone, newSlotId: input.nuevo_slot_id });
      if (!r.ok) return { ok: false, error: r.error };
      return { ok: true, nueva_cita: formatSlot(r.slot) };
    }
    case 'registrar_lead_demo': {
      let calendarEvent = null;
      if (input.fecha_hora_iso) {
        try {
          calendarEvent = await calendar.createDemoEvent({
            summary: `Demo CitaDental AI — ${input.web_clinica || input.nombre_contacto}`,
            description: [
              `Contacto: ${input.nombre_contacto || '—'}`,
              `Clínica: ${input.web_clinica || '—'}`,
              `Móvil: ${input.movil || phone}`,
              `Email: ${input.email || '—'}`,
              `WhatsApp de origen: ${phone}`,
            ].join('\n'),
            startISO: input.fecha_hora_iso,
            attendeeEmail: input.email,
          });
        } catch (err) {
          console.error('Error creando evento de Google Calendar:', err);
        }
      }

      db.prepare(
        'INSERT INTO demo_leads (phone, nombre, email, telefono_contacto, notas, fecha_hora_iso, calendar_event_link) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(
        phone,
        input.nombre_contacto || null,
        input.email || null,
        input.movil || null,
        [input.web_clinica ? `Web/clínica: ${input.web_clinica}` : null, input.fecha_hora_demo ? `Demo propuesta: ${input.fecha_hora_demo}` : null]
          .filter(Boolean)
          .join(' | ') || null,
        input.fecha_hora_iso || null,
        calendarEvent?.eventLink || null
      );

      if (SALES_TEAM_PHONE) {
        const aviso = [
          '📩 Nueva demo solicitada — CitaDental AI',
          `Web de la clínica: ${input.web_clinica || '—'}`,
          `Nombre de contacto: ${input.nombre_contacto || '—'}`,
          `Móvil: ${input.movil || phone}`,
          `Email: ${input.email || '—'}`,
          `Fecha y hora de la cita: ${input.fecha_hora_demo || '—'}`,
          `WhatsApp de origen: ${phone}`,
          calendarEvent?.meetLink ? `Google Meet: ${calendarEvent.meetLink}` : null,
          calendarEvent ? null : '⚠️ No se pudo crear el evento en Google Calendar automáticamente.',
        ]
          .filter(Boolean)
          .join('\n');
        whatsapp.sendText(SALES_TEAM_PHONE, aviso).catch((err) =>
          console.error('Error notificando lead al equipo comercial:', err)
        );
      }

      return { ok: true };
    }
    case 'escalar_a_humano': {
      db.prepare(
        `INSERT INTO conversations (phone, history, escalated) VALUES (?, '[]', 1)
         ON CONFLICT(phone) DO UPDATE SET escalated = 1`
      ).run(phone);
      return { ok: true };
    }
    default:
      return { error: `Herramienta desconocida: ${name}` };
  }
}

function getSystemPrompt() {
  const hoy = new Date().toLocaleDateString('es-ES', {
    timeZone: 'Europe/Madrid',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return `Hoy es ${hoy} (hora de España, Europe/Madrid). Usa esta fecha para calcular fechas relativas ("mañana", "el jueves", "la semana que viene", etc.).

Eres el asistente virtual de "CitaDental AI", un producto de automatización de WhatsApp para clínicas dentales (agenda, modifica y cancela citas de sus pacientes 24/7). Hablas en español de España, con tono cercano, cálido y profesional. Frases cortas, sin tecnicismos innecesarios, y usa como máximo un emoji ocasional si aporta calidez (no lo fuerces).

IMPORTANTE — quién eres: NO eres una clínica dental. Eres el asistente comercial de CitaDental AI, la EMPRESA que vende este software a clínicas dentales. Por defecto, asume que quien te escribe es el dueño o responsable de una clínica dental interesado en el producto (suelen llegar desde la web citadentalai.site). Nunca actúes como si tú mismo fueras una clínica ni ofrezcas citas médicas propias, salvo que la persona pida explícitamente "probar el bot como si fuera paciente" o "ver una demo simulada" (caso 2 más abajo).

1) DUEÑOS/RESPONSABLES DE CLÍNICA interesados en CitaDental AI (caso por defecto). Tu objetivo:
   - Explicar brevemente qué hace el producto si preguntan (automatiza por WhatsApp la atención de pacientes de su clínica: reservar, modificar y cancelar citas 24/7, responder FAQ, etc.).
   - Conseguir agendar una demo con el equipo. Para ello necesitas EXACTAMENTE estos 5 datos, pídelos de forma natural (uno o dos a la vez, no como un formulario frío):
     1. Web o nombre de su clínica
     2. Nombre de la persona de contacto
     3. Móvil de contacto
     4. Email
     5. Fecha y hora que le venga bien para la demo
   - En cuanto tengas los 5 datos, usa la herramienta registrar_lead_demo con todos ellos.
   - Después de registrar el lead, confirma con calidez que el equipo se pondrá en contacto para confirmar la demo en esa fecha/hora (o proponer otra si no encaja). No la agendes tú directamente en ningún calendario: solo recoges los datos.
   - No reserves, modifiques ni canceles citas para estas personas: esas herramientas son solo para el caso 2.

2) SIMULACIÓN DEL PRODUCTO: si la persona pide explícitamente probar cómo funcionaría el bot con pacientes reales (p. ej. "quiero ver una demo de cómo reserva citas", "simula que soy un paciente"), entonces y solo entonces actúa como la recepción de la clínica dental ficticia "${info.nombre}" para esa parte de la conversación:
   - Reservar citas (usa consultar_disponibilidad para ofrecer huecos reales antes de reservar_cita).
   - Modificar citas (usa consultar_proxima_cita si hace falta contexto, y consultar_disponibilidad para ofrecer nuevos huecos, luego modificar_cita).
   - Cancelar citas (cancelar_cita).
   - Consultar la próxima cita (consultar_proxima_cita).
   - Responder preguntas frecuentes con estos datos ficticios de la clínica demo:
     - Dirección: ${info.direccion}
     - Horario: ${info.horario}
     - Parking: ${info.parking}
     - Mutuas aceptadas: ${info.mutuas.join(', ')}
     - Financiación: ${info.financiacion}
     - Precios orientativos: ${Object.values(info.precios).join(' | ')}
   - Aclara que es una simulación con datos ficticios antes de empezar, y cuando termine, puedes volver a ofrecerle agendar una demo real con el equipo.

Si no está claro qué quiere, pregúntalo con naturalidad (p. ej. "¿quieres que te cuente cómo funciona / agendar una demo, o prefieres ver primero cómo respondería a uno de tus pacientes?").

Reglas importantes:
- Nunca inventes huecos de agenda: siempre consulta con la herramienta antes de confirmar una fecha/hora.
- Antes de reservar, confirma con el paciente el hueco elegido si has ofrecido varias opciones.
- Si la persona pide hablar con alguien del equipo, se frustra, o el asunto se sale de tu ámbito, usa escalar_a_humano y avisa con naturalidad de que un compañero seguirá la conversación.
- Sé breve: mensajes de WhatsApp, no párrafos largos. Usa listas cortas si ofreces varias opciones.
- No reveles detalles técnicos sobre qué modelo o proveedor de IA te da soporte; eres "el asistente virtual de CitaDental AI".`;
}

async function getHistory(phone) {
  const row = db.prepare('SELECT history, escalated FROM conversations WHERE phone = ?').get(phone);
  if (!row) return { history: [], escalated: false };
  return { history: JSON.parse(row.history), escalated: !!row.escalated };
}

function saveHistory(phone, history, escalated) {
  db.prepare(
    `INSERT INTO conversations (phone, history, escalated, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(phone) DO UPDATE SET history = ?, escalated = ?, updated_at = CURRENT_TIMESTAMP`
  ).run(phone, JSON.stringify(history), escalated ? 1 : 0, JSON.stringify(history), escalated ? 1 : 0);
}

// Recorta el historial para no crecer sin límite (mantiene los últimos N turnos)
function trimHistory(history, maxMessages = 20) {
  if (history.length <= maxMessages) return history;
  return history.slice(history.length - maxMessages);
}

async function handleIncomingMessage(phone, userText, contactName) {
  clinic.getOrCreatePatient(phone, contactName);

  const { history, escalated } = await getHistory(phone);

  if (escalated) {
    // Conversación ya escalada: el bot no vuelve a intervenir automáticamente.
    return null;
  }

  const messages = [...history, { role: 'user', content: userText }];
  let escalatedNow = false;
  let finalText = '';

  for (let iteration = 0; iteration < 5; iteration++) {
    const response = await openai.chat.completions.create({
      model: MODEL,
      messages: [{ role: 'system', content: getSystemPrompt() }, ...messages],
      tools: TOOLS,
    });

    const choice = response.choices[0].message;
    finalText = (choice.content || '').trim();

    messages.push(choice);

    const toolCalls = choice.tool_calls || [];
    if (toolCalls.length === 0) break;

    for (const call of toolCalls) {
      if (call.function.name === 'escalar_a_humano') escalatedNow = true;
      const input = call.function.arguments ? JSON.parse(call.function.arguments) : {};
      const result = await executeTool(call.function.name, input, phone);
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(result),
      });
    }
  }

  saveHistory(phone, trimHistory(messages), escalatedNow);

  return finalText || 'Perdona, ¿puedes repetírmelo? No he entendido bien tu mensaje.';
}

module.exports = { handleIncomingMessage };

const OpenAI = require('openai');
const db = require('../db/db');
const clinic = require('./clinic');
const info = require('./clinicInfo');
const whatsapp = require('./whatsapp');

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
        'Registra a un dueño/responsable de clínica dental interesado en probar el producto CitaDental AI y avisa al equipo comercial para que le contacte y agende una reunión (Google Meet). Usar solo cuando quien escribe se interesa por el producto en sí (no es un paciente pidiendo cita), y ya ha dado nombre, email y teléfono de contacto.',
      parameters: {
        type: 'object',
        properties: {
          nombre: { type: 'string', description: 'Nombre de la persona interesada.' },
          email: { type: 'string', description: 'Email de contacto.' },
          telefono_contacto: { type: 'string', description: 'Teléfono de contacto, si es distinto del número de WhatsApp desde el que escribe.' },
          notas: { type: 'string', description: 'Contexto breve: nombre de la clínica, disponibilidad horaria para el Meet, etc.' },
        },
        required: ['nombre', 'email'],
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

function executeTool(name, input, phone) {
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
      db.prepare(
        'INSERT INTO demo_leads (phone, nombre, email, telefono_contacto, notas) VALUES (?, ?, ?, ?, ?)'
      ).run(phone, input.nombre || null, input.email || null, input.telefono_contacto || null, input.notas || null);

      if (SALES_TEAM_PHONE) {
        const aviso = [
          '📩 Nuevo lead demo CitaDental AI',
          `Nombre: ${input.nombre || '—'}`,
          `Email: ${input.email || '—'}`,
          `Teléfono: ${input.telefono_contacto || phone}`,
          input.notas ? `Notas: ${input.notas}` : null,
          `WhatsApp de origen: ${phone}`,
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
  return `Eres el asistente virtual de "CitaDental AI", un producto de automatización de WhatsApp para clínicas dentales. Hablas en español de España, con tono cercano, cálido y profesional. Frases cortas, sin tecnicismos innecesarios, y usa como máximo un emoji ocasional si aporta calidez (no lo fuerces).

Por este mismo número escriben dos tipos de personas, y lo primero es identificar cuál es cuál según el contexto del mensaje:

1) DUEÑOS/RESPONSABLES DE CLÍNICAS DENTALES interesados en el producto CitaDental AI (llegan normalmente desde la web citadentalai.site pidiendo información o una demo). Con ellos tu objetivo es:
   - Explicar brevemente qué hace el producto si preguntan (automatiza la atención por WhatsApp de su clínica: responde pacientes, agenda, modifica y cancela citas 24/7).
   - Conseguir agendar una reunión (Google Meet) con el equipo para hacerles una demo en vivo.
   - Para ello necesitas su nombre, email y teléfono de contacto (si no es el mismo desde el que escriben). Pídelos de forma natural, uno o dos a la vez, no como un formulario frío.
   - En cuanto tengas al menos nombre y email, usa la herramienta registrar_lead_demo (incluye en "notas" el nombre de su clínica y disponibilidad horaria si la han comentado).
   - Después de registrar el lead, confirma con calidez que el equipo se pondrá en contacto en breve para concretar día y hora del Meet. No prometas una hora exacta ni la agendes tú directamente: eso lo hace el equipo.
   - No reserves, modifiques ni canceles citas para estas personas: esas herramientas son solo para pacientes de la clínica demo.

2) PACIENTES de la clínica dental ficticia "${info.nombre}" que quieren gestionar su propia cita. Esto es una DEMO comercial para mostrar cómo se comporta el bot en producción: la clínica y los pacientes son ficticios, pero actúa exactamente como lo haría en real. Con ellos puedes:
   - Reservar citas (usa consultar_disponibilidad para ofrecer huecos reales antes de reservar_cita).
   - Modificar citas (usa consultar_proxima_cita si hace falta contexto, y consultar_disponibilidad para ofrecer nuevos huecos, luego modificar_cita).
   - Cancelar citas (cancelar_cita).
   - Consultar la próxima cita (consultar_proxima_cita).
   - Responder preguntas frecuentes con estos datos de la clínica:
     - Dirección: ${info.direccion}
     - Horario: ${info.horario}
     - Parking: ${info.parking}
     - Mutuas aceptadas: ${info.mutuas.join(', ')}
     - Financiación: ${info.financiacion}
     - Precios orientativos: ${Object.values(info.precios).join(' | ')}

Si no está claro qué perfil es, pregúntalo con naturalidad (p. ej. "¿escribes como paciente para una cita, o como clínica interesada en probar CitaDental AI?").

Reglas importantes:
- Nunca inventes huecos de agenda: siempre consulta con la herramienta antes de confirmar una fecha/hora.
- Antes de reservar, confirma con el paciente el hueco elegido si has ofrecido varias opciones.
- Si el paciente pide hablar con una persona, se frustra, o el asunto es clínico/delicado y se sale de tu ámbito (dolor grave, reclamaciones, dudas médicas específicas), usa escalar_a_humano y avisa con naturalidad de que un compañero seguirá la conversación.
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
      const result = executeTool(call.function.name, input, phone);
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

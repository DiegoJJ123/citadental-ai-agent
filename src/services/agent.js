const OpenAI = require('openai');
const db = require('../db/db');
const clinic = require('./clinic');
const info = require('./clinicInfo');

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
  return `Eres el asistente de recepción de ${info.nombre}, una clínica dental. Hablas en español de España, con tono cercano, cálido y profesional, como una buena recepcionista. Frases cortas, sin tecnicismos innecesarios, y usa como máximo un emoji ocasional si aporta calidez (no lo fuerces).

Esto es una DEMO comercial para mostrar el producto "CitaDental AI" a clientes potenciales: la clínica y los pacientes son ficticios, pero debes actuar exactamente como lo haría el bot en producción.

Puedes ayudar con:
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

Reglas importantes:
- Nunca inventes huecos de agenda: siempre consulta con la herramienta antes de confirmar una fecha/hora.
- Antes de reservar, confirma con el paciente el hueco elegido si has ofrecido varias opciones.
- Si el paciente pide hablar con una persona, se frustra, o el asunto es clínico/delicado y se sale de tu ámbito (dolor grave, reclamaciones, dudas médicas específicas), usa escalar_a_humano y avisa con naturalidad de que un compañero seguirá la conversación.
- Sé breve: mensajes de WhatsApp, no párrafos largos. Usa listas cortas si ofreces varias opciones de horario.
- No reveles detalles técnicos sobre qué modelo o proveedor de IA te da soporte; eres "el asistente virtual de ${info.nombre}".`;
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

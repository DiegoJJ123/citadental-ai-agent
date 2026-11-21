// Tipos de negocio y modos de reserva.
//
// Tipo de negocio (clinics.business_type): cambia el vocabulario, los datos
// que se piden en el paso 2 y cómo se presenta el asistente.
// Modo de reserva (clinics.booking_mode):
//  - calendar: el asistente reserva, cambia y cancela en Google Calendar.
//  - link:     el asistente manda el enlace de reservas del negocio (Restoo,
//              Doctoralia, Calendly, su web…). No toca reservas.
//  - request:  el asistente recoge la solicitud y avisa al negocio, que la
//              apunta en su programa y confirma.

const COMMON_HEAD = [
  { key: 'nombre', label: 'Nombre del negocio' },
  { key: 'telefono', label: 'Teléfono' },
  { key: 'email', label: 'Email' },
  { key: 'direccion', label: 'Dirección' },
  { key: 'como_llegar', label: 'Cómo llegar / parking / transporte', multiline: true },
];

const TYPES = {
  dental: {
    key: 'dental',
    label: 'Clínica dental',
    place: 'clínica',
    placeThe: 'la clínica',
    customer: 'paciente',
    customers: 'pacientes',
    Customers: 'Pacientes',
    booking: 'cita',
    bookings: 'citas',
    Bookings: 'Citas',
    namePlaceholder: 'Clínica Dental Sonrisa',
    persona: (name) => `Eres el asistente virtual de WhatsApp de la clínica dental "${name}". Atiendes a sus pacientes`,
    fields: [
      { key: 'nombre', label: 'Nombre de la clínica' },
      ...COMMON_HEAD.slice(1),
      { key: 'horario', label: 'Horario de la clínica', multiline: true },
      { key: 'tratamientos', label: 'Tratamientos que ofrece', multiline: true },
      { key: 'precios', label: 'Precios', multiline: true },
      { key: 'primera_visita', label: 'Primera visita (precio, qué incluye)', multiline: true },
      { key: 'mutuas', label: 'Mutuas / aseguradoras', multiline: true },
      { key: 'financiacion', label: 'Financiación y formas de pago', multiline: true },
      { key: 'idiomas', label: 'Idiomas' },
      { key: 'otros', label: 'Otra información útil para pacientes', multiline: true },
    ],
    extractWhat: 'una clínica dental española',
    extractRules: [
      '"precios": una línea por tratamiento, formato "Tratamiento: precio".',
      '"tratamientos" y "mutuas": una por línea.',
    ],
    rules: [
      'No des consejos médicos ni diagnósticos. Ante dolor fuerte, sangrado, golpes o una urgencia, prioriza que le atiendan cuanto antes y, si no puedes resolverlo, usa escalar_a_humano.',
    ],
  },
  restaurante: {
    key: 'restaurante',
    label: 'Restaurante',
    place: 'restaurante',
    placeThe: 'el restaurante',
    customer: 'cliente',
    customers: 'clientes',
    Customers: 'Clientes',
    booking: 'reserva',
    bookings: 'reservas',
    Bookings: 'Reservas',
    namePlaceholder: 'Restaurante La Plaza',
    persona: (name) => `Eres el asistente virtual de WhatsApp del restaurante "${name}". Atiendes a sus clientes`,
    fields: [
      { key: 'nombre', label: 'Nombre del restaurante' },
      ...COMMON_HEAD.slice(1),
      { key: 'horario', label: 'Horario (comidas, cenas, días de cierre)', multiline: true },
      { key: 'cocina', label: 'Tipo de cocina y especialidades', multiline: true },
      { key: 'carta', label: 'Carta / platos destacados y precios', multiline: true },
      { key: 'menu_dia', label: 'Menú del día (qué incluye, precio, días)', multiline: true },
      { key: 'precio_medio', label: 'Precio medio por persona' },
      { key: 'alergenos', label: 'Alérgenos, sin gluten, vegetariano / vegano', multiline: true },
      { key: 'espacios', label: 'Terraza, salones, accesibilidad, tronas, mascotas', multiline: true },
      { key: 'grupos', label: 'Grupos, eventos y celebraciones', multiline: true },
      { key: 'llevar', label: 'Para llevar / a domicilio', multiline: true },
      { key: 'pago', label: 'Formas de pago', multiline: true },
      { key: 'otros', label: 'Otra información útil para clientes', multiline: true },
    ],
    extractWhat: 'un restaurante español',
    extractRules: [
      '"carta": una línea por plato o sección destacada, con su precio si aparece.',
      '"alergenos": solo lo que la web diga explícitamente.',
    ],
    rules: [
      'Sobre alérgenos e intolerancias: da solo la información que tengas en los datos y recomienda siempre avisar al personal al llegar. Si no hay datos sobre un alérgeno concreto, dilo y ofrece que lo confirme el restaurante.',
      'Para grupos grandes, eventos o celebraciones, toma nota de lo que necesitan (fecha, número de personas, tipo de evento) y usa escalar_a_humano para que el restaurante les conteste.',
    ],
  },
  otro: {
    key: 'otro',
    label: 'Otro negocio',
    place: 'negocio',
    placeThe: 'el negocio',
    customer: 'cliente',
    customers: 'clientes',
    Customers: 'Clientes',
    booking: 'reserva',
    bookings: 'reservas',
    Bookings: 'Reservas',
    namePlaceholder: 'Nombre del negocio',
    persona: (name) => `Eres el asistente virtual de WhatsApp de "${name}". Atiendes a sus clientes`,
    fields: [
      ...COMMON_HEAD,
      { key: 'horario', label: 'Horario', multiline: true },
      { key: 'servicios', label: 'Servicios o productos', multiline: true },
      { key: 'precios', label: 'Precios', multiline: true },
      { key: 'pago', label: 'Formas de pago', multiline: true },
      { key: 'otros', label: 'Otra información útil para clientes', multiline: true },
    ],
    extractWhat: 'un negocio español',
    extractRules: ['"servicios" y "precios": uno por línea.'],
    rules: [],
  },
};

const BOOKING_MODES = {
  calendar: {
    key: 'calendar',
    label: 'Reserva el asistente (Google Calendar)',
    desc: 'El asistente ve los huecos libres en el Google Calendar del negocio y reserva, cambia y cancela él solo.',
  },
  link: {
    key: 'link',
    label: 'Enviar el enlace de reservas',
    desc: 'Para quien ya reserva con una app o web (Restoo, Doctoralia, TheFork, Calendly…). El asistente responde dudas y, cuando el cliente quiere reservar, le manda el enlace.',
  },
  request: {
    key: 'request',
    label: 'Recoger la solicitud y avisar',
    desc: 'Para quien lleva la agenda en otro programa o en papel. El asistente pregunta qué necesita y cuándo, y avisa al negocio por email y WhatsApp para que la apunte y confirme.',
  },
};

const typeOf = (clinic) => TYPES[clinic?.business_type] || TYPES.dental;
const modeOf = (clinic) => (BOOKING_MODES[clinic?.booking_mode] ? clinic.booking_mode : 'calendar');
const fieldsFor = (clinic) => typeOf(clinic).fields;

module.exports = { TYPES, BOOKING_MODES, typeOf, modeOf, fieldsFor };

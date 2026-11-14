require('dotenv').config();

// Primero, si hace falta, se copia la base de datos de otro servidor (cambio de
// región); después arranca la aplicación.
require('./db/bootstrap')
  .run()
  .then(() => require('./app'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

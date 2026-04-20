// backend/src/utils/logging.js
const db = require('../config/database');

exports.registrarLogSistema = async (
  modulo, accion, entidad_tipo, entidad_id, entidad_nombre, detalles, metadata,
  usuario_id, usuario_nombre, usuario_correo, ip_address
) => {
  try {
    const queryText = `
      INSERT INTO logs_sistema (
        modulo, accion, entidad_tipo, entidad_id, entidad_nombre,
        detalles, metadata, usuario_id, usuario_nombre, usuario_correo, ip_address
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING id;
    `;
    
    const result = await db.query(queryText, [
      modulo, 
      accion, 
      entidad_tipo, 
      entidad_id, 
      entidad_nombre,
      detalles, 
      metadata || '{}', 
      usuario_id, 
      usuario_nombre, 
      usuario_correo, 
      ip_address
    ]);
    
    return result.rows[0].id;
  } catch (error) {
    console.error('Error registrando log del sistema:', error);
    return null;
  }
};
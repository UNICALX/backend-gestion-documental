// controllers/configuracionPeriodosController.js
const { pool } = require('../config/database');

class ConfiguracionPeriodosController {
  
  /**
   * Obtener todas las configuraciones
   */
  async getAllConfiguraciones(req, res) {
    try {
      console.log('📋 Obteniendo todas las configuraciones de períodos');
      
      const result = await pool.query(
        `SELECT cp.*, 
                a.nombre as articulo_nombre, 
                a.descripcion as articulo_descripcion,
                u.nombre_completo as usuario_creador_nombre
         FROM configuracion_periodos cp
         JOIN articulos a ON cp.articulo_id = a.id
         LEFT JOIN usuarios u ON cp.usuario_creador_id = u.id
         ORDER BY a.orden, 
           CASE 
             WHEN cp.fraccion = 'default' THEN '0'
             ELSE cp.fraccion
           END`
      );
      
      console.log(`✅ Encontradas ${result.rows.length} configuraciones`);
      
      // Parsear periodos de JSON a array
      const configuraciones = result.rows.map(config => ({
        ...config,
        periodos: config.periodos || []
      }));
      
      res.json({
        success: true,
        configuraciones
      });
      
    } catch (error) {
      console.error('❌ Error obteniendo configuraciones:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Error del servidor al obtener configuraciones' 
      });
    }
  }

  /**
   * Obtener configuraciones por artículo
   */
  async getConfiguracionesPorArticulo(req, res) {
    try {
      const { articuloId } = req.params;
      
      console.log(`📋 Obteniendo configuraciones para artículo ID: ${articuloId}`);
      
      // Validar que el ID sea un número
      const articuloIdNum = parseInt(articuloId);
      if (isNaN(articuloIdNum)) {
        return res.status(400).json({ 
          success: false, 
          error: 'ID de artículo inválido' 
        });
      }
      
      const result = await pool.query(
        `SELECT * FROM configuracion_periodos 
         WHERE articulo_id = $1 AND activo = true
         ORDER BY 
           CASE 
             WHEN fraccion = 'default' THEN 0 
             ELSE 1 
           END,
           fraccion`,
        [articuloIdNum]
      );
      
      // Parsear periodos de JSON a array
      const configuraciones = result.rows.map(config => ({
        ...config,
        periodos: config.periodos || []
      }));
      
      res.json({
        success: true,
        configuraciones
      });
      
    } catch (error) {
      console.error('❌ Error obteniendo configuraciones por artículo:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Error del servidor' 
      });
    }
  }

  /**
   * Obtener configuración específica por artículo y fracción (admin)
   */
  async getConfiguracion(req, res) {
    try {
      const { articuloId, fraccion } = req.params;
      
      console.log(`🔍 (Admin) Buscando configuración - Artículo: ${articuloId}, Fracción: ${fraccion}`);
      
      // Validar que el ID sea un número
      const articuloIdNum = parseInt(articuloId);
      if (isNaN(articuloIdNum)) {
        return res.status(400).json({ 
          success: false, 
          error: 'ID de artículo inválido' 
        });
      }
      
      const result = await pool.query(
        `SELECT * FROM configuracion_periodos 
         WHERE articulo_id = $1 AND fraccion = $2 AND activo = true`,
        [articuloIdNum, fraccion]
      );
      
      if (result.rows.length === 0) {
        return res.json({
          success: true,
          configuracion: null,
          message: 'No hay configuración para esta fracción'
        });
      }
      
      // Parsear periodos de JSON a array
      const configuracion = {
        ...result.rows[0],
        periodos: result.rows[0].periodos || []
      };
      
      res.json({
        success: true,
        configuracion
      });
      
    } catch (error) {
      console.error('❌ Error obteniendo configuración:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Error del servidor' 
      });
    }
  }

  /**
   * Guardar configuración (crear o actualizar) - VERSIÓN CORREGIDA
   */
  // controllers/configuracionPeriodosController.js - VERSIÓN CORREGIDA

/**
 * Guardar configuración (crear o actualizar) - VERSIÓN CORREGIDA
 */
async guardarConfiguracion(req, res) {
  const client = await pool.connect();
  
  try {
    const { id, articulo_id, fraccion, tipo_periodo, periodos, activo = true } = req.body;
    const usuarioId = req.user.id;
    
    console.log('📤 ===== GUARDANDO CONFIGURACIÓN =====');
    console.log('   ID recibido:', id);
    console.log('   Tipo de ID:', typeof id);
    console.log('   articulo_id:', articulo_id);
    console.log('   fraccion (nueva):', fraccion);
    console.log('   tipo_periodo:', tipo_periodo);
    console.log('   periodos:', JSON.stringify(periodos, null, 2));
    
    // Validaciones
    if (!articulo_id) {
      return res.status(400).json({ 
        success: false, 
        error: 'El ID del artículo es requerido' 
      });
    }
    
    if (!fraccion) {
      return res.status(400).json({ 
        success: false, 
        error: 'La fracción es requerida' 
      });
    }
    
    if (!tipo_periodo) {
      return res.status(400).json({ 
        success: false, 
        error: 'El tipo de período es requerido' 
      });
    }
    
    // 🔥 CAMBIO IMPORTANTE: Verificar que periodos existe, pero no que sea array
    if (!periodos) {
      return res.status(400).json({ 
        success: false, 
        error: 'Debe proporcionar períodos' 
      });
    }
    
    // Si es un objeto con la estructura nueva, verificar que tenga períodos
    if (typeof periodos === 'object' && !Array.isArray(periodos)) {
      if (!periodos.periodos || periodos.periodos.length === 0) {
        return res.status(400).json({ 
          success: false, 
          error: 'Debe proporcionar al menos un período' 
        });
      }
    } else if (Array.isArray(periodos) && periodos.length === 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'Debe proporcionar al menos un período' 
      });
    }
    
    await client.query('BEGIN');
    
    // Verificar si el artículo existe
    const articuloCheck = await client.query(
      'SELECT id FROM articulos WHERE id = $1',
      [articulo_id]
    );
    
    if (articuloCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ 
        success: false, 
        error: 'El artículo no existe' 
      });
    }
    
    // 🔥 CASO 1: UPDATE POR ID (edición)
    if (id) {
      console.log(`🔍 Buscando configuración con ID: ${id}`);
      
      // Verificar que el ID existe
      const checkExist = await client.query(
        'SELECT id, fraccion FROM configuracion_periodos WHERE id = $1',
        [id]
      );
      
      if (checkExist.rows.length === 0) {
        await client.query('ROLLBACK');
        console.log(`❌ No se encontró configuración con ID: ${id}`);
        return res.status(404).json({ 
          success: false, 
          error: `No se encontró configuración con ID ${id}` 
        });
      }
      
      console.log(`✅ Configuración encontrada:`, checkExist.rows[0]);
      console.log(`   Actualizando de fracción "${checkExist.rows[0].fraccion}" a "${fraccion}"`);
      
      // ACTUALIZAR POR ID
      const result = await client.query(
        `UPDATE configuracion_periodos 
         SET tipo_periodo = $1,
             periodos = $2,
             activo = $3,
             fraccion = $4,
             fecha_actualizacion = CURRENT_TIMESTAMP
         WHERE id = $5
         RETURNING *`,
        [tipo_periodo, JSON.stringify(periodos), activo, fraccion, id]
      );
      
      console.log('✅ Resultado de UPDATE:', result.rows[0]);
      
      await client.query('COMMIT');
      
      const configuracion = {
        ...result.rows[0],
        periodos: result.rows[0].periodos
      };
      
      console.log('✅✅✅ CONFIGURACIÓN ACTUALIZADA CON ÉXITO');
      console.log('   Nuevos valores:', configuracion);
      
      return res.json({
        success: true,
        message: `Configuración actualizada correctamente`,
        configuracion
      });
      
    } else {
      // 🔥 CASO 2: INSERT NUEVO (creación)
      console.log(`➕ Creando NUEVA configuración para fracción: ${fraccion}`);
      
      // Verificar si ya existe una configuración para esta fracción
      const existing = await client.query(
        'SELECT id FROM configuracion_periodos WHERE articulo_id = $1 AND fraccion = $2',
        [articulo_id, fraccion]
      );
      
      if (existing.rows.length > 0) {
        await client.query('ROLLBACK');
        console.log(`❌ Ya existe configuración para fracción ${fraccion} con ID: ${existing.rows[0].id}`);
        return res.status(400).json({ 
          success: false, 
          error: `Ya existe una configuración para la fracción ${fraccion}` 
        });
      }
      
      // Insertar nueva configuración
      const result = await client.query(
        `INSERT INTO configuracion_periodos 
         (articulo_id, fraccion, tipo_periodo, periodos, activo, usuario_creador_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [articulo_id, fraccion, tipo_periodo, JSON.stringify(periodos), activo, usuarioId]
      );
      
      await client.query('COMMIT');
      
      const configuracion = {
        ...result.rows[0],
        periodos: result.rows[0].periodos
      };
      
      console.log('✅✅✅ NUEVA CONFIGURACIÓN CREADA CON ÉXITO');
      console.log('   ID:', configuracion.id);
      
      res.json({
        success: true,
        message: fraccion === 'default' 
          ? 'Configuración por defecto guardada' 
          : `Configuración para fracción ${fraccion} guardada`,
        configuracion
      });
    }
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌❌❌ ERROR GUARDANDO CONFIGURACIÓN:');
    console.error('   Mensaje:', error.message);
    console.error('   Stack:', error.stack);
    
    // Error de unique constraint
    if (error.code === '23505') {
      return res.status(400).json({ 
        success: false, 
        error: 'Ya existe una configuración para esta fracción' 
      });
    }
    
    res.status(500).json({ 
      success: false, 
      error: 'Error del servidor al guardar configuración',
      details: error.message
    });
    
  } finally {
    client.release();
  }
}

  /**
   * Eliminar configuración
   */
  async eliminarConfiguracion(req, res) {
    try {
      const { id } = req.params;
      
      console.log(`🗑️ Eliminando configuración ID: ${id}`);
      
      const idNum = parseInt(id);
      if (isNaN(idNum)) {
        return res.status(400).json({ 
          success: false, 
          error: 'ID inválido' 
        });
      }
      
      const result = await pool.query(
        'DELETE FROM configuracion_periodos WHERE id = $1 RETURNING *',
        [idNum]
      );
      
      if (result.rows.length === 0) {
        return res.status(404).json({ 
          success: false, 
          error: 'Configuración no encontrada' 
        });
      }
      
      res.json({
        success: true,
        message: 'Configuración eliminada correctamente'
      });
      
    } catch (error) {
      console.error('❌ Error eliminando configuración:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Error del servidor al eliminar configuración' 
      });
    }
  }

  /**
   * Obtener configuración pública (para usuarios normales)
   */
  async getConfiguracionPublica(req, res) {
    try {
      const { articuloId, fraccion } = req.params;
      
      console.log(`🔍 (Pública) Buscando configuración - Artículo: ${articuloId}, Fracción: ${fraccion}`);
      
      // Validar que el ID sea un número
      const articuloIdNum = parseInt(articuloId);
      if (isNaN(articuloIdNum)) {
        return res.status(400).json({ 
          success: false, 
          error: 'ID de artículo inválido' 
        });
      }
      
      const result = await pool.query(
        `SELECT * FROM configuracion_periodos 
         WHERE articulo_id = $1 AND fraccion = $2 AND activo = true`,
        [articuloIdNum, fraccion]
      );
      
      if (result.rows.length === 0) {
        // Si no hay configuración específica, buscar default
        const defaultResult = await pool.query(
          `SELECT * FROM configuracion_periodos 
           WHERE articulo_id = $1 AND fraccion = 'default' AND activo = true`,
          [articuloIdNum]
        );
        
        if (defaultResult.rows.length > 0) {
          return res.json({
            success: true,
            configuracion: {
              ...defaultResult.rows[0],
              periodos: defaultResult.rows[0].periodos || []
            }
          });
        }
        
        return res.json({
          success: true,
          configuracion: null,
          message: 'No hay configuración para esta fracción'
        });
      }
      
      // Parsear periodos de JSON a array
      const configuracion = {
        ...result.rows[0],
        periodos: result.rows[0].periodos || []
      };
      
      res.json({
        success: true,
        configuracion
      });
      
    } catch (error) {
      console.error('❌ Error obteniendo configuración pública:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Error del servidor' 
      });
    }
  }

  /**
   * Duplicar configuración default a fracción específica
   */
  async duplicarConfigDefault(req, res) {
    const client = await pool.connect();
    
    try {
      const { articulo_id, fraccion } = req.body;
      const usuarioId = req.user.id;
      
      console.log(`📋 Duplicando configuración default para artículo ${articulo_id} a fracción ${fraccion}`);
      
      if (!articulo_id || !fraccion) {
        return res.status(400).json({ 
          success: false, 
          error: 'Se requiere artículo_id y fracción' 
        });
      }
      
      await client.query('BEGIN');
      
      // Obtener configuración default
      const defaultConfig = await client.query(
        `SELECT * FROM configuracion_periodos 
         WHERE articulo_id = $1 AND fraccion = 'default'`,
        [articulo_id]
      );
      
      if (defaultConfig.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ 
          success: false, 
          error: 'No hay configuración default para este artículo' 
        });
      }
      
      // Verificar si ya existe configuración para esta fracción
      const existing = await client.query(
        `SELECT id FROM configuracion_periodos 
         WHERE articulo_id = $1 AND fraccion = $2`,
        [articulo_id, fraccion]
      );
      
      if (existing.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ 
          success: false, 
          error: `Ya existe una configuración para la fracción ${fraccion}` 
        });
      }
      
      // Crear nueva configuración para la fracción
      const result = await client.query(
        `INSERT INTO configuracion_periodos 
         (articulo_id, fraccion, tipo_periodo, periodos, activo, usuario_creador_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [
          articulo_id,
          fraccion,
          defaultConfig.rows[0].tipo_periodo,
          defaultConfig.rows[0].periodos,
          true,
          usuarioId
        ]
      );
      
      await client.query('COMMIT');
      
      // Parsear periodos de JSON a array
      const configuracion = {
        ...result.rows[0],
        periodos: result.rows[0].periodos || []
      };
      
      res.json({
        success: true,
        message: `Configuración default duplicada a fracción ${fraccion}`,
        configuracion
      });
      
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('❌ Error duplicando configuración:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Error del servidor al duplicar configuración' 
      });
      
    } finally {
      client.release();
    }
  }

  /**
   * Obtener configuración por nombre de artículo (para upload)
   */
  async getConfiguracionPorNombreArticulo(req, res) {
    try {
      const { articuloNombre, fraccion } = req.params;
      
      console.log(`🔍 Buscando configuración por nombre - Artículo: ${articuloNombre}, Fracción: ${fraccion}`);
      
      // Primero obtener el artículo por su nombre
      const articuloResult = await pool.query(
        'SELECT id FROM articulos WHERE nombre = $1 AND activo = true',
        [articuloNombre]
      );
      
      if (articuloResult.rows.length === 0) {
        return res.status(404).json({ 
          success: false, 
          error: 'Artículo no encontrado' 
        });
      }
      
      const articuloId = articuloResult.rows[0].id;
      
      // Buscar configuración específica
      const configResult = await pool.query(
        `SELECT * FROM configuracion_periodos 
         WHERE articulo_id = $1 AND fraccion = $2 AND activo = true`,
        [articuloId, fraccion]
      );
      
      if (configResult.rows.length > 0) {
        return res.json({
          success: true,
          configuracion: {
            ...configResult.rows[0],
            periodos: configResult.rows[0].periodos || []
          }
        });
      }
      
      // Si no hay específica, buscar default
      const defaultResult = await pool.query(
        `SELECT * FROM configuracion_periodos 
         WHERE articulo_id = $1 AND fraccion = 'default' AND activo = true`,
        [articuloId]
      );
      
      if (defaultResult.rows.length > 0) {
        return res.json({
          success: true,
          configuracion: {
            ...defaultResult.rows[0],
            periodos: defaultResult.rows[0].periodos || []
          }
        });
      }
      
      // Si no hay configuración, devolver null
      res.json({
        success: true,
        configuracion: null,
        message: 'No hay configuración para este artículo/fracción'
      });
      
    } catch (error) {
      console.error('❌ Error obteniendo configuración por nombre:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Error del servidor' 
      });
    }
  }
}
  
module.exports = new ConfiguracionPeriodosController();
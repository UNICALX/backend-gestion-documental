// controllers/articulosController.js 
const { pool } = require('../config/database');

class ArticulosController {
  
  // ==================== MÉTODOS PÚBLICOS ====================

  /**
   * Obtener todos los artículos
   */
  async getArticulos(req, res) {
    try {
      const { activo, search } = req.query;
      
      let query = `
        SELECT a.*, 
                COUNT(DISTINCT da.departamento_id) as total_departamentos,
                (SELECT COUNT(*) FROM documentos d 
                 WHERE d.clasificacion_articulo = a.nombre AND d.eliminado = false) as total_documentos
         FROM articulos a
         LEFT JOIN departamento_articulos da ON a.id = da.articulo_id
         WHERE 1=1
      `;
      
      const params = [];
      let paramCount = 0;
      
      if (activo !== undefined) {
        paramCount++;
        query += ` AND a.activo = $${paramCount}`;
        params.push(activo === 'true');
      }
      
      if (search) {
        paramCount++;
        query += ` AND (a.nombre ILIKE $${paramCount} OR a.descripcion ILIKE $${paramCount})`;
        params.push(`%${search}%`);
      }
      
      query += ` GROUP BY a.id ORDER BY a.orden, a.nombre`;
      
      const result = await pool.query(query, params);
      
      res.json({
        success: true,
        articulos: result.rows,
        rol: req.user?.rol // Incluir el rol para debugging
      });
    } catch (error) {
      console.error('Error obteniendo artículos:', error);
      res.status(500).json({ success: false, error: 'Error del servidor' });
    }
  }
/**
 * Quitar permiso (admin) - con parámetros en la URL
 */
async quitarPermisoPorPath(req, res) {
  const client = await pool.connect();
  try {
    const { departamentoId, articuloId } = req.params;
    
    console.log(`🗑️ Quitando permiso - Depto: ${departamentoId}, Art: ${articuloId}`);
    
    const departamento_id = parseInt(departamentoId);
    const articulo_id = parseInt(articuloId);
    
    if (isNaN(departamento_id) || isNaN(articulo_id)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Parámetros inválidos' 
      });
    }
    
    const usuarioId = req.user.id;
    
    await client.query('BEGIN');
    
    // Verificar si hay documentos usando este artículo
    const docsCount = await client.query(
      `SELECT COUNT(*) FROM documentos 
       WHERE departamento_id = $1 AND clasificacion_articulo = (
         SELECT nombre FROM articulos WHERE id = $2
       ) AND eliminado = false`,
      [departamento_id, articulo_id]
    );
    
    if (parseInt(docsCount.rows[0].count) > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        error: 'No se puede quitar el permiso porque existen documentos usando este artículo',
        documentos: parseInt(docsCount.rows[0].count)
      });
    }
    
    // Registrar en historial antes de eliminar
    await client.query(
      `INSERT INTO historial_articulos_asignaciones (departamento_id, articulo_id, accion, usuario_id, ip_address)
       VALUES ($1, $2, 'desasignar', $3, $4)`,
      [departamento_id, articulo_id, usuarioId, req.ip]
    );
    
    // Eliminar permiso
    const result = await client.query(
      'DELETE FROM departamento_articulos WHERE departamento_id = $1 AND articulo_id = $2 RETURNING *',
      [departamento_id, articulo_id]
    );
    
    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        error: 'No se encontró el permiso para eliminar'
      });
    }
    
    await client.query('COMMIT');
    
    console.log(`✅ Permiso eliminado: Depto ${departamento_id}, Art ${articulo_id}`);
    
    res.json({
      success: true,
      message: 'Permiso eliminado correctamente'
    });
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error quitando permiso:', error);
    res.status(500).json({ success: false, error: 'Error del servidor' });
  } finally {
    client.release();
  }
}
  /**
   * Obtener artículos a los que un departamento tiene acceso
   */
  async getArticulosPorDepartamento(req, res) {
    try {
      const { departamentoId } = req.params;
      
      const result = await pool.query(
        `SELECT a.*, da.puede_subir, da.puede_ver, da.fecha_asignacion
         FROM articulos a
         JOIN departamento_articulos da ON a.id = da.articulo_id
         WHERE da.departamento_id = $1 AND a.activo = true
         ORDER BY a.orden, a.nombre`,
        [departamentoId]
      );
      
      res.json({
        success: true,
        articulos: result.rows
      });
    } catch (error) {
      console.error('Error obteniendo artículos por departamento:', error);
      res.status(500).json({ success: false, error: 'Error del servidor' });
    }
  }

  /**
   * Obtener artículo por ID
   */
  async getArticuloById(req, res) {
    try {
      const { id } = req.params;
      
      // Verificar que el ID sea un número válido
      const articuloId = parseInt(id);
      if (isNaN(articuloId)) {
        return res.status(400).json({ 
          success: false, 
          error: 'ID de artículo inválido. Debe ser un número.' 
        });
      }
      
      const result = await pool.query(
        `SELECT a.*, 
                COUNT(DISTINCT da.departamento_id) as total_departamentos,
                (SELECT COUNT(*) FROM documentos d 
                 WHERE d.clasificacion_articulo = a.nombre AND d.eliminado = false) as total_documentos
         FROM articulos a
         LEFT JOIN departamento_articulos da ON a.id = da.articulo_id
         WHERE a.id = $1
         GROUP BY a.id`,
        [articuloId]
      );
      
      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Artículo no encontrado' });
      }
      
      res.json({
        success: true,
        articulo: result.rows[0]
      });
    } catch (error) {
      console.error('Error obteniendo artículo:', error);
      res.status(500).json({ success: false, error: 'Error del servidor' });
    }
  }

  /**
   * Verificar acceso a artículo
   */
  async verificarAcceso(req, res) {
    try {
      const { departamentoId, articuloId } = req.params;
      
      // 🔥 Si es admin, siempre tiene acceso
      if (req.user.rol === 'administrador') {
        return res.json({
          success: true,
          tiene_acceso: true,
          puede_ver: true,
          puede_subir: true,
          es_admin: true
        });
      }
      
      const result = await pool.query(
        `SELECT puede_ver, puede_subir 
         FROM departamento_articulos 
         WHERE departamento_id = $1 AND articulo_id = $2`,
        [departamentoId, articuloId]
      );
      
      if (result.rows.length > 0) {
        res.json({
          success: true,
          tiene_acceso: true,
          puede_ver: result.rows[0].puede_ver,
          puede_subir: result.rows[0].puede_subir
        });
      } else {
        res.json({
          success: true,
          tiene_acceso: false,
          puede_ver: false,
          puede_subir: false
        });
      }
    } catch (error) {
      console.error('Error verificando acceso:', error);
      res.status(500).json({ success: false, error: 'Error del servidor' });
    }
  }

  // ==================== NUEVO MÉTODO PARA FRACCIONES ====================

  /**
   * Obtener fracciones disponibles para un artículo (desde configuracion_periodos)
   */
  async getFraccionesPorArticulo(req, res) {
    try {
      const { articuloId } = req.params;
      
      console.log(`🔍 Obteniendo fracciones para artículo ID: ${articuloId}`);
      
      // Validar que el ID sea un número
      const id = parseInt(articuloId);
      if (isNaN(id)) {
        return res.status(400).json({ 
          success: false, 
          error: 'ID de artículo inválido' 
        });
      }
      
      // Versión corregida usando subconsulta para ORDER BY
      const result = await pool.query(
        `SELECT fraccion 
         FROM (
           SELECT DISTINCT fraccion,
             CASE 
               WHEN fraccion ~ '^[0-9]+$' THEN LPAD(fraccion, 10, '0')
               ELSE fraccion
             END as orden
           FROM configuracion_periodos 
           WHERE articulo_id = $1 
             AND activo = true
             AND fraccion != 'default'
         ) AS sub
         ORDER BY orden`,
        [id]
      );
      
      const fracciones = result.rows.map(row => row.fraccion);
      
      console.log(`✅ Fracciones encontradas (${fracciones.length}):`, fracciones);
      
      res.json({
        success: true,
        fracciones
      });
      
    } catch (error) {
      console.error('❌ Error obteniendo fracciones:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Error del servidor',
        details: error.message 
      });
    }
  }

  /**
   * Obtener estadísticas de uso por fracción
   */
  async getEstadisticasPorFraccion(req, res) {
    try {
      const { articuloId } = req.params;
      
      console.log(`📊 Obteniendo estadísticas por fracción para artículo: ${articuloId}`);
      
      const id = parseInt(articuloId);
      if (isNaN(id)) {
        return res.status(400).json({ 
          success: false, 
          error: 'ID de artículo inválido' 
        });
      }
      
      const result = await pool.query(
        `SELECT 
           d.clasificacion_fraccion as fraccion,
           COUNT(*) as total_documentos,
           COALESCE(SUM(d.tamaño_archivo), 0) as espacio_total
         FROM documentos d
         WHERE d.clasificacion_articulo = (
           SELECT nombre FROM articulos WHERE id = $1
         )
         AND d.eliminado = false
         GROUP BY d.clasificacion_fraccion
         ORDER BY 
           CASE 
             WHEN d.clasificacion_fraccion ~ '^[0-9]+$' THEN LPAD(d.clasificacion_fraccion, 10, '0')
             ELSE d.clasificacion_fraccion
           END`,
        [id]
      );
      
      res.json({
        success: true,
        estadisticas: result.rows
      });
      
    } catch (error) {
      console.error('❌ Error obteniendo estadísticas por fracción:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Error del servidor' 
      });
    }
  }

  // ==================== MÉTODOS DE ADMINISTRACIÓN ====================

  /**
   * Obtener todos los permisos (admin)
   */
  async getAllPermisos(req, res) {
    try {
      const result = await pool.query(
        `SELECT 
           da.*,
           d.nombre as departamento_nombre,
           d.codigo as departamento_codigo,
           a.nombre as articulo_nombre,
           a.descripcion as articulo_descripcion,
           u.nombre_completo as usuario_asignador_nombre,
           (SELECT COUNT(*) FROM documentos doc 
            WHERE doc.departamento_id = da.departamento_id 
              AND doc.clasificacion_articulo = a.nombre 
              AND doc.eliminado = false) as documentos_en_articulo
         FROM departamento_articulos da
         JOIN departamentos d ON da.departamento_id = d.id
         JOIN articulos a ON da.articulo_id = a.id
         LEFT JOIN usuarios u ON da.usuario_asignador_id = u.id
         ORDER BY d.nombre, a.nombre`
      );
      
      res.json({
        success: true,
        permisos: result.rows
      });
    } catch (error) {
      console.error('Error obteniendo permisos:', error);
      res.status(500).json({ success: false, error: 'Error del servidor' });
    }
  }

  /**
   * 🔥 CORREGIDO: Obtener permisos por departamento (con soporte para admin)
   */
  async getPermisosPorDepartamento(req, res) {
    try {
      const { departamentoId } = req.params;
      
      console.log(`📋 Obteniendo permisos para departamento ${departamentoId}`);
      console.log(`👑 Usuario rol: ${req.user.rol}`);
      
      // 🔥 IMPORTANTE: Si el usuario es admin, devolver TODOS los artículos
      if (req.user.rol === 'administrador') {
        console.log('👑 ADMIN: Devolviendo TODOS los artículos con permisos completos');
        
        const result = await pool.query(
          `SELECT 
             a.id as articulo_id,
             a.nombre as articulo_nombre,
             a.descripcion as articulo_descripcion,
             true as puede_subir,
             true as puede_ver,
             (SELECT COUNT(*) FROM documentos d 
              WHERE d.clasificacion_articulo = a.nombre 
                AND d.departamento_id = $1
                AND d.eliminado = false) as documentos_en_articulo
           FROM articulos a
           WHERE a.activo = true
           ORDER BY a.orden, a.nombre`,
          [departamentoId]
        );
        
        return res.json({
          success: true,
          permisos: result.rows,
          es_admin: true,
          todos_articulos: true
        });
      }
      
      // Comportamiento normal para usuarios no admin
      const result = await pool.query(
        `SELECT 
           da.*,
           a.nombre as articulo_nombre,
           a.descripcion as articulo_descripcion,
           (SELECT COUNT(*) FROM documentos doc 
            WHERE doc.departamento_id = $1 
              AND doc.clasificacion_articulo = a.nombre 
              AND doc.eliminado = false) as documentos_en_articulo
         FROM departamento_articulos da
         JOIN articulos a ON da.articulo_id = a.id
         WHERE da.departamento_id = $1
         ORDER BY a.orden, a.nombre`,
        [departamentoId]
      );
      
      res.json({
        success: true,
        permisos: result.rows
      });
      
    } catch (error) {
      console.error('Error obteniendo permisos por departamento:', error);
      res.status(500).json({ success: false, error: 'Error del servidor' });
    }
  }

  /**
   * Obtener permisos por artículo (admin)
   */
  async getPermisosPorArticulo(req, res) {
    try {
      const { articuloId } = req.params;
      
      const result = await pool.query(
        `SELECT 
           da.*,
           d.nombre as departamento_nombre,
           d.codigo as departamento_codigo,
           (SELECT COUNT(*) FROM documentos doc 
            WHERE doc.departamento_id = da.departamento_id 
              AND doc.clasificacion_articulo = a.nombre 
              AND doc.eliminado = false) as documentos_en_articulo
         FROM departamento_articulos da
         JOIN departamentos d ON da.departamento_id = d.id
         JOIN articulos a ON da.articulo_id = a.id
         WHERE da.articulo_id = $1
         ORDER BY d.nombre`,
        [articuloId]
      );
      
      res.json({
        success: true,
        permisos: result.rows
      });
    } catch (error) {
      console.error('Error obteniendo permisos por artículo:', error);
      res.status(500).json({ success: false, error: 'Error del servidor' });
    }
  }

  /**
   * Obtener departamentos que NO tienen un artículo asignado (admin)
   */
  async getDepartamentosDisponibles(req, res) {
    try {
      const { articuloId } = req.params;
      
      const result = await pool.query(
        `SELECT d.id, d.nombre, d.codigo
         FROM departamentos d
         WHERE d.activo = true
           AND NOT EXISTS (
             SELECT 1 FROM departamento_articulos da
             WHERE da.departamento_id = d.id AND da.articulo_id = $1
           )
         ORDER BY d.nombre`,
        [articuloId]
      );
      
      res.json({
        success: true,
        departamentos: result.rows
      });
    } catch (error) {
      console.error('Error obteniendo departamentos disponibles:', error);
      res.status(500).json({ success: false, error: 'Error del servidor' });
    }
  }

  /**
   * Asignar permiso (admin)
   */
  async asignarPermiso(req, res) {
    const client = await pool.connect();
    try {
      const { departamento_id, articulo_id, puede_subir = true, puede_ver = true } = req.body;
      const usuarioId = req.user.id;
      
      await client.query('BEGIN');
      
      // Verificar si ya existe
      const existing = await client.query(
        'SELECT id FROM departamento_articulos WHERE departamento_id = $1 AND articulo_id = $2',
        [departamento_id, articulo_id]
      );
      
      if (existing.rows.length > 0) {
        // Actualizar existente
        await client.query(
          `UPDATE departamento_articulos 
           SET puede_subir = $1, puede_ver = $2, usuario_asignador_id = $3, fecha_asignacion = CURRENT_TIMESTAMP
           WHERE departamento_id = $4 AND articulo_id = $5`,
          [puede_subir, puede_ver, usuarioId, departamento_id, articulo_id]
        );
      } else {
        // Insertar nuevo
        await client.query(
          `INSERT INTO departamento_articulos (departamento_id, articulo_id, puede_subir, puede_ver, usuario_asignador_id)
           VALUES ($1, $2, $3, $4, $5)`,
          [departamento_id, articulo_id, puede_subir, puede_ver, usuarioId]
        );
      }
      
      // Registrar en historial
      await client.query(
        `INSERT INTO historial_articulos_asignaciones (departamento_id, articulo_id, accion, usuario_id, ip_address, detalles)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          departamento_id,
          articulo_id,
          existing.rows.length > 0 ? 'modificar' : 'asignar',
          usuarioId,
          req.ip,
          JSON.stringify({ puede_subir, puede_ver })
        ]
      );
      
      await client.query('COMMIT');
      
      res.json({
        success: true,
        message: existing.rows.length > 0 ? 'Permiso actualizado' : 'Permiso asignado'
      });
      
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error asignando permiso:', error);
      res.status(500).json({ success: false, error: 'Error del servidor' });
    } finally {
      client.release();
    }
  }

  /**
   * Actualizar permiso por ID (admin)
   */
  async actualizarPermiso(req, res) {
    const client = await pool.connect();
    try {
      const { id } = req.params;
      const { puede_subir, puede_ver } = req.body;
      const usuarioId = req.user.id;
      
      await client.query('BEGIN');
      
      // Obtener datos actuales
      const permiso = await client.query(
        'SELECT departamento_id, articulo_id FROM departamento_articulos WHERE id = $1',
        [id]
      );
      
      if (permiso.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ success: false, error: 'Permiso no encontrado' });
      }
      
      // Actualizar
      await client.query(
        `UPDATE departamento_articulos 
         SET puede_subir = COALESCE($1, puede_subir),
             puede_ver = COALESCE($2, puede_ver),
             usuario_asignador_id = $3,
             fecha_asignacion = CURRENT_TIMESTAMP
         WHERE id = $4`,
        [puede_subir, puede_ver, usuarioId, id]
      );
      
      // Registrar en historial
      await client.query(
        `INSERT INTO historial_articulos_asignaciones (departamento_id, articulo_id, accion, usuario_id, ip_address, detalles)
         VALUES ($1, $2, 'modificar', $3, $4, $5)`,
        [
          permiso.rows[0].departamento_id,
          permiso.rows[0].articulo_id,
          usuarioId,
          req.ip,
          JSON.stringify({ puede_subir, puede_ver })
        ]
      );
      
      await client.query('COMMIT');
      
      res.json({
        success: true,
        message: 'Permiso actualizado'
      });
      
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error actualizando permiso:', error);
      res.status(500).json({ success: false, error: 'Error del servidor' });
    } finally {
      client.release();
    }
  }

  /**
   * Quitar permiso (admin)
   */
  async quitarPermiso(req, res) {
    const client = await pool.connect();
    try {
      const { departamento_id, articulo_id } = req.body;
      const usuarioId = req.user.id;
      
      await client.query('BEGIN');
      
      // Verificar si hay documentos usando este artículo
      const docsCount = await client.query(
        `SELECT COUNT(*) FROM documentos 
         WHERE departamento_id = $1 AND clasificacion_articulo = (
           SELECT nombre FROM articulos WHERE id = $2
         ) AND eliminado = false`,
        [departamento_id, articulo_id]
      );
      
      if (parseInt(docsCount.rows[0].count) > 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          error: 'No se puede quitar el permiso porque existen documentos usando este artículo',
          documentos: parseInt(docsCount.rows[0].count)
        });
      }
      
      // Registrar en historial antes de eliminar
      await client.query(
        `INSERT INTO historial_articulos_asignaciones (departamento_id, articulo_id, accion, usuario_id, ip_address)
         VALUES ($1, $2, 'desasignar', $3, $4)`,
        [departamento_id, articulo_id, usuarioId, req.ip]
      );
      
      // Eliminar permiso
      await client.query(
        'DELETE FROM departamento_articulos WHERE departamento_id = $1 AND articulo_id = $2',
        [departamento_id, articulo_id]
      );
      
      await client.query('COMMIT');
      
      res.json({
        success: true,
        message: 'Permiso eliminado'
      });
      
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error quitando permiso:', error);
      res.status(500).json({ success: false, error: 'Error del servidor' });
    } finally {
      client.release();
    }
  }

  /**
   * Asignar múltiples permisos (admin)
   */
  async asignarPermisosMultiples(req, res) {
    const client = await pool.connect();
    try {
      const { permisos } = req.body;
      const usuarioId = req.user.id;
      const resultados = [];
      
      await client.query('BEGIN');
      
      for (const permiso of permisos) {
        const { departamento_id, articulo_id, puede_subir = true, puede_ver = true } = permiso;
        
        // Verificar si ya existe
        const existing = await client.query(
          'SELECT id FROM departamento_articulos WHERE departamento_id = $1 AND articulo_id = $2',
          [departamento_id, articulo_id]
        );
        
        if (existing.rows.length > 0) {
          // Actualizar existente
          await client.query(
            `UPDATE departamento_articulos 
             SET puede_subir = $1, puede_ver = $2, usuario_asignador_id = $3, fecha_asignacion = CURRENT_TIMESTAMP
             WHERE departamento_id = $4 AND articulo_id = $5`,
            [puede_subir, puede_ver, usuarioId, departamento_id, articulo_id]
          );
        } else {
          // Insertar nuevo
          await client.query(
            `INSERT INTO departamento_articulos (departamento_id, articulo_id, puede_subir, puede_ver, usuario_asignador_id)
             VALUES ($1, $2, $3, $4, $5)`,
            [departamento_id, articulo_id, puede_subir, puede_ver, usuarioId]
          );
        }
        
        resultados.push({
          departamento_id,
          articulo_id,
          success: true
        });
      }
      
      await client.query('COMMIT');
      
      res.json({
        success: true,
        message: `${permisos.length} permiso(s) procesados`,
        resultados
      });
      
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error asignando múltiples permisos:', error);
      res.status(500).json({ success: false, error: 'Error del servidor' });
    } finally {
      client.release();
    }
  }

  /**
   * Obtener historial de asignaciones (admin)
   */
  async getHistorialAsignaciones(req, res) {
    try {
      const { departamento_id, articulo_id, limit = 100 } = req.query;
      
      let query = `
        SELECT 
          h.*,
          d.nombre as departamento_nombre,
          a.nombre as articulo_nombre,
          u.nombre_completo as usuario_nombre
        FROM historial_articulos_asignaciones h
        JOIN departamentos d ON h.departamento_id = d.id
        JOIN articulos a ON h.articulo_id = a.id
        LEFT JOIN usuarios u ON h.usuario_id = u.id
        WHERE 1=1
      `;
      
      const params = [];
      let paramIndex = 1;
      
      if (departamento_id) {
        query += ` AND h.departamento_id = $${paramIndex}`;
        params.push(departamento_id);
        paramIndex++;
      }
      
      if (articulo_id) {
        query += ` AND h.articulo_id = $${paramIndex}`;
        params.push(articulo_id);
        paramIndex++;
      }
      
      query += ` ORDER BY h.fecha DESC LIMIT $${paramIndex}`;
      params.push(parseInt(limit.toString()));
      
      const result = await pool.query(query, params);
      
      res.json({
        success: true,
        historial: result.rows
      });
      
    } catch (error) {
      console.error('Error obteniendo historial:', error);
      res.status(500).json({ success: false, error: 'Error del servidor' });
    }
  }

  /**
   * Obtener estadísticas de artículos (admin)
   */
  async getEstadisticas(req, res) {
    try {
      const stats = await pool.query(
        `SELECT 
           COUNT(*) as total_articulos,
           SUM((SELECT COUNT(*) FROM departamento_articulos WHERE articulo_id = a.id)) as total_asignaciones,
           json_agg(
             json_build_object(
               'articulo', a.nombre,
               'total_departamentos', (SELECT COUNT(*) FROM departamento_articulos WHERE articulo_id = a.id),
               'total_documentos', (SELECT COUNT(*) FROM documentos WHERE clasificacion_articulo = a.nombre AND eliminado = false)
             )
           ) as por_articulo
         FROM articulos a
         WHERE a.activo = true`
      );
      
      res.json({
        success: true,
        estadisticas: stats.rows[0]
      });
      
    } catch (error) {
      console.error('Error obteniendo estadísticas:', error);
      res.status(500).json({ success: false, error: 'Error del servidor' });
    }
  }

  /**
   * Eliminar artículo permanentemente (solo admin)
   */
  async deleteArticulo(req, res) {
    const client = await pool.connect();
    try {
      const { id } = req.params;
      
      console.log(`🔥 ELIMINACIÓN PERMANENTE de artículo ID: ${id}`);
      
      // Verificar que el ID sea válido
      const articuloId = parseInt(id);
      if (isNaN(articuloId)) {
        return res.status(400).json({ 
          success: false, 
          error: 'ID de artículo inválido' 
        });
      }
      
      await client.query('BEGIN');
      
      // Verificar si el artículo existe
      const articuloCheck = await client.query(
        'SELECT * FROM articulos WHERE id = $1',
        [articuloId]
      );
      
      if (articuloCheck.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ 
          success: false, 
          error: 'Artículo no encontrado' 
        });
      }
      
      const articulo = articuloCheck.rows[0];
      
      // Verificar si hay documentos usando este artículo
      const docsCount = await client.query(
        `SELECT COUNT(*) FROM documentos 
         WHERE clasificacion_articulo = $1 AND eliminado = false`,
        [articulo.nombre]
      );
      
      const totalDocumentos = parseInt(docsCount.rows[0].count);
      
      if (totalDocumentos > 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          error: 'No se puede eliminar el artículo porque tiene documentos asociados',
          documentos: totalDocumentos,
          message: `El artículo tiene ${totalDocumentos} documento(s). Debes reasignarlos o eliminarlos primero.`
        });
      }
      
      // 1. Eliminar configuraciones de períodos
      await client.query(
        'DELETE FROM configuracion_periodos WHERE articulo_id = $1',
        [articuloId]
      );
      console.log(`   ✅ Eliminadas configuraciones de períodos`);
      
      // 2. Eliminar permisos de departamentos
      await client.query(
        'DELETE FROM departamento_articulos WHERE articulo_id = $1',
        [articuloId]
      );
      console.log(`   ✅ Eliminados permisos de departamentos`);
      
      // 3. Eliminar historial de asignaciones
      await client.query(
        'DELETE FROM historial_articulos_asignaciones WHERE articulo_id = $1',
        [articuloId]
      );
      console.log(`   ✅ Eliminado historial de asignaciones`);
      
      // 4. Finalmente, eliminar el artículo
      const result = await client.query(
        'DELETE FROM articulos WHERE id = $1 RETURNING *',
        [articuloId]
      );
      
      await client.query('COMMIT');
      
      console.log(`✅✅✅ ARTÍCULO ELIMINADO PERMANENTEMENTE:`, result.rows[0]);
      
      res.json({
        success: true,
        message: `Artículo "${articulo.nombre}" eliminado permanentemente`,
        articulo: result.rows[0]
      });
      
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('❌ Error eliminando artículo permanentemente:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Error del servidor al eliminar artículo',
        details: error.message
      });
    } finally {
      client.release();
    }
  }

  // ==================== CRUD DE ARTÍCULOS (admin) ====================

  /**
   * Crear artículo (admin)
   */
  async createArticulo(req, res) {
    try {
      const { nombre, descripcion, orden } = req.body;
      
      const result = await pool.query(
        `INSERT INTO articulos (nombre, descripcion, orden)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [nombre.toUpperCase(), descripcion, orden || 0]
      );
      
      res.json({
        success: true,
        message: 'Artículo creado',
        articulo: result.rows[0]
      });
      
    } catch (error) {
      if (error.code === '23505') {
        return res.status(400).json({ success: false, error: 'El nombre del artículo ya existe' });
      }
      console.error('Error creando artículo:', error);
      res.status(500).json({ success: false, error: 'Error del servidor' });
    }
  }

  /**
   * Actualizar artículo (admin)
   */
  async updateArticulo(req, res) {
    try {
      const { id } = req.params;
      const { nombre, descripcion, orden, activo } = req.body;
      
      const result = await pool.query(
        `UPDATE articulos 
         SET nombre = COALESCE($1, nombre),
             descripcion = COALESCE($2, descripcion),
             orden = COALESCE($3, orden),
             activo = COALESCE($4, activo),
             fecha_actualizacion = CURRENT_TIMESTAMP
         WHERE id = $5
         RETURNING *`,
        [nombre ? nombre.toUpperCase() : null, descripcion, orden, activo, id]
      );
      
      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Artículo no encontrado' });
      }
      
      res.json({
        success: true,
        message: 'Artículo actualizado',
        articulo: result.rows[0]
      });
      
    } catch (error) {
      if (error.code === '23505') {
        return res.status(400).json({ success: false, error: 'El nombre del artículo ya existe' });
      }
      console.error('Error actualizando artículo:', error);
      res.status(500).json({ success: false, error: 'Error del servidor' });
    }
  }

  /**
   * Cambiar estado de artículo (admin)
   */
  async toggleArticuloStatus(req, res) {
    try {
      const { id } = req.params;
      const { activo } = req.body;
      
      const result = await pool.query(
        `UPDATE articulos 
         SET activo = $1, fecha_actualizacion = CURRENT_TIMESTAMP
         WHERE id = $2
         RETURNING *`,
        [activo, id]
      );
      
      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Artículo no encontrado' });
      }
      
      res.json({
        success: true,
        message: `Artículo ${activo ? 'activado' : 'desactivado'}`,
        articulo: result.rows[0]
      });
      
    } catch (error) {
      console.error('Error cambiando estado:', error);
      res.status(500).json({ success: false, error: 'Error del servidor' });
    }
  }
}

module.exports = new ArticulosController();
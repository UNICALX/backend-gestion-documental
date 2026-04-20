// backend/src/controllers/tipoDocumentoController.js 
const { pool } = require('../config/database');

class TipoDocumentoController {
  async getTiposDocumento(req, res) {
    try {
      const { departamento_id } = req.query;
      
      let query = `
        SELECT td.*, d.nombre as departamento_nombre, d.codigo as departamento_codigo
        FROM tipos_documento td
        LEFT JOIN departamentos d ON td.departamento_id = d.id
        WHERE td.activo = true
      `;
      let params = [];
      
      if (departamento_id) {
        query += ' AND td.departamento_id = $1';
        params.push(departamento_id);
      }
      
      query += ' ORDER BY td.nombre';
      
      const result = await pool.query(query, params);
      
      res.json({
        success: true,
        data: result.rows,
        total: result.rows.length
      });
      
    } catch (error) {
      console.error('Error obteniendo tipos de documento:', error);
      res.status(500).json({
        success: false,
        error: 'Error interno del servidor'
      });
    }
  }

  async getTiposDocumentoPorDepartamento(req, res) {
    try {
      const { departamento_id } = req.params;
      
      const result = await pool.query(
        `SELECT td.* FROM tipos_documento td
         WHERE td.departamento_id = $1 AND td.activo = true
         ORDER BY td.nombre`,
        [departamento_id]
      );
      
      res.json({
        success: true,
        data: result.rows
      });
      
    } catch (error) {
      console.error('Error obteniendo tipos de documento por departamento:', error);
      res.status(500).json({
        success: false,
        error: 'Error interno del servidor'
      });
    }
  }

  async createTipoDocumento(req, res) {
    try {
      const { nombre, codigo, descripcion, departamento_id, extensiones_permitidas, tamaño_maximo_mb } = req.body;
      
      if (!nombre || !codigo) {
        return res.status(400).json({
          success: false,
          error: 'Nombre y código son requeridos'
        });
      }
      
      // Verificar que el código no exista
      const existeCodigo = await pool.query(
        'SELECT id FROM tipos_documento WHERE codigo = $1',
        [codigo]
      );
      
      if (existeCodigo.rows.length > 0) {
        return res.status(400).json({
          success: false,
          error: 'El código ya existe'
        });
      }
      
      const result = await pool.query(
        `INSERT INTO tipos_documento 
         (nombre, codigo, descripcion, departamento_id, extensiones_permitidas, tamaño_maximo_mb)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [
          nombre,
          codigo,
          descripcion || '',
          departamento_id || null,
          extensiones_permitidas || ['pdf', 'doc', 'docx', 'xls', 'xlsx'],
          tamaño_maximo_mb || 50
        ]
      );
      
      res.status(201).json({
        success: true,
        message: 'Tipo de documento creado exitosamente',
        data: result.rows[0]
      });
      
    } catch (error) {
      console.error('Error creando tipo de documento:', error);
      res.status(500).json({
        success: false,
        error: 'Error interno del servidor'
      });
    }
  }

  async updateTipoDocumento(req, res) {
    try {
      const { id } = req.params;
      const { nombre, descripcion, activo, extensiones_permitidas, tamaño_maximo_mb } = req.body;
      
      const result = await pool.query(
        `UPDATE tipos_documento 
         SET nombre = COALESCE($1, nombre),
             descripcion = COALESCE($2, descripcion),
             activo = COALESCE($3, activo),
             extensiones_permitidas = COALESCE($4, extensiones_permitidas),
             tamaño_maximo_mb = COALESCE($5, tamaño_maximo_mb),
             fecha_actualizacion = CURRENT_TIMESTAMP
         WHERE id = $6
         RETURNING *`,
        [nombre, descripcion, activo, extensiones_permitidas, tamaño_maximo_mb, id]
      );
      
      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Tipo de documento no encontrado'
        });
      }
      
      res.json({
        success: true,
        message: 'Tipo de documento actualizado exitosamente',
        data: result.rows[0]
      });
      
    } catch (error) {
      console.error('Error actualizando tipo de documento:', error);
      res.status(500).json({
        success: false,
        error: 'Error interno del servidor'
      });
    }
  }

  async deleteTipoDocumento(req, res) {
    try {
      const { id } = req.params;
      
      // Verificar si hay documentos usando este tipo
      const documentosResult = await pool.query(
        'SELECT COUNT(*) as total FROM documentos WHERE tipo_documento_id = $1 AND eliminado = false',
        [id]
      );
      
      const totalDocumentos = parseInt(documentosResult.rows[0].total);
      
      if (totalDocumentos > 0) {
        return res.status(400).json({
          success: false,
          error: `No se puede eliminar. Existen ${totalDocumentos} documentos asociados a este tipo.`
        });
      }
      
      const result = await pool.query(
        'DELETE FROM tipos_documento WHERE id = $1 RETURNING *',
        [id]
      );
      
      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Tipo de documento no encontrado'
        });
      }
      
      res.json({
        success: true,
        message: 'Tipo de documento eliminado exitosamente'
      });
      
    } catch (error) {
      console.error('Error eliminando tipo de documento:', error);
      res.status(500).json({
        success: false,
        error: 'Error interno del servidor'
      });
    }
  }
}

module.exports = new TipoDocumentoController();
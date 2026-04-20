const { pool } = require('../config/database');

class CatalogoController {
  async getCategorias(req, res) {
    try {
      const { departamento_id } = req.query;
      let query = 'SELECT id, nombre, codigo, descripcion FROM categorias_documento WHERE activo = true';
      let params = [];
      
      if (departamento_id) {
        query += ' AND (departamento_id = $1 OR departamento_id IS NULL)';
        params.push(departamento_id);
      }
      
      query += ' ORDER BY nombre';
      
      const result = await pool.query(query, params);
      res.json(result.rows);
    } catch (error) {
      console.error('Error obteniendo categorías:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  }

  async getDocumentosByCategoria(req, res) {
    try {
      const { id } = req.params;
      const { page = 1, limit = 20, search = '' } = req.query;
      
      const offset = (parseInt(page) - 1) * parseInt(limit);
      
      let query = `
        SELECT d.*, dc.fecha_asignacion 
        FROM documentos d
        INNER JOIN documentos_categorias dc ON d.id = dc.documento_id
        WHERE dc.categoria_id = $1 AND d.eliminado = false
      `;
      
      let params = [id];
      let paramCount = 1;
      
      if (search) {
        paramCount++;
        query += ` AND (d.titulo ILIKE $${paramCount} OR d.descripcion ILIKE $${paramCount})`;
        params.push(`%${search}%`);
      }
      
      // Contar total
      const countQuery = query.replace('SELECT d.*, dc.fecha_asignacion', 'SELECT COUNT(*) as total');
      const countResult = await pool.query(countQuery, params);
      const total = parseInt(countResult.rows[0].total);
      
      // Obtener documentos
      query += ` ORDER BY dc.fecha_asignacion DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
      params.push(parseInt(limit), offset);
      
      const result = await pool.query(query, params);
      
      res.json({
        documentos: result.rows,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: total,
          pages: Math.ceil(total / parseInt(limit))
        }
      });
      
    } catch (error) {
      console.error('Error obteniendo documentos por categoria:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  }
}

module.exports = new CatalogoController();
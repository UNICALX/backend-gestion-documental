const { pool } = require('../config/database');

class DepartamentoController {
  async getDepartamentos(req, res) {
    try {
      const result = await pool.query(
        'SELECT id, nombre, codigo, descripcion FROM departamentos WHERE activo = true ORDER BY nombre'
      );
      res.json(result.rows);
    } catch (error) {
      console.error('Error obteniendo departamentos:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  }

  async getTiposDocumento(req, res) {
    try {
      const result = await pool.query(
        `SELECT id, nombre, codigo, descripcion, extensiones_permitidas 
         FROM tipos_documento 
         WHERE (departamento_id = $1 OR departamento_id IS NULL) AND activo = true 
         ORDER BY nombre`,
        [req.user.departamento_id]
      );
      res.json(result.rows);
    } catch (error) {
      console.error('Error obteniendo tipos de documento:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  }

  async getEstadisticasDepartamento(req, res) {
    try {
      const deptId = req.user.departamento_id;
      
      const [
        documentosResult,
        espacioResult,
        departamentoResult
      ] = await Promise.all([
        pool.query(
          `SELECT COUNT(*) as total, COALESCE(SUM(tamaño_archivo), 0) as espacio_utilizado 
           FROM documentos 
           WHERE departamento_id = $1 AND eliminado = false`,
          [deptId]
        ),
        pool.query(
          'SELECT usado_bytes, limite_bytes FROM espacio_almacenamiento WHERE departamento_id = $1',
          [deptId]
        ),
        pool.query(
          'SELECT nombre, codigo FROM departamentos WHERE id = $1',
          [deptId]
        )
      ]);
      
      const totalDocumentos = parseInt(documentosResult.rows[0]?.total || 0);
      const espacioUtilizado = parseInt(documentosResult.rows[0]?.espacio_utilizado || 0);
      const espacioUsado = parseInt(espacioResult.rows[0]?.usado_bytes || 0);
      const espacioLimite = parseInt(espacioResult.rows[0]?.limite_bytes || 5368709120);
      const porcentajeUso = espacioLimite > 0 ? (espacioUsado / espacioLimite * 100) : 0;
      
      res.json({
        departamento: departamentoResult.rows[0]?.nombre || '',
        codigo_departamento: departamentoResult.rows[0]?.codigo || '',
        total_documentos: totalDocumentos,
        espacio_utilizado_bytes: espacioUtilizado,
        espacio_usado_bytes: espacioUsado,
        espacio_limite_bytes: espacioLimite,
        porcentaje_uso: parseFloat(porcentajeUso.toFixed(2))
      });
      
    } catch (error) {
      console.error('Error obteniendo estadísticas:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  }
}

module.exports = new DepartamentoController();
// backend/src/routes/publicRoutes.js
const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');

// Endpoint público para obtener documentos (sin autenticación)
router.get('/documentos', async (req, res) => {
  try {
    const { limite = 10, departamento } = req.query;
    
    console.log(`📋 Endpoint público: Obteniendo ${limite} documentos`);
    
    let query = `
      SELECT 
        d.id,
        d.titulo,
        d.descripcion,
        d.fecha_creacion,
        d.tamaño_archivo,
        d.extension,
        dep.nombre as departamento,
        u.nombre_completo as subido_por
      FROM documentos d
      LEFT JOIN departamentos dep ON d.departamento_id = dep.id
      LEFT JOIN usuarios u ON d.subido_por = u.id
      WHERE d.eliminado = false
        AND d.archivado = false
    `;
    
    const params = [];
    let paramCount = 0;
    
    if (departamento) {
      paramCount++;
      query += ` AND d.departamento_id = $${paramCount}`;
      params.push(parseInt(departamento));
    }
    
    paramCount++;
    query += ` ORDER BY d.fecha_creacion DESC LIMIT $${paramCount}`;
    params.push(parseInt(limite));
    
    const result = await pool.query(query, params);
    
    console.log(`✅ Endpoint público: ${result.rows.length} documentos encontrados`);
    
    res.json({
      success: true,
      documentos: result.rows,
      total: result.rows.length
    });
    
  } catch (error) {
    console.error('❌ Error en endpoint público:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Error al obtener documentos',
      message: error.message
    });
  }
});

// Endpoint para descargar documento (público)
router.get('/documentos/descargar/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    console.log(`📥 Endpoint público: Descargando documento ID: ${id}`);
    
    const result = await pool.query(
      `SELECT d.id, d.titulo, d.ruta_archivo, d.nombre_archivo_original, d.extension
       FROM documentos d
       WHERE d.id = $1 AND d.eliminado = false`,
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Documento no encontrado' });
    }
    
    const documento = result.rows[0];
    
    res.json({
      success: true,
      documento: {
        id: documento.id,
        titulo: documento.titulo,
        nombre_original: documento.nombre_archivo_original,
        extension: documento.extension,
        ruta: documento.ruta_archivo
      }
    });
    
  } catch (error) {
    console.error('❌ Error en descarga pública:', error);
    res.status(500).json({ error: 'Error al obtener documento' });
  }
});

// Endpoint público para obtener estadísticas
router.get('/estadisticas', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        COUNT(*) as total_documentos,
        COUNT(DISTINCT departamento_id) as departamentos_con_documentos
      FROM documentos
      WHERE eliminado = false AND archivado = false
    `);
    
    res.json({
      success: true,
      estadisticas: result.rows[0]
    });
    
  } catch (error) {
    console.error('❌ Error en estadísticas públicas:', error);
    res.status(500).json({ error: 'Error al obtener estadísticas' });
  }
});

module.exports = router;
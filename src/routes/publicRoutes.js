// backend/src/routes/publicRoutes.js
const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');

// Endpoint público para obtener documentos
router.get('/documentos', async (req, res) => {
  try {
    const { limite = 100 } = req.query;
    
    const query = `
      SELECT 
        d.id,
        d.titulo,
        d.descripcion,
        d.fecha_creacion,
        d.tamaño_archivo,
        d.extension,
        d.clasificacion_articulo as articulo,
        d.clasificacion_fraccion as fraccion,
        d.clasificacion_anio as anio,
        d.clasificacion_periodo as periodo,
        dep.nombre as departamento,
        u.nombre_completo as subido_por
      FROM documentos d
      LEFT JOIN departamentos dep ON d.departamento_id = dep.id
      LEFT JOIN usuarios u ON d.subido_por = u.id
      WHERE d.eliminado = false
      ORDER BY d.fecha_creacion DESC
      LIMIT $1
    `;
    
    const result = await pool.query(query, [parseInt(limite)]);
    
    res.json({
      success: true,
      documentos: result.rows,
      total: result.rows.length
    });
    
  } catch (error) {
    console.error('Error:', error);
    res.json({ success: false, documentos: [], error: error.message });
  }
});

// Endpoint para descargar documento
router.get('/documentos/descargar/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query(
      `SELECT id, titulo, ruta_archivo, nombre_archivo_original 
       FROM documentos 
       WHERE id = $1 AND eliminado = false`,
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Documento no encontrado' });
    }
    
    res.json({
      success: true,
      documento: result.rows[0]
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Endpoint health check
router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

module.exports = router;
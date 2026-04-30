// backend/src/routes/publicRoutes.js
const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');

// Endpoint público para obtener documentos ORGANIZADOS
router.get('/documentos', async (req, res) => {
  try {
    const { limite = 100, departamento } = req.query;
    
    console.log(`📋 Endpoint público: Obteniendo documentos organizados`);
    
    let query = `
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
        dep.codigo as departamento_codigo,
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
    
    query += ` ORDER BY 
                CAST(REGEXP_REPLACE(d.clasificacion_articulo, '[^0-9]', '', 'g') AS INTEGER) NULLS LAST,
                d.clasificacion_articulo,
                CAST(REGEXP_REPLACE(d.clasificacion_fraccion, '[^0-9]', '', 'g') AS INTEGER) NULLS LAST,
                d.clasificacion_fraccion,
                d.clasificacion_anio DESC NULLS LAST,
                d.clasificacion_periodo NULLS LAST`;
    
    if (limite) {
      paramCount++;
      query += ` LIMIT $${paramCount}`;
      params.push(parseInt(limite));
    }
    
    const result = await pool.query(query, params);
    
    // Organizar documentos por jerarquía
    const organizados = organizarDocumentosPorJerarquia(result.rows);
    
    console.log(`✅ Endpoint público: ${result.rows.length} documentos encontrados`);
    
    res.json({
      success: true,
      documentos: result.rows,
      organizados: organizados,
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

// Función para organizar documentos por jerarquía
function organizarDocumentosPorJerarquia(documentos) {
  const estructura = {};
  
  documentos.forEach(doc => {
    const articulo = doc.articulo || 'Sin artículo';
    const fraccion = doc.fraccion || 'Sin fracción';
    const anio = doc.anio || 'Sin año';
    const periodo = doc.periodo || 'Sin período';
    
    if (!estructura[articulo]) {
      estructura[articulo] = {};
    }
    if (!estructura[articulo][fraccion]) {
      estructura[articulo][fraccion] = {};
    }
    if (!estructura[articulo][fraccion][anio]) {
      estructura[articulo][fraccion][anio] = {};
    }
    if (!estructura[articulo][fraccion][anio][periodo]) {
      estructura[articulo][fraccion][anio][periodo] = [];
    }
    
    estructura[articulo][fraccion][anio][periodo].push(doc);
  });
  
  return estructura;
}

// Endpoint para obtener jerarquía completa
router.get('/jerarquia', async (req, res) => {
  try {
    const query = `
      SELECT DISTINCT
        d.clasificacion_articulo as articulo,
        d.clasificacion_fraccion as fraccion,
        d.clasificacion_anio as anio,
        d.clasificacion_periodo as periodo,
        COUNT(*) as total_documentos
      FROM documentos d
      WHERE d.eliminado = false
        AND d.archivado = false
        AND d.clasificacion_articulo IS NOT NULL
      GROUP BY 
        d.clasificacion_articulo,
        d.clasificacion_fraccion,
        d.clasificacion_anio,
        d.clasificacion_periodo
      ORDER BY 
        CAST(REGEXP_REPLACE(d.clasificacion_articulo, '[^0-9]', '', 'g') AS INTEGER) NULLS LAST,
        d.clasificacion_articulo,
        CAST(REGEXP_REPLACE(d.clasificacion_fraccion, '[^0-9]', '', 'g') AS INTEGER) NULLS LAST,
        d.clasificacion_fraccion,
        d.clasificacion_anio DESC NULLS LAST
    `;
    
    const result = await pool.query(query);
    
    res.json({
      success: true,
      jerarquia: result.rows
    });
    
  } catch (error) {
    console.error('❌ Error:', error);
    res.status(500).json({ error: 'Error al obtener jerarquía' });
  }
});

// Endpoint para documentos por ruta
router.get('/documentos/ruta/:articulo/:fraccion/:anio?/:periodo?', async (req, res) => {
  try {
    const { articulo, fraccion, anio, periodo } = req.params;
    
    let query = `
      SELECT 
        d.id,
        d.titulo,
        d.descripcion,
        d.fecha_creacion,
        d.tamaño_archivo,
        d.extension,
        dep.nombre as departamento
      FROM documentos d
      LEFT JOIN departamentos dep ON d.departamento_id = dep.id
      WHERE d.eliminado = false
        AND d.clasificacion_articulo = $1
        AND d.clasificacion_fraccion = $2
    `;
    
    const params = [articulo, fraccion];
    let paramCount = 2;
    
    if (anio && anio !== 'undefined') {
      paramCount++;
      query += ` AND d.clasificacion_anio = $${paramCount}`;
      params.push(anio);
    }
    
    if (periodo && periodo !== 'undefined') {
      paramCount++;
      query += ` AND d.clasificacion_periodo = $${paramCount}`;
      params.push(periodo);
    }
    
    query += ` ORDER BY d.fecha_creacion DESC`;
    
    const result = await pool.query(query, params);
    
    res.json({
      success: true,
      documentos: result.rows,
      ruta: { articulo, fraccion, anio, periodo }
    });
    
  } catch (error) {
    console.error('❌ Error:', error);
    res.status(500).json({ error: 'Error al obtener documentos por ruta' });
  }
});

module.exports = router;
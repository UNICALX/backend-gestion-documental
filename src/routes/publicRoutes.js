// backend/src/routes/publicRoutes.js
const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const fs = require('fs');
const path = require('path');
const ftpService = require('../services/ftpService');

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
    console.error('Error en /documentos:', error);
    res.json({ success: false, documentos: [], error: error.message });
  }
});

// 🔥 ENDPOINT PÚBLICO PARA DESCARGAR DOCUMENTO (SIN AUTENTICACIÓN)
router.get('/download/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    console.log(`📥 Descarga pública solicitada para documento ID: ${id}`);
    
    // Obtener información del documento
    const result = await pool.query(
      `SELECT d.*, dep.nombre as departamento_nombre 
       FROM documentos d
       LEFT JOIN departamentos dep ON d.departamento_id = dep.id
       WHERE d.id = $1 AND d.eliminado = false`,
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: 'Documento no encontrado o está eliminado' 
      });
    }
    
    const documento = result.rows[0];
    
    // Determinar extensión
    let extension = documento.extension;
    if (!extension || extension === '') {
      const extMatch = documento.nombre_archivo_original?.match(/\.([^.]+)$/);
      extension = extMatch ? extMatch[1] : 'pdf';
    }
    
    // Generar nombre de archivo para descarga
    let nombreBase = (documento.titulo || 'documento')
      .trim()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9\s\-_]/g, '')
      .replace(/\s+/g, '_')
      .substring(0, 200);
    
    const nombreArchivoDescarga = `${nombreBase}.${extension}`;
    console.log(`📄 Nombre de descarga: ${nombreArchivoDescarga}`);
    
    // Crear directorio temporal
    const tempDir = path.join(__dirname, '../temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    const tempFilePath = path.join(tempDir, `${Date.now()}_${documento.nombre_archivo_sistema || documento.id}`);
    
    try {
      // Descargar archivo del FTP
      console.log(`📂 Descargando desde FTP: ${documento.ruta_archivo}`);
      await ftpService.downloadFile(documento.ruta_archivo, tempFilePath);
      
      // Configurar headers para forzar descarga
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(nombreArchivoDescarga)}"`);
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Access-Control-Allow-Origin', '*');
      
      // Enviar archivo
      const fileStream = fs.createReadStream(tempFilePath);
      fileStream.pipe(res);
      
      fileStream.on('end', () => {
        // Limpiar archivo temporal
        if (fs.existsSync(tempFilePath)) {
          fs.unlinkSync(tempFilePath);
          console.log(`🗑️ Archivo temporal eliminado: ${tempFilePath}`);
        }
        console.log(`✅ Descarga pública completada: ${nombreArchivoDescarga}`);
      });
      
      fileStream.on('error', (err) => {
        console.error('❌ Error en stream:', err);
        if (fs.existsSync(tempFilePath)) {
          fs.unlinkSync(tempFilePath);
        }
        if (!res.headersSent) {
          res.status(500).json({ error: 'Error al enviar el archivo' });
        }
      });
      
    } catch (ftpError) {
      console.error('❌ Error descargando del FTP:', ftpError);
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
      res.status(500).json({ 
        success: false, 
        error: 'Error al descargar el archivo del servidor',
        details: ftpError.message
      });
    }
    
  } catch (error) {
    console.error('❌ Error en descarga pública:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Error interno del servidor',
      details: error.message
    });
  }
});

// Endpoint para obtener información del documento (sin descargar)
router.get('/info/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query(
      `SELECT d.id, d.titulo, d.descripcion, d.fecha_creacion, d.tamaño_archivo, d.extension,
              d.clasificacion_articulo, d.clasificacion_fraccion, d.clasificacion_anio, d.clasificacion_periodo,
              dep.nombre as departamento
       FROM documentos d
       LEFT JOIN departamentos dep ON d.departamento_id = dep.id
       WHERE d.id = $1 AND d.eliminado = false`,
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
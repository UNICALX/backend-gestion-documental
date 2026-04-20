// src/routes/documentRoutes.js
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middlewares/auth');
const documentController = require('../controllers/documentController');
const upload = require('../utils/fileUpload');

// ========== MIDDLEWARE DE LOGGING ==========
router.use((req, res, next) => {
  console.log(`📄 [ROUTE] ${req.method} ${req.path}`);
  next();
});

// ========== RUTAS CON AUTENTICACIÓN ==========

/**
 * @route   POST /api/documentos/upload
 * @desc    Subir un nuevo documento
 * @access  Privado (Jefe o Admin)
 */
router.post('/upload',
  authenticate,
  upload.single('archivo'),
  documentController.uploadDocument
);

/**
 * @route   POST /api/documentos/reemplazar-archivo
 * @desc    Reemplazar archivo de documento existente
 * @access  Privado (Propietario, Jefe o Admin)
 */
router.post('/reemplazar-archivo',
  authenticate,
  upload.single('archivo'),
  async (req, res, next) => {
    try {
      const { documento_id } = req.body;
      
      if (!documento_id) {
        // Limpiar archivo temporal si existe
        if (req.file && req.file.path) {
          const fs = require('fs');
          fs.unlinkSync(req.file.path);
        }
        
        return res.status(400).json({
          success: false,
          error: 'documento_id es requerido'
        });
      }
      
      // Redirigir al método updateDocument con el ID del documento
      req.params.id = documento_id;
      
      // Llamar al controller
      return documentController.updateDocument(req, res, next);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @route   GET /api/documentos
 * @desc    Obtener documentos con filtros
 * @access  Privado
 */
router.get('/',
  authenticate,
  documentController.getDocuments
);

/**
 * @route   GET /api/documentos/papelera
 * @desc    Obtener documentos en papelera
 * @access  Privado
 */
router.get('/papelera',
  authenticate,
  documentController.getPapelera
);

/**
 * @route   GET /api/documentos/estadisticas
 * @desc    Obtener estadísticas de documentos
 * @access  Privado
 */
router.get('/estadisticas',
  authenticate,
  documentController.getDocumentStats
);

/**
 * @route   GET /api/documentos/todos
 * @desc    Obtener TODOS los documentos (para catálogo)
 * @access  Privado
 */
router.get('/todos',
  authenticate,
  documentController.getAllDocuments
);

/**
 * @route   GET /api/documentos/articulos-disponibles
 * @desc    Obtener artículos únicos disponibles en documentos
 * @access  Privado
 */
router.get('/articulos-disponibles',
  authenticate,
  documentController.getArticulosDisponibles
);

/**
 * @route   GET /api/documentos/:id
 * @desc    Obtener documento por ID
 * @access  Privado
 */
router.get('/:id',
  authenticate,
  documentController.getDocumentById
);

/**
 * @route   GET /api/documentos/download/:id
 * @desc    Descargar documento
 * @access  Privado
 */
router.get('/download/:id',
  authenticate,
  documentController.downloadDocument
);

/**
 * @route   PUT /api/documentos/:id
 * @desc    Actualizar documento (metadatos)
 * @access  Privado (Propietario, Jefe o Admin)
 */
router.put('/:id',
  authenticate,
  documentController.updateDocument
);

/**
 * @route   PUT /api/documentos/:id/archivo
 * @desc    Reemplazar archivo
 * @access  Privado (Propietario, Jefe o Admin)
 */
router.put('/:id/archivo',
  authenticate,
  upload.single('archivo'),
  documentController.updateDocument
);

/**
 * @route   POST /api/documentos/transferir/:id
 * @desc    Transferir documento a otro departamento
 * @access  Privado (Jefe o Admin)
 */
router.post('/transferir/:id',
  authenticate,
  documentController.transferDocument
);

/**
 * @route   DELETE /api/documentos/:id
 * @desc    Eliminar documento (lógica o física)
 * @access  Privado (Propietario, Jefe o Admin)
 */
router.delete('/:id',
  authenticate,
  documentController.deleteDocument
);

/**
 * @route   POST /api/documentos/:id/restaurar
 * @desc    Restaurar documento de la papelera
 * @access  Privado (Jefe o Admin)
 */
router.post('/:id/restaurar',
  authenticate,
  documentController.restoreDocument
);

/**
 * @route   GET /api/documentos/:documento_id/categorias
 * @desc    Obtener categorías de un documento
 * @access  Privado
 */
router.get('/:documento_id/categorias',
  authenticate,
  documentController.getCategoriasDocumento
);

// ========== RUTA DE SALUD ==========
/**
 * @route   GET /api/documentos/health
 * @desc    Verificar estado del servicio de documentos
 * @access  Público
 */
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'document-service',
    timestamp: new Date().toISOString(),
    endpoints: [
      'POST /upload',
      'POST /reemplazar-archivo',
      'GET /',
      'GET /papelera',
      'GET /estadisticas',
      'GET /todos',
      'GET /articulos-disponibles',
      'GET /:id',
      'GET /download/:id',
      'PUT /:id',
      'PUT /:id/archivo',
      'POST /transferir/:id',
      'DELETE /:id',
      'POST /:id/restaurar',
      'GET /:documento_id/categorias',
      'GET /health'
    ]
  });
});

// ========== MANEJO DE ERRORES 404 ==========
router.use((req, res) => {
  console.error(`❌ [ROUTE] Ruta no encontrada: ${req.method} ${req.originalUrl}`);
  res.status(404).json({
    success: false,
    error: 'Ruta no encontrada',
    path: req.originalUrl,
    method: req.method,
    availableRoutes: [
      'POST /upload',
      'POST /reemplazar-archivo',
      'GET /',
      'GET /papelera',
      'GET /estadisticas',
      'GET /todos',
      'GET /articulos-disponibles',
      'GET /:id',
      'GET /download/:id',
      'PUT /:id',
      'PUT /:id/archivo',
      'POST /transferir/:id',
      'DELETE /:id',
      'POST /:id/restaurar',
      'GET /:documento_id/categorias',
      'GET /health'
    ]
  });
});

// ========== MANEJADOR DE ERRORES GLOBAL ==========
router.use((err, req, res, next) => {
  console.error(`❌ [ROUTE] Error en ruta ${req.method} ${req.path}:`, err);
  
  // Error de Multer (subida de archivos)
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({
      success: false,
      error: 'Archivo demasiado grande',
      maxSize: '50MB',
      code: 'FILE_TOO_LARGE'
    });
  }
  
  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    return res.status(400).json({
      success: false,
      error: 'Demasiados archivos o campo incorrecto',
      expected: 'archivo',
      code: 'UNEXPECTED_FILE'
    });
  }
  
  // Error de tipo de archivo no permitido
  if (err.message && err.message.includes('Tipo de archivo no permitido')) {
    return res.status(400).json({
      success: false,
      error: err.message,
      allowedExtensions: ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.jpg', '.jpeg', '.png'],
      allowedMimeTypes: [
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'image/jpeg',
        'image/png'
      ],
      code: 'INVALID_FILE_TYPE'
    });
  }
  
  // Error de validación de multer
  if (err.message && err.message.includes('Multer error')) {
    return res.status(400).json({
      success: false,
      error: 'Error en la subida del archivo',
      details: err.message,
      code: 'MULTER_ERROR'
    });
  }
  
  // Error de FTP
  if (err.message && err.message.includes('FTP')) {
    return res.status(503).json({
      success: false,
      error: 'Error en el servidor de archivos',
      details: err.message,
      code: 'FTP_ERROR'
    });
  }
  
  // Error de base de datos
  if (err.code && (err.code.startsWith('22') || err.code?.startsWith('23'))) {
    console.error('🛑 Error de base de datos:', err);
    return res.status(500).json({
      success: false,
      error: 'Error en la base de datos',
      code: 'DATABASE_ERROR',
      ...(process.env.NODE_ENV === 'development' && { detail: err.detail })
    });
  }
  
  // Error de validación de datos
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      error: 'Error de validación',
      details: err.message,
      code: 'VALIDATION_ERROR'
    });
  }
  
  // Error de autenticación (si no fue capturado antes)
  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      error: 'Error de autenticación',
      details: err.message,
      code: err.name
    });
  }
  
  // Error de permisos
  if (err.status === 403 || (err.message && err.message.includes('permisos'))) {
    return res.status(403).json({
      success: false,
      error: err.message || 'No tienes permisos para realizar esta acción',
      code: 'FORBIDDEN'
    });
  }
  
  // Error general
  const statusCode = err.status || 500;
  const errorMessage = err.message || 'Error interno del servidor';
  
  console.error('🔥 Error no manejado:', {
    status: statusCode,
    message: errorMessage,
    stack: err.stack,
    path: req.path,
    method: req.method,
    user: req.user?.id,
    body: process.env.NODE_ENV === 'development' ? req.body : '[REDACTED]'
  });
  
  res.status(statusCode).json({
    success: false,
    error: errorMessage,
    code: err.code || 'INTERNAL_ERROR',
    ...(process.env.NODE_ENV === 'development' && {
      stack: err.stack,
      details: err.details || err
    }),
    timestamp: new Date().toISOString(),
    path: req.path
  });
});

module.exports = router;
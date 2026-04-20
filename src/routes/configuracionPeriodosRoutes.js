// routes/configuracionPeriodosRoutes.js
const express = require('express');
const router = express.Router();
const { authenticate, requireAdmin } = require('../middlewares/auth');
const configuracionPeriodosController = require('../controllers/configuracionPeriodosController');

// ==================== RUTAS PÚBLICAS (solo autenticación, no requireAdmin) ====================
// Estas rutas las usan los usuarios al subir documentos
// IMPORTANTE: Estas deben ir PRIMERO y NO usar requireAdmin

// 🔥 PRIMERO: Ruta pública para obtener configuración (la usan los usuarios al subir documentos)
router.get('/:articuloId/:fraccion', authenticate, configuracionPeriodosController.getConfiguracionPublica);

// Ruta pública explícita (por si acaso)
router.get('/publica/:articuloId/:fraccion', authenticate, configuracionPeriodosController.getConfiguracionPublica);

// ==================== RUTAS DE ADMIN (requieren admin) ====================
// Todas las rutas a partir de aquí requieren ser admin
router.use(authenticate);
router.use(requireAdmin);

// Obtener todas las configuraciones
router.get('/', configuracionPeriodosController.getAllConfiguraciones);

// Obtener configuraciones por artículo
router.get('/articulo/:articuloId', configuracionPeriodosController.getConfiguracionesPorArticulo);

// Guardar configuración (crear o actualizar)
router.post('/', configuracionPeriodosController.guardarConfiguracion);

// Eliminar configuración
router.delete('/:id', configuracionPeriodosController.eliminarConfiguracion);

// Duplicar configuración default a fracción específica
router.post('/duplicar-default', configuracionPeriodosController.duplicarConfigDefault);

module.exports = router;
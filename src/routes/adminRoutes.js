// src/routes/adminRoutes.js 
const express = require('express');
const router = express.Router();
const { authenticate, requireAdmin } = require('../middlewares/auth');
const adminController = require('../controllers/adminController');

// ==================== APLICAR MIDDLEWARES A TODAS LAS RUTAS ====================
router.use(authenticate, requireAdmin);

// ==================== RUTAS DE ESTADÍSTICAS ====================
router.get('/stats', adminController.getEstadisticas);
router.get('/estadisticas', adminController.getEstadisticas);
router.get('/estadisticas/documentos', adminController.getDocumentStats);

// ==================== RUTAS DE LOGS DE ACTIVIDAD ====================
router.get('/activity-logs', adminController.getActivityLogs);
router.get('/logs/actividad', adminController.getActivityLogs);

// ==================== RUTAS DE DOCUMENTOS ====================
router.get('/document-stats', adminController.getDocumentStats);
router.get('/documentos', adminController.getAllDocuments);
router.get('/documentos/:id/historial', adminController.getDocumentoHistorial);
router.get('/documentos/:id/historial-detallado', adminController.getDocumentHistory);

// ==================== RUTAS DE USUARIOS ====================
router.get('/usuarios', adminController.getUsuarios);
router.get('/usuarios/:id', adminController.getUsuarioById);
router.get('/usuarios/:id/historial', adminController.getUsuarioHistorial);
router.post('/usuarios', adminController.createUsuario);
router.put('/usuarios/:id', adminController.updateUsuario);
router.delete('/usuarios/:id', adminController.deleteUsuario);
router.put('/usuarios/:id/estado', adminController.toggleUsuarioEstado);
router.put('/usuarios/:id/contrasena', adminController.changeUserPassword);

// ==================== RUTAS DE DEPARTAMENTOS ====================
router.get('/departamentos', adminController.getDepartamentos);
router.get('/departamentos/:id', adminController.getDepartamentoById);
router.get('/departamentos/:id/historial', adminController.getDepartamentoHistorial);
router.post('/departamentos', adminController.createDepartamento);
router.put('/departamentos/:id', adminController.updateDepartamento);
router.delete('/departamentos/:id', adminController.deleteDepartamento);
// 🔥 SOPORTE PARA AMBOS MÉTODOS (PUT y PATCH)
router.put('/departamentos/:id/estado', adminController.toggleDepartamentoStatus);
router.patch('/departamentos/:id/estado', adminController.toggleDepartamentoStatus);

// ==================== RUTA DE DEPURACIÓN ====================
router.get('/debug/documentos/:id/historial', 
  authenticate, 
  requireAdmin, 
  adminController.debugHistorialDocumento
);

// ==================== RUTAS DE TRANSFERENCIAS ====================
router.post('/transferencia-masiva', adminController.transferenciaMasiva);

module.exports = router;
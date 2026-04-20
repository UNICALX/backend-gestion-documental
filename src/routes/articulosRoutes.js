// routes/articulosRoutes.js 
const express = require('express');
const router = express.Router();
const { authenticate, requireAdmin } = require('../middlewares/auth');
const articulosController = require('../controllers/articulosController');

// ==================== APLICAR MIDDLEWARES ====================
// Todas las rutas requieren autenticación
router.use(authenticate);

// ==================== RUTAS PÚBLICAS (cualquier usuario autenticado) ====================
// ESTAS VAN PRIMERO - son rutas específicas sin parámetros dinámicos

// Obtener todos los artículos
router.get('/', articulosController.getArticulos);

// 🔥 IMPORTANTE: Esta ruta DEBE ir antes de /:id
// Obtener todos los permisos (admin)
router.get('/permisos', requireAdmin, articulosController.getAllPermisos);

// Obtener permisos por departamento (cualquier usuario puede ver los de su depto)
router.get('/permisos/departamento/:departamentoId', articulosController.getPermisosPorDepartamento);

// Obtener estadísticas de artículos (admin)
router.get('/estadisticas', requireAdmin, articulosController.getEstadisticas);

// Obtener historial de asignaciones (admin)
router.get('/historial-asignaciones', requireAdmin, articulosController.getHistorialAsignaciones);

// Obtener artículos a los que un departamento tiene acceso
router.get('/departamento/:departamentoId', articulosController.getArticulosPorDepartamento);

// Verificar acceso a artículo
router.get('/verificar-acceso/:departamentoId/:articuloId', articulosController.verificarAcceso);
// routes/articulosRoutes.js - AGREGAR ESTA RUTA

// Eliminar artículo permanentemente (solo admin)
router.delete('/:id', requireAdmin, articulosController.deleteArticulo);
// ==================== RUTAS CON PARÁMETROS DE ARTÍCULO ====================
// Estas van después de todas las rutas específicas

// 🔥 NUEVA RUTA: Obtener fracciones por artículo (desde configuracion_periodos)
// IMPORTANTE: Esta ruta DEBE ir antes de /:id
router.get('/:articuloId/fracciones', articulosController.getFraccionesPorArticulo);

// 🔥 NUEVA RUTA: Obtener estadísticas por fracción
router.get('/:articuloId/estadisticas-fracciones', requireAdmin, articulosController.getEstadisticasPorFraccion);

// Obtener permisos por artículo (admin)
router.get('/:articuloId/permisos', requireAdmin, articulosController.getPermisosPorArticulo);

// Obtener departamentos disponibles para asignar (admin)
router.get('/:articuloId/departamentos-disponibles', requireAdmin, articulosController.getDepartamentosDisponibles);
// ==================== RUTAS CON PARÁMETROS EN URL ====================
// 🔥 NUEVA RUTA: Quitar permiso con path params
router.delete('/quitar/:departamentoId/:articuloId', requireAdmin, articulosController.quitarPermisoPorPath);
// 🔥 ÚLTIMA: Obtener artículo por ID (debe ir al final)
router.get('/:id', articulosController.getArticuloById);

// ==================== RUTAS POST, PUT, DELETE (solo admin) ====================

// Asignar permiso (admin)
router.post('/asignar', requireAdmin, articulosController.asignarPermiso);

// Asignar múltiples permisos (admin)
router.post('/asignar-multiples', requireAdmin, articulosController.asignarPermisosMultiples);

// Quitar permiso (admin)
router.delete('/quitar', requireAdmin, articulosController.quitarPermiso);

// Actualizar permiso por ID (admin)
router.put('/permisos/:id', requireAdmin, articulosController.actualizarPermiso);

// ==================== CRUD DE ARTÍCULOS (solo admin) ====================

// Crear artículo (admin)
router.post('/', requireAdmin, articulosController.createArticulo);

// Actualizar artículo (admin)
router.put('/:id', requireAdmin, articulosController.updateArticulo);

// Cambiar estado de artículo (admin)
router.patch('/:id/estado', requireAdmin, articulosController.toggleArticuloStatus);

module.exports = router;
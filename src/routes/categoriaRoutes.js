// backend/src/routes/categoriaRoutes.js
const express = require('express');
const router = express.Router();
const categoriaController = require('../controllers/categoriaController');
const { authenticate, requireAdmin } = require('../middlewares/auth');

// Todas las rutas requieren autenticación
router.use(authenticate);

// Rutas públicas (para jefes y usuarios normales)
router.get('/departamento/:departamentoId', categoriaController.obtenerCategoriasPorDepartamento);
// 🔥 NUEVA RUTA PARA CATÁLOGO
router.get('/todas', categoriaController.obtenerTodasCategorias);

// Rutas de administrador (a partir de aquí requieren admin)
router.use(requireAdmin);

// CRUD de categorías y gestion de
router.get('/', categoriaController.obtenerCategorias);
router.post('/', categoriaController.crearCategoria);
router.put('/:id', categoriaController.actualizarCategoria);

// Gestión de asignaciones
router.get('/disponibles/:departamentoId', categoriaController.obtenerCategoriasDisponibles);
router.post('/asignar', categoriaController.asignarCategoria);
router.post('/desasignar', categoriaController.desasignarCategoria);
router.post('/transferir', categoriaController.transferirCategoria);

// Consultas y reportes
router.get('/estadisticas', categoriaController.obtenerEstadisticasCategorias);
router.get('/historial', categoriaController.obtenerHistorialAsignaciones);

// Asignaciones específicas
router.get('/:id/asignaciones', categoriaController.obtenerAsignacionesCategoria);
router.get('/:categoriaId/departamentos', categoriaController.obtenerDepartamentosConCategoria);
router.get('/:categoriaId/verificar/:departamentoId', categoriaController.verificarAsignacionCategoria);

module.exports = router;
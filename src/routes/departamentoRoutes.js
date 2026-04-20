const express = require('express');
const router = express.Router();
const { authenticate } = require('../middlewares/auth');
const departamentoController = require('../controllers/departamentoController');

// Obtener departamentos
router.get('/', authenticate, departamentoController.getDepartamentos);

// Obtener tipos de documento por departamento
router.get('/tipos-documento', authenticate, departamentoController.getTiposDocumento);

// Obtener estadísticas del departamento
router.get('/estadisticas', authenticate, departamentoController.getEstadisticasDepartamento);

module.exports = router;
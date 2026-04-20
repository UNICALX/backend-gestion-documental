// backend/src/routes/tipoDocumentoRoutes.js
const express = require('express');
const router = express.Router();
const tipoDocumentoController = require('../controllers/tipoDocumentoController');
const { authenticate } = require('../middlewares/auth'); // Cambiado aquí

// Todas las rutas requieren autenticación
router.use(authenticate); // Ahora sí es una función

// GET /api/tipos-documento - Obtener todos los tipos de documento
router.get('/', tipoDocumentoController.getTiposDocumento);

// GET /api/tipos-documento/departamento/:departamento_id - Obtener por departamento
router.get('/departamento/:departamento_id', tipoDocumentoController.getTiposDocumentoPorDepartamento);

// POST /api/tipos-documento - Crear nuevo tipo de documento
router.post('/', tipoDocumentoController.createTipoDocumento);

// PUT /api/tipos-documento/:id - Actualizar tipo de documento
router.put('/:id', tipoDocumentoController.updateTipoDocumento);

// DELETE /api/tipos-documento/:id - Eliminar tipo de documento
router.delete('/:id', tipoDocumentoController.deleteTipoDocumento);

module.exports = router;
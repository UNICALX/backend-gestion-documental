const express = require('express');
const router = express.Router();
const { authenticate } = require('../middlewares/auth');
const catalogoController = require('../controllers/catalogoController');

// Obtener categorías
router.get('/categorias', authenticate, catalogoController.getCategorias);

// Obtener documentos por categoría
router.get('/categoria/:id/documentos', authenticate, catalogoController.getDocumentosByCategoria);

module.exports = router;
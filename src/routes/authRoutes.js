const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { authenticate } = require('../middlewares/auth');

// Login
router.post('/login', authController.login);

// Obtener perfil
router.get('/profile', authenticate, authController.getProfile);

module.exports = router;
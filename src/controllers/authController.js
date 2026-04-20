const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/database');

class AuthController {
  async login(req, res) {
    try {
      const { correo, contrasena } = req.body;
      
      console.log('🔐 Intento de login:', { correo });
      
      if (!correo || !contrasena) {
        return res.status(400).json({ 
          success: false,
          error: '❌ Correo y contraseña son requeridos' 
        });
      }
      
      // Buscar usuario
      const result = await pool.query(
        `SELECT u.*, d.nombre as departamento_nombre, d.codigo as departamento_codigo 
         FROM usuarios u 
         LEFT JOIN departamentos d ON u.departamento_id = d.id 
         WHERE u.correo = $1`,
        [correo.toLowerCase().trim()]
      );
      
      // 🔥 USUARIO NO ENCONTRADO
      if (result.rows.length === 0) {
        console.log('❌ Usuario no encontrado:', correo);
        return res.status(401).json({ 
          success: false,
          error: '❌ Credenciales incorrectas. Verifica tu correo y contraseña.'
        });
      }
      
      const usuario = result.rows[0];
      
      // 🔥 USUARIO INACTIVO
      if (!usuario.activo) {
        console.log('❌ Usuario inactivo:', correo);
        return res.status(401).json({ 
          success: false,
          error: '⚠️ Tu cuenta está desactivada. Contacta al administrador.'
        });
      }
      
      // 🔥 CONTRASEÑA INCORRECTA
      const passwordValid = await bcrypt.compare(contrasena, usuario.hash_contrasena);
      if (!passwordValid) {
        console.log('❌ Contraseña incorrecta para:', correo);
        return res.status(401).json({ 
          success: false,
          error: '❌ Credenciales incorrectas. Verifica tu correo y contraseña.'
        });
      }
      
      // 🔥 LOGIN EXITOSO
      console.log('✅ Login exitoso:', usuario.correo, 'Rol:', usuario.rol);
      
      // Generar token
      const token = jwt.sign(
        {
          id: usuario.id,
          correo: usuario.correo,
          rol: usuario.rol,
          departamento_id: usuario.departamento_id
        },
        process.env.JWT_SECRET || 'secret_key',
        { expiresIn: '8h' }
      );
      
      // Eliminar hash de la respuesta
      const { hash_contrasena, ...usuarioSinPassword } = usuario;
      
      res.json({
        success: true,
        message: '✅ Inicio de sesión exitoso',
        token: token,
        usuario: usuarioSinPassword
      });
      
    } catch (error) {
      console.error('❌ Error en login:', error);
      res.status(500).json({ 
        success: false,
        error: '❌ Error interno del servidor. Intenta más tarde.'
      });
    }
  }

  async getProfile(req, res) {
    try {
      const result = await pool.query(
        `SELECT u.*, d.nombre as departamento_nombre, d.codigo as departamento_codigo 
         FROM usuarios u 
         LEFT JOIN departamentos d ON u.departamento_id = d.id 
         WHERE u.id = $1`,
        [req.user.id]
      );
      
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Usuario no encontrado' });
      }
      
      const usuario = result.rows[0];
      const { hash_contrasena, ...usuarioSinPassword } = usuario;
      
      res.json(usuarioSinPassword);
    } catch (error) {
      console.error('Error obteniendo perfil:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  }
}

module.exports = new AuthController();
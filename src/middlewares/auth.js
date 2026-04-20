// src/middlewares/auth.js 
const jwt = require('jsonwebtoken');
const { pool } = require('../config/database');

// ==================== MIDDLEWARE DE AUTENTICACIÓN ====================
const authenticate = async (req, res, next) => {
  try {
    console.log('🔐 Iniciando autenticación...');
    
    // Obtener token del header
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
      console.log('❌ No hay header de autorización');
      return res.status(401).json({ 
        error: 'Token no proporcionado',
        code: 'NO_TOKEN'
      });
    }
    
    // Verificar formato del token
    if (!authHeader.startsWith('Bearer ')) {
      console.log('❌ Formato de token incorrecto:', authHeader.substring(0, 20));
      return res.status(401).json({ 
        error: 'Formato de token inválido. Debe ser: Bearer <token>',
        code: 'INVALID_TOKEN_FORMAT'
      });
    }
    
    const token = authHeader.split(' ')[1];
    
    if (!token) {
      console.log('❌ Token vacío');
      return res.status(401).json({ 
        error: 'Token vacío',
        code: 'EMPTY_TOKEN'
      });
    }
    
    console.log('🔍 Token recibido (primeros 20 chars):', token.substring(0, 20) + '...');
    
    // Verificar y decodificar token
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret_key');
      console.log('✅ Token válido. Usuario ID:', decoded.id);
    } catch (jwtError) {
      console.error('❌ Error verificando token:', jwtError.name, jwtError.message);
      
      if (jwtError.name === 'JsonWebTokenError') {
        return res.status(401).json({ 
          error: 'Token inválido',
          code: 'INVALID_TOKEN',
          details: 'El token no es válido'
        });
      }
      
      if (jwtError.name === 'TokenExpiredError') {
        return res.status(401).json({ 
          error: 'Token expirado',
          code: 'EXPIRED_TOKEN',
          details: 'El token ha expirado. Inicia sesión nuevamente'
        });
      }
      
      return res.status(401).json({ 
        error: 'Error de autenticación',
        code: 'AUTH_ERROR',
        details: jwtError.message
      });
    }
    
    // Verificar que el usuario aún existe y está activo en la base de datos
    console.log('🔍 Verificando usuario en BD...');
    const userResult = await pool.query(
      `SELECT 
        u.id, 
        u.correo, 
        u.nombre_completo, 
        u.rol, 
        u.activo,
        u.departamento_id,
        d.nombre as departamento_nombre,
        d.codigo as departamento_codigo
       FROM usuarios u
       LEFT JOIN departamentos d ON u.departamento_id = d.id
       WHERE u.id = $1`,
      [decoded.id]
    );
    
    if (userResult.rows.length === 0) {
      console.log('❌ Usuario no encontrado en BD. ID:', decoded.id);
      return res.status(401).json({ 
        error: 'Usuario no encontrado',
        code: 'USER_NOT_FOUND'
      });
    }
    
    const usuario = userResult.rows[0];
    
    if (!usuario.activo) {
      console.log('❌ Usuario inactivo. ID:', usuario.id, 'Correo:', usuario.correo);
      return res.status(401).json({ 
        error: 'Usuario inactivo',
        code: 'USER_INACTIVE',
        details: 'Contacta al administrador del sistema'
      });
    }
    
    console.log('✅ Usuario válido:', {
      id: usuario.id,
      correo: usuario.correo,
      rol: usuario.rol,
      departamento: usuario.departamento_nombre
    });
    
    // Agregar información completa del usuario a la request
    req.user = {
      id: usuario.id,
      correo: usuario.correo,
      nombre_completo: usuario.nombre_completo,
      rol: usuario.rol,
      departamento_id: usuario.departamento_id,
      departamento_nombre: usuario.departamento_nombre,
      departamento_codigo: usuario.departamento_codigo
    };
    
    next();
  } catch (error) {
    console.error('🔥 Error crítico en middleware de autenticación:', error);
    return res.status(500).json({ 
      error: 'Error interno del servidor en autenticación',
      code: 'INTERNAL_AUTH_ERROR',
      details: error.message
    });
  }
};

// ==================== MIDDLEWARE PARA ADMINISTRADORES ====================
const requireAdmin = (req, res, next) => {
  console.log('👑 Verificando rol de administrador...');
  
  if (!req.user) {
    console.log('❌ No hay usuario en la request');
    return res.status(401).json({ 
      error: 'No autenticado',
      code: 'NOT_AUTHENTICATED'
    });
  }
  
  console.log('🔍 Rol del usuario:', req.user.rol);
  
  if (req.user.rol !== 'administrador') {
    console.log('❌ Acceso denegado. Rol:', req.user.rol, 'Se requiere: administrador');
    return res.status(403).json({ 
      error: 'Acceso denegado. Se requiere rol de administrador',
      code: 'ADMIN_REQUIRED',
      current_role: req.user.rol,
      required_role: 'administrador'
    });
  }
  
  console.log('✅ Usuario es administrador:', req.user.correo);
  next();
};

// ==================== MIDDLEWARE PARA JEFES O ADMINISTRADORES ====================
const requireJefeOrAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'No autenticado' });
  }
  
  const rolesPermitidos = ['administrador', 'jefe'];
  if (!rolesPermitidos.includes(req.user.rol)) {
    return res.status(403).json({ 
      error: 'Acceso restringido. Se requiere rol de jefe o administrador',
      current_role: req.user.rol,
      allowed_roles: rolesPermitidos
    });
  }
  
  next();
};

// ==================== FUNCIÓN PARA GENERAR TOKEN ====================
const generateToken = (usuario) => {
  const payload = {
    id: usuario.id,
    correo: usuario.correo,
    rol: usuario.rol,
    departamento_id: usuario.departamento_id,
    nombre_completo: usuario.nombre_completo
  };
  
  return jwt.sign(
    payload,
    process.env.JWT_SECRET || 'secret_key',
    { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
  );
};

// ==================== FUNCIÓN PARA VALIDAR ROLES ====================
const validateRoles = (rolesPermitidos) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'No autenticado' });
    }
    
    if (!rolesPermitidos.includes(req.user.rol)) {
      return res.status(403).json({
        error: `Acceso restringido. Roles permitidos: ${rolesPermitidos.join(', ')}`,
        current_role: req.user.rol
      });
    }
    
    next();
  };
};

// ==================== MIDDLEWARE CON CONTEXTO ====================
const withContext = (handler) => {
  return async (req, res, next) => {
    const client = await pool.connect();
    try {
      // Configurar contexto para triggers
      if (req.user) {
        const ipAddress = req.ip || 
                         req.headers['x-forwarded-for'] || 
                         req.connection.remoteAddress || 
                         '127.0.0.1';
        
        await client.query(`SET LOCAL app.usuario_id = '${req.user.id}'`);
        await client.query(`SET LOCAL app.ip_address = '${ipAddress}'`);
      }
      
      // Pasar el cliente al handler
      req.dbClient = client;
      
      // Ejecutar el handler original
      await handler(req, res, next);
      
      // Liberar cliente si no se ha hecho
      if (client) {
        client.release();
      }
    } catch (error) {
      // Liberar cliente en caso de error
      if (client) {
        client.release();
      }
      next(error);
    }
  };
};

// En src/middlewares/auth.js - AGREGAR ESTE ALIAS
const authorize = validateRoles; // Alias para compatibilidad

// ==================== EXPORTACIONES ====================
module.exports = {
  // Middlewares principales
  authenticate,
  requireAdmin,
  requireJefeOrAdmin,
  
  // Funciones de utilidad
  generateToken,
  validateRoles,
  withContext,
  
  // Aliases para compatibilidad
  isAdmin: requireAdmin,
  isAuthenticated: authenticate,
  authorize // <-- NUEVO ALIAS
};
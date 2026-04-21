const express = require('express');
const cors = require('cors');
require('dotenv').config();
const path = require('path');
const os = require('os');

// Inicializar Express PRIMERO
const app = express();

// Función para obtener IP local
function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

const LOCAL_IP = getLocalIp();

// 🔥 LISTA DE ORÍGENES PERMITIDOS (ACTUALIZADA PARA PRODUCCIÓN)
const getAllowedOrigins = () => {
  const origins = [
    // Desarrollo local
    'http://localhost:8081',
    'http://localhost:19006',
    'http://localhost:3000',
    'http://localhost:5000',
    `http://${LOCAL_IP}:8081`,
    `exp://${LOCAL_IP}:8081`,
    'exp://localhost:19000',
    
    // Producción - Vercel (tus dominios)
    'https://dist-xi-henna-26.vercel.app',
    'https://dist-q0vei0c7g-unicalxs-projects.vercel.app',
    'https://frontend-eight-flame-60.vercel.app',
    'https://frontend-ee5x5hajy-unicalxs-projects.vercel.app',
    
    // Render (el mismo backend)
    process.env.RENDER_EXTERNAL_URL,
    'https://backend-gestion-documental-kvv1.onrender.com',
  ].filter(Boolean); // Eliminar undefined
  
  return origins;
};

// Configurar CORS mejorada
const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = getAllowedOrigins();
    
    // 🔥 NUEVO: Permitir peticiones sin origin (Postman, scripts, etc.)
    if (!origin) {
      console.log('✅ CORS: Petición sin origen (permitida)');
      return callback(null, true);
    }
    
    // 🔥 NUEVO: Permitir cualquier subdominio de vercel.app (para futuros despliegues)
    const isVercelApp = origin.includes('.vercel.app') || origin.includes('.vercel.com');
    
    // 🔥 NUEVO: Permitir cualquier subdominio de onrender.com
    const isRenderApp = origin.includes('.onrender.com');
    
    const isAllowed = allowedOrigins.includes(origin) || isVercelApp || isRenderApp;
    
    console.log('🌐 Origin recibido:', origin);
    console.log('✅ ¿Permitido?', isAllowed);
    
    if (isAllowed) {
      callback(null, true);
    } else {
      console.log('❌ CORS bloqueado para:', origin);
      callback(new Error(`No permitido por CORS: ${origin}`));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-Requested-With'],
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Middleware de logging mejorado
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} - Origin: ${req.headers.origin || 'local'}`);
  next();
});

// Importar rutas
const authRoutes = require('./routes/authRoutes');
const adminRoutes = require('./routes/adminRoutes');
const documentRoutes = require('./routes/documentRoutes');
const catalogoRoutes = require('./routes/catalogoRoutes');
const departamentoRoutes = require('./routes/departamentoRoutes');
const tipoDocumentoRoutes = require('./routes/tipoDocumentoRoutes');
const categoriaRoutes = require('./routes/categoriaRoutes');
const articulosRoutes = require('./routes/articulosRoutes');
const configuracionPeriodosRoutes = require('./routes/configuracionPeriodosRoutes');

// Ruta de health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    message: 'API de Gestión Documental funcionando',
    version: '1.0.0',
    host: LOCAL_IP,
    environment: process.env.NODE_ENV || 'development',
    cors_origins: getAllowedOrigins()
  });
});

// Ruta principal
app.get('/', (req, res) => {
  res.json({
    message: 'API de Gestión Documental Municipal',
    version: '1.0.0',
    author: 'Ayuntamiento',
    host: LOCAL_IP,
    environment: process.env.NODE_ENV || 'development',
    endpoints: {
      auth: '/api/auth',
      admin: '/api/admin',
      documentos: '/api/documentos',
      catalogo: '/api/catalogo',
      departamentos: '/api/departamentos',
      categorias: '/api/categorias',
      tiposDocumento: '/api/tipos-documento',
      articulos: '/api/articulos',
      articulosPermisos: '/api/articulos/permisos',
      configuracionPeriodos: '/api/configuracion-periodos'
    }
  });
});

// Usar rutas
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/documentos', documentRoutes);
app.use('/api/catalogo', catalogoRoutes);
app.use('/api/departamentos', departamentoRoutes);
app.use('/api/tipos-documento', tipoDocumentoRoutes);
app.use('/api/categorias', categoriaRoutes);
app.use('/api/articulos', articulosRoutes);
app.use('/api/configuracion-periodos', configuracionPeriodosRoutes);

// Ruta no encontrada
app.use('*', (req, res) => {
  console.log(`❌ Ruta no encontrada: ${req.method} ${req.originalUrl}`);
  res.status(404).json({ 
    error: 'Ruta no encontrada',
    path: req.originalUrl,
    method: req.method,
    available_endpoints: [
      '/api/health',
      '/api/auth/login',
      '/api/auth/register',
      '/api/documentos',
      '/api/categorias',
      '/api/departamentos',
      '/api/articulos'
    ]
  });
});

// Manejo de errores global
app.use((err, req, res, next) => {
  console.error('🔥 Error del servidor:', err.message);
  console.error('📚 Stack:', err.stack);
  
  if (err.message && err.message.includes('No permitido por CORS')) {
    return res.status(403).json({ 
      error: 'Acceso no permitido desde este dominio',
      origin: req.headers.origin,
      allowed_origins: getAllowedOrigins()
    });
  }
  
  res.status(err.status || 500).json({
    error: 'Error interno del servidor',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Iniciar servidor
const PORT = process.env.PORT || 5000;
const HOST = process.env.HOST || '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`\n🚀 ========================================`);
  console.log(`🚀 Servidor ejecutándose en: http://localhost:${PORT}`);
  console.log(`🌐 URL red local: http://${LOCAL_IP}:${PORT}`);
  console.log(`🔗 URL producción (Render): ${process.env.RENDER_EXTERNAL_URL || 'No definida'}`);
  console.log(`========================================\n`);
  
  console.log('📋 Endpoints disponibles:');
  console.log('   GET  /                    - Información de la API');
  console.log('   GET  /api/health          - Estado del sistema');
  console.log('   POST /api/auth/login      - Iniciar sesión');
  console.log('   POST /api/auth/register   - Registrar usuario');
  console.log('   GET  /api/admin/usuarios  - Panel administración');
  console.log('   GET  /api/departamentos   - Lista departamentos');
  console.log('   GET  /api/tipos-documento - Tipos de documento');
  console.log('   GET  /api/categorias      - Categorías');
  console.log('   GET  /api/articulos       - Lista artículos');
  console.log('   GET  /api/configuracion-periodos - Configuración periodos');
  console.log('\n✅ CORS configurado para:');
  getAllowedOrigins().forEach(origin => {
    console.log(`   - ${origin}`);
  });
  console.log('   - *.vercel.app (todos)');
  console.log('   - *.onrender.com (todos)');
  console.log('\n🔥 Servidor listo para producción en Render + Vercel\n');
});
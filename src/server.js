const express = require('express');
const cors = require('cors');
require('dotenv').config();
const path = require('path');
const os = require('os'); // 🔥 Agregar para obtener IP local

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

const LOCAL_IP = getLocalIp(); // 🔥 Obtiene automáticamente 192.168.30.3

// Configurar CORS para desarrollo
const corsOptions = {
  origin: function (origin, callback) {
    // Permitir todas las conexiones en desarrollo
    const allowedOrigins = [
      'http://localhost:8081',
      `http://${LOCAL_IP}:8081`,  // 🔥 Usa la IP detectada
      `exp://${LOCAL_IP}:8081`,    // 🔥 Usa la IP detectada
      'http://localhost:19006',
      'exp://localhost:19000',
      'http://localhost:3000'      // 🔥 Agregar por si acaso
    ];
    
    console.log('🌐 Origin recibido:', origin);
    console.log('✅ Origins permitidos:', allowedOrigins);
    
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('No permitido por CORS'));
    }
  },
  credentials: true,
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Middleware de logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.originalUrl}`);
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
// 🔥 NUEVAS RUTAS PARA ARTÍCULOS
const articulosRoutes = require('./routes/articulosRoutes');
const configuracionPeriodosRoutes = require('./routes/configuracionPeriodosRoutes');

// Ruta de health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    message: 'API de Gestión Documental funcionando',
    version: '1.0.0',
    host: LOCAL_IP // 🔥 Agregar IP actual
  });
});

// Ruta principal
app.get('/', (req, res) => {
  res.json({
    message: 'API de Gestión Documental Municipal',
    version: '1.0.0',
    author: 'Ayuntamiento',
    host: LOCAL_IP, // 🔥 Agregar IP actual
    endpoints: {
      auth: '/api/auth',
      admin: '/api/admin',
      documentos: '/api/documentos',
      catalogo: '/api/catalogo',
      departamentos: '/api/departamentos',
      categorias: '/api/categorias',
      tiposDocumento: '/api/tipos-documento',
      // 🔥 NUEVOS ENDPOINTS
      articulos: '/api/articulos',
      articulosPermisos: '/api/articulos/permisos'
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
// 🔥 AGREGAR NUEVAS RUTAS DE ARTÍCULOS
app.use('/api/articulos', articulosRoutes);
app.use('/api/configuracion-periodos', configuracionPeriodosRoutes);

// Ruta no encontrada
app.use('*', (req, res) => {
  res.status(404).json({ 
    error: 'Ruta no encontrada',
    path: req.originalUrl,
    method: req.method
  });
});

// Manejo de errores global
app.use((err, req, res, next) => {
  console.error('🔥 Error del servidor:', err.message);
  
  if (err.message === 'No permitido por CORS') {
    return res.status(403).json({ 
      error: 'Acceso no permitido desde este dominio',
      origin: req.headers.origin
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
  console.log(`🚀 Servidor ejecutándose en: http://localhost:${PORT}`);
  console.log(`🌐 URL red local: http://${LOCAL_IP}:${PORT}`); // 🔥 Usa IP detectada
  console.log('\n📋 Endpoints disponibles:');
  console.log('   GET  /                    - Información de la API');
  console.log('   GET  /api/health          - Estado del sistema');
  console.log('   POST /api/auth/login      - Iniciar sesión');
  console.log('   GET  /api/admin/usuarios  - Panel administración');
  console.log('   GET  /api/departamentos   - Lista departamentos');
  console.log('   GET  /api/tipos-documento - Tipos de documento');
  console.log('   GET  /api/categorias      - Categorías');
  console.log('   🔥 NUEVOS ENDPOINTS PARA ARTÍCULOS:');
  console.log('   GET  /api/articulos                  - Lista todos los artículos');
  console.log('   GET  /api/articulos/:id              - Detalle de artículo');
  console.log('   POST /api/articulos                  - Crear artículo (admin)');
  console.log('   PUT  /api/articulos/:id              - Actualizar artículo (admin)');
  console.log('   GET  /api/articulos/permisos         - Todos los permisos (admin)');
  console.log('   POST /api/articulos/asignar          - Asignar permiso (admin)');
  console.log('   DELETE /api/articulos/quitar         - Quitar permiso (admin)');
  console.log('   GET  /api/articulos/estadisticas     - Estadísticas (admin)');
});
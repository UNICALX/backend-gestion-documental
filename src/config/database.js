// backend/src/config/database.js - VERSIÓN PARA RENDER
const { Pool } = require('pg');
require('dotenv').config();

// Configuración para Render (usando DATABASE_URL)
let poolConfig;

if (process.env.DATABASE_URL) {
  // En producción (Render) - usar URL completa
  poolConfig = {
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false  // Necesario para Render
    },
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  };
  console.log('🔗 Conectando a base de datos con DATABASE_URL');
} else {
  // En desarrollo local - usar variables individuales
  poolConfig = {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'gestion_documental',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '1234',
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  };
  console.log('💻 Conectando a base de datos local');
}

const pool = new Pool(poolConfig);

// Función para probar conexión
const testConnection = async () => {
  try {
    const client = await pool.connect();
    console.log('✅ Conexión a PostgreSQL establecida');
    client.release();
    return true;
  } catch (error) {
    console.error('❌ Error conectando a PostgreSQL:', error.message);
    return false;
  }
};

// Método query
const query = (text, params) => {
  return pool.query(text, params);
};

// getClient para compatibilidad
const getClient = () => {
  return pool.connect();
};

// Manejar errores del pool
pool.on('error', (err) => {
  console.error('Error inesperado en el pool de conexiones:', err);
});

module.exports = {
  pool,
  testConnection,
  query,
  getClient
};
// backend/src/config/database.js - VERSIÓN CORRECTA
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

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

// AGREGAR ESTO: Método query que usa el controlador
const query = (text, params) => {
  return pool.query(text, params);
};

// También agregar getClient por si acaso
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
  query,        // AÑADIDO - Esto es lo que necesita categoriaController.js
  getClient     // AÑADIDO - Para compatibilidad
};
// src/utils/fileUpload.js - VERSIÓN CON NOMBRE DEL FORMULARIO
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Crear directorio de uploads
const UPLOAD_PATH = process.env.UPLOAD_PATH || './uploads';
if (!fs.existsSync(UPLOAD_PATH)) {
  fs.mkdirSync(UPLOAD_PATH, { recursive: true });
}

// Configurar almacenamiento
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const tempPath = path.join(UPLOAD_PATH, 'temp');
    if (!fs.existsSync(tempPath)) {
      fs.mkdirSync(tempPath, { recursive: true });
    }
    cb(null, tempPath);
  },
  
  filename: (req, file, cb) => {
    // ========== USAR TÍTULO DEL FORMULARIO ==========
    // 1. Obtener título del formulario (requerido por tu aplicación)
    let titulo = req.body.titulo || 'documento';
    
    // 2. Limpiar y formatear el título
    const nombreArchivo = titulo
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // Quitar acentos
      .replace(/[^a-zA-Z0-9\s_-]/g, '') // Solo caracteres seguros
      .replace(/\s+/g, '_')            // Espacios a guiones bajos
      .toLowerCase()                   // Minúsculas
      .substring(0, 100);              // Limitar longitud
    
    // 3. Obtener extensión del archivo original
    const extension = path.extname(file.originalname).toLowerCase();
    
    // 4. Añadir timestamp corto para unicidad
    const timestamp = Date.now().toString().slice(-6); // Últimos 6 dígitos
    
    // 5. Nombre final: titulo_timestamp.ext
    const nombreFinal = `${nombreArchivo}_${timestamp}${extension}`;
    
    console.log('📁 Generando nombre de archivo:');
    console.log('   Título formulario:', titulo);
    console.log('   Archivo original:', file.originalname);
    console.log('   Nombre final:', nombreFinal);
    
    // 6. Guardar ambos nombres para referencia
    if (!req.fileMetadata) req.fileMetadata = {};
    req.fileMetadata.originalName = file.originalname;
    req.fileMetadata.formTitle = titulo;
    req.fileMetadata.generatedName = nombreFinal;
    
    cb(null, nombreFinal);
  }
});

// Filtrar tipos de archivo (igual que antes)
const fileFilter = (req, file, cb) => {
  const allowedExtensions = process.env.ALLOWED_EXTENSIONS?.split(',') || 
    ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'jpg', 'jpeg', 'png'];
  const fileExt = path.extname(file.originalname).toLowerCase().substring(1);
  
  if (allowedExtensions.includes(fileExt)) {
    cb(null, true);
  } else {
    cb(new Error(`Tipo de archivo .${fileExt} no permitido`), false);
  }
};

// Crear instancia de multer
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 50 * 1024 * 1024
  }
});

module.exports = upload;
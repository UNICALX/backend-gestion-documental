// src/controllers/documentController.js
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/database');
const ftpService = require('../services/ftpService');

// ========== FUNCIONES DE UTILIDAD ==========
const formatBytes = (bytes) => {
  if (!bytes || bytes === 0) return '0 Bytes';
  if (bytes < 1024) return bytes + ' Bytes';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
  return (bytes / 1073741824).toFixed(1) + ' GB';
};

const formatDateForDisplay = (dateString) => {
  if (!dateString) return '';
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString('es-ES', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return dateString;
  }
};

const calculateDaysInTrash = (dateString) => {
  if (!dateString) return 0;
  try {
    const trashDate = new Date(dateString);
    const now = new Date();
    const diffTime = Math.abs(now - trashDate);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  } catch {
    return 0;
  }
};

class DocumentController {
  
  // ========== CONSTRUCTOR - BINDEAR MÉTODOS ==========
  constructor() {
    console.log('🏗️ Inicializando DocumentController...');
    
    // Bindear todos los métodos al contexto de la instancia
    this.uploadDocument = this.uploadDocument.bind(this);
    this.getDocuments = this.getDocuments.bind(this);
    this.getDocumentById = this.getDocumentById.bind(this);
    this.downloadDocument = this.downloadDocument.bind(this);
    this.updateDocument = this.updateDocument.bind(this);
    this.transferDocument = this.transferDocument.bind(this);
    this.deleteDocument = this.deleteDocument.bind(this);
    this.restoreDocument = this.restoreDocument.bind(this);
    this.getPapelera = this.getPapelera.bind(this);
    this.getDocumentStats = this.getDocumentStats.bind(this);
    this.getCategoriasDocumento = this.getCategoriasDocumento.bind(this);
    
    // 🔥 NUEVOS MÉTODOS
    this.getAllDocuments = this.getAllDocuments.bind(this);
    this.getArticulosDisponibles = this.getArticulosDisponibles.bind(this);
    
    console.log('✅ DocumentController inicializado correctamente');
  }
  

// ========== SUBIR DOCUMENTO ==========
async uploadDocument(req, res) {
  const client = await pool.connect();
  try {
    const { 
      titulo, 
      descripcion, 
      categorias, 
      categoria_ids, 
      departamento,
      ruta_personalizada
    } = req.body;
    
    const archivo = req.file;
    
    console.log('📤 ===== INICIANDO UPLOAD DE DOCUMENTO =====');
    console.log(`   📄 Título: "${titulo}"`);
    console.log(`   📄 Descripción: ${descripcion || '(sin descripción)'}`);
    console.log(`   📄 Ruta personalizada: ${ruta_personalizada || 'No especificada'}`);
    console.log(`   📄 Departamento: ${departamento || req.user.departamento_id}`);
    console.log(`   📄 Usuario: ${req.user.id}`);
    console.log(`   📄 Archivo original: ${archivo?.originalname}`);

    // ========== VALIDACIONES BÁSICAS ==========
    if (!archivo) {
      client.release();
      return res.status(400).json({ 
        success: false, 
        error: 'No se ha proporcionado ningún archivo' 
      });
    }

    if (!titulo) {
      client.release();
      fs.unlinkSync(archivo.path);
      return res.status(400).json({ 
        success: false, 
        error: 'El título es obligatorio' 
      });
    }

    const departamentoId = departamento || req.user.departamento_id;

    // ========== VALIDAR QUE TENGA CLASIFICACIÓN JERÁRQUICA ==========
    if (!ruta_personalizada) {
      client.release();
      fs.unlinkSync(archivo.path);
      return res.status(400).json({ 
        success: false, 
        error: 'Debes seleccionar la ubicación completa del documento (Artículo/Fracción/Período)' 
      });
    }

    // ========== CONFIGURAR CONTEXTO PARA TRIGGERS ==========
    const ipAddress = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress || '127.0.0.1';
    await client.query(`SET LOCAL app.usuario_id = '${req.user.id}'`);
    await client.query(`SET LOCAL app.ip_address = '${ipAddress}'`);

    await client.query('BEGIN');

    // ========== VERIFICAR ESPACIO DISPONIBLE ==========
    const espacioResult = await client.query(
      `SELECT COALESCE(usado_bytes, 0) as usado_bytes, 
              COALESCE(limite_bytes, 5368709120) as limite_bytes 
       FROM espacio_almacenamiento 
       WHERE departamento_id = $1`,
      [departamentoId]
    );

    let espacioUsado = 0;
    let espacioLimite = 5368709120;

    if (espacioResult.rows.length > 0) {
      espacioUsado = parseInt(espacioResult.rows[0].usado_bytes);
      espacioLimite = parseInt(espacioResult.rows[0].limite_bytes);
    }

    const nuevoEspacio = espacioUsado + archivo.size;

    if (nuevoEspacio > espacioLimite) {
      fs.unlinkSync(archivo.path);
      await client.query('ROLLBACK');
      client.release();
      return res.status(400).json({ 
        success: false, 
        error: `Espacio de almacenamiento insuficiente. Necesitas ${formatBytes(nuevoEspacio - espacioLimite)} más`,
        espacio_disponible: formatBytes(espacioLimite - espacioUsado),
        espacio_necesario: formatBytes(archivo.size)
      });
    }

    // ========== CONSTRUIR CLASIFICACIÓN JERÁRQUICA ==========
    console.log('📁 Procesando ruta personalizada:', ruta_personalizada);
    
    const partes = ruta_personalizada.split('/').filter(p => p && p.length > 0);
    
    let articulo = null;
    let fraccion = null;
    let anio = null;
    let periodo = null;
    
    for (const parte of partes) {
      if (parte.startsWith('articulo_')) {
        articulo = parte.replace('articulo_', '');
        console.log(`   📌 Artículo detectado: ${articulo}`);
      } else if (parte.startsWith('fraccion_')) {
        fraccion = parte.replace('fraccion_', '');
        console.log(`   📌 Fracción detectada: ${fraccion}`);
      } else if (/^\d{4}$/.test(parte)) {
        anio = parte;
        console.log(`   📌 Año detectado: ${anio}`);
      } else if (parte.includes('trimestre') || parte.includes('semestre')) {
        periodo = parte;
        console.log(`   📌 Período detectado: ${periodo}`);
      }
    }
    
    if (!articulo || !fraccion) {
      fs.unlinkSync(archivo.path);
      await client.query('ROLLBACK');
      client.release();
      return res.status(400).json({
        success: false,
        error: 'La ruta debe contener al menos artículo y fracción'
      });
    }
    
    const clasificacion = {
      articulo,
      fraccion,
      periodo: anio ? {
        valor: anio,
        subperiodo: periodo
      } : null
    };
    
    console.log('📁 Clasificación construida (sin departamento):', JSON.stringify(clasificacion, null, 2));
    
    const uploadPath = `/${ruta_personalizada}`;
    console.log(`📁 Ruta de destino: ${uploadPath}`);

    // ========== GENERAR NOMBRE DE ARCHIVO ==========
    const fileExtension = path.extname(archivo.originalname).toLowerCase();
    
    const cleanTitle = titulo
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9\s_-]/g, '')
      .replace(/\s+/g, '_')
      .substring(0, 100);
    
    let finalFileName = `${cleanTitle}${fileExtension}`;
    let baseName = cleanTitle;
    let counter = 0;
    
    console.log(`🔍 Verificando si existe en la ruta: ${uploadPath}`);
    console.log(`   📄 Buscando archivo: ${finalFileName}`);
    
    try {
      const pathParts = uploadPath.split('/').filter(p => p);
      const dirPath = '/' + pathParts.join('/');
      
      while (await ftpService.fileExists(dirPath, finalFileName)) {
        counter++;
        finalFileName = `${baseName}${counter}${fileExtension}`;
        console.log(`   ⚠️ Ya existe, intentando: ${finalFileName}`);
      }
    } catch (checkError) {
      console.log('   ⚠️ Error verificando existencia, se asume que no existe:', checkError.message);
    }
    
    console.log(`✅ Nombre único generado: ${finalFileName}`);

    // ========== PREPARAR ARCHIVO TEMPORAL ==========
    const tempDir = path.dirname(archivo.path);
    const newTempPath = path.join(tempDir, finalFileName);
    fs.renameSync(archivo.path, newTempPath);
    console.log(`📁 Archivo temporal renombrado a: ${newTempPath}`);

    // ========== SUBIR AL FTP ==========
    console.log(`📤 Subiendo archivo a FTP con clasificación jerárquica...`);
    let uploadResult;
    
    try {
      uploadResult = await ftpService.uploadFile(
        newTempPath,
        null,
        finalFileName,
        clasificacion
      );
      
      console.log(`✅ Archivo subido exitosamente:`);
      console.log(`   📁 Ruta completa: ${uploadResult.fullPath}`);
      console.log(`   📁 Ruta relativa: ${uploadResult.relativePath}`);
      console.log(`   📁 Parseado:`, uploadResult.parsed);
      
    } catch (ftpError) {
      console.error('❌ Error FTP detallado:', ftpError);
      
      if (fs.existsSync(newTempPath)) {
        fs.unlinkSync(newTempPath);
      }
      
      await client.query('ROLLBACK');
      client.release();
      
      return res.status(503).json({
        success: false,
        error: 'Error en el servidor de archivos. Por favor, contacta al administrador.',
        code: 'FTP_UPLOAD_ERROR',
        details: ftpError.message
      });
    }

    // ========== INSERTAR DOCUMENTO EN BASE DE DATOS ==========
    console.log('💾 Insertando documento en base de datos...');
    
    const docResult = await client.query(
      `INSERT INTO documentos (
        titulo, 
        descripcion, 
        ruta_archivo, 
        nombre_archivo_sistema,
        nombre_archivo_original, 
        tamaño_archivo, 
        tipo_archivo, 
        extension,
        departamento_id, 
        subido_por, 
        archivado, 
        eliminado,
        clasificacion_articulo, 
        clasificacion_fraccion, 
        clasificacion_anio, 
        clasificacion_periodo
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING id, fecha_creacion`,
      [
        titulo.trim(),
        descripcion?.trim() || null,
        uploadResult.fullPath,
        finalFileName,
        archivo.originalname,
        archivo.size,
        archivo.mimetype,
        fileExtension.substring(1),
        departamentoId,
        req.user.id,
        false,
        false,
        clasificacion.articulo,
        clasificacion.fraccion,
        clasificacion.periodo?.valor || null,
        clasificacion.periodo?.subperiodo || null
      ]
    );

    const documentoId = docResult.rows[0].id;
    console.log(`✅ Documento insertado en BD con ID: ${documentoId}`);

// ========== ASOCIAR CATEGORÍAS ==========
console.log('\n🔍 ===== INICIANDO ASOCIACIÓN DE CATEGORÍAS =====');
console.log('📦 Valores recibidos:');
console.log('   - categorias:', categorias);
console.log('   - categoria_ids:', categoria_ids);
console.log('   - tipo de categorias:', typeof categorias);
console.log('   - tipo de categoria_ids:', typeof categoria_ids);
console.log('   - departamentoId:', departamentoId);
console.log('   - usuario rol:', req.user.rol);
console.log('   - es admin?', req.user.rol === 'administrador' ? 'SÍ' : 'NO');

let categoriasArray = [];

// Procesar categorias
if (categorias) {
  console.log('📦 Procesando "categorias":', categorias);
  if (Array.isArray(categorias)) {
    categoriasArray = categorias;
    console.log('   ✅ Es array, usando directamente');
  } else if (typeof categorias === 'string') {
    console.log('   📝 Es string, intentando parsear JSON');
    try {
      categoriasArray = JSON.parse(categorias);
      console.log('   ✅ JSON parseado exitosamente:', categoriasArray);
    } catch (e) {
      console.log('   ⚠️ No es JSON válido, tratando como ID único');
      const parsed = parseInt(categorias);
      categoriasArray = !isNaN(parsed) && parsed > 0 ? [parsed] : [];
      console.log('   ➡️ Array resultante:', categoriasArray);
    }
  }
} 
// Procesar categoria_ids
else if (categoria_ids) {
  console.log('📦 Procesando "categoria_ids":', categoria_ids);
  if (Array.isArray(categoria_ids)) {
    categoriasArray = categoria_ids;
    console.log('   ✅ Es array, usando directamente');
  } else if (typeof categoria_ids === 'string') {
    console.log('   📝 Es string, intentando parsear JSON');
    try {
      categoriasArray = JSON.parse(categoria_ids);
      console.log('   ✅ JSON parseado exitosamente:', categoriasArray);
    } catch (e) {
      console.log('   ⚠️ No es JSON válido, tratando como ID único');
      const parsed = parseInt(categoria_ids);
      categoriasArray = !isNaN(parsed) && parsed > 0 ? [parsed] : [];
      console.log('   ➡️ Array resultante:', categoriasArray);
    }
  }
} else {
  console.log('ℹ️ No se recibieron categorías en ningún campo');
}

console.log('📊 Array antes de limpiar:', categoriasArray);

// Limpiar y validar IDs (asegurar que sean números positivos)
categoriasArray = categoriasArray
  .map(id => {
    let parsed;
    if (typeof id === 'string') {
      parsed = parseInt(id, 10);
      console.log(`   🔄 Procesando ID string: "${id}" -> ${parsed} (${isNaN(parsed) ? 'NaN' : parsed})`);
    } else if (typeof id === 'number') {
      parsed = id;
      console.log(`   🔄 Procesando ID number: ${id} -> ${parsed}`);
    } else {
      console.log(`   ⚠️ Tipo no manejado: ${typeof id}`);
      parsed = NaN;
    }
    return parsed;
  })
  .filter(id => {
    const valido = !isNaN(id) && id > 0;
    if (!valido) {
      console.log(`   ❌ ID ${id} inválido (NaN o <= 0), filtrado`);
    }
    return valido;
  });

console.log('📊 Array final de categorías a procesar:', categoriasArray);

if (categoriasArray.length > 0) {
  console.log(`🏷️ Procesando ${categoriasArray.length} categorías...`);
  
  let idsValidos = [];
  
  // 🔥 OPCIÓN 3: Admin puede asignar cualquier categoría, usuarios normales solo las de su departamento
  if (req.user.rol === 'administrador') {
    console.log('👑 ADMIN: Saltando validación de categorías por departamento');
    console.log('   - Usando directamente los IDs proporcionados:', categoriasArray);
    idsValidos = categoriasArray;
  } else {
    console.log('👤 Usuario normal: Validando categorías contra departamento');
    console.log(`   - IDs a verificar:`, categoriasArray);
    console.log(`   - Departamento ID:`, departamentoId);
    
    const categoriasValidas = await client.query(
      `SELECT cd.categoria_id 
       FROM categorias_departamentos cd
       WHERE cd.categoria_id = ANY($1::int[]) 
       AND cd.departamento_id = $2 
       AND cd.activo = true`,
      [categoriasArray, departamentoId]
    );
    
    console.log('🔍 Resultado de consulta categorías válidas:');
    console.log('   - Filas encontradas:', categoriasValidas.rowCount);
    console.log('   - Datos:', categoriasValidas.rows);
    
    idsValidos = categoriasValidas.rows.map(c => c.categoria_id);
    console.log('✅ IDs válidos para este departamento:', idsValidos);
    
    // Mostrar IDs que fueron rechazados
    const idsRechazados = categoriasArray.filter(id => !idsValidos.includes(id));
    if (idsRechazados.length > 0) {
      console.log('⚠️ IDs rechazados (no asignados a este departamento):', idsRechazados);
    }
  }
  
  if (idsValidos.length > 0) {
    console.log(`💾 Insertando ${idsValidos.length} categorías en documentos_categorias...`);
    
    for (const categoriaId of idsValidos) {
      console.log(`   ➕ Insertando: documento=${documentoId}, categoria=${categoriaId}`);
      try {
        const insertResult = await client.query(
          `INSERT INTO documentos_categorias 
           (documento_id, categoria_id, fecha_asignacion) 
           VALUES ($1, $2, CURRENT_TIMESTAMP)
           ON CONFLICT (documento_id, categoria_id) DO NOTHING
           RETURNING *`,
          [documentoId, categoriaId]
        );
        
        if (insertResult.rowCount > 0) {
          console.log(`      ✅ Insertado correctamente`);
        } else {
          console.log(`      ℹ️ Ya existía esta relación (duplicado ignorado)`);
        }
      } catch (insertError) {
        console.error(`      ❌ Error insertando categoría ${categoriaId}:`, insertError.message);
      }
    }
    
    console.log(`✅ ${idsValidos.length} categorías procesadas exitosamente`);
  } else {
    console.log('⚠️ No hay categorías válidas para procesar');
    if (req.user.rol !== 'administrador') {
      console.log('   Causa: Las categorías no están asignadas a este departamento');
    }
  }
} else {
  console.log('ℹ️ No hay categorías para asociar');
}

console.log('🔚 ===== FIN ASOCIACIÓN DE CATEGORÍAS =====\n');


// ========== ACTUALIZAR ESPACIO DE ALMACENAMIENTO ==========
await client.query(
  `INSERT INTO espacio_almacenamiento (departamento_id, usado_bytes, limite_bytes)
   VALUES ($1, $2, 5368709120)
   ON CONFLICT (departamento_id) 
   DO UPDATE SET 
     usado_bytes = espacio_almacenamiento.usado_bytes + $2,
     fecha_calculo = CURRENT_TIMESTAMP`,
  [departamentoId, archivo.size]
);

// 🔥 ¡AGREGA ESTO!
console.log('💾 Haciendo COMMIT de la transacción...');
await client.query('COMMIT');
console.log('✅ COMMIT exitoso');

// ========== ELIMINAR ARCHIVO TEMPORAL ==========
if (fs.existsSync(newTempPath)) {
  fs.unlinkSync(newTempPath);
  console.log('🗑️ Archivo temporal eliminado');
}

    const rutaMostrar = uploadResult.parsed?.pathWithoutBase || uploadPath;
    
    console.log(`✅ ===== UPLOAD COMPLETADO EXITOSAMENTE =====`);
    console.log(`   📄 ID: ${documentoId}`);
    console.log(`   📄 Título: ${titulo}`);
    console.log(`   📄 Archivo: ${finalFileName}`);
    console.log(`   📁 Ruta FTP: ${uploadResult.fullPath}`);
    console.log(`   📁 Ruta amigable: ${rutaMostrar}`);
    console.log(`   📁 Clasificación: Artículo ${articulo} / Fracción ${fraccion}${anio ? ' / ' + anio : ''}${periodo ? ' / ' + periodo : ''}`);
    console.log(`   📄 Categorías: ${categoriasArray.length}`);

    res.status(201).json({
      success: true,
      message: 'Documento subido correctamente',
      documento_id: documentoId,
      clasificacion: {
        articulo,
        fraccion,
        anio: anio || null,
        periodo: periodo || null
      },
      categorias_asociadas: categoriasArray.length,
      archivo: {
        nombre: finalFileName,
        nombre_original: archivo.originalname,
        tamaño: formatBytes(archivo.size),
        extension: fileExtension.substring(1),
        ruta_ftp: uploadResult.fullPath,
        ruta_amigable: rutaMostrar
      }
    });

  } catch (error) {
    console.error('❌ Error subiendo documento:');
    console.error('   Mensaje:', error.message);
    console.error('   Stack:', error.stack);
    
    if (client) {
      try {
        await client.query('ROLLBACK');
        client.release();
      } catch (rollbackError) {
        console.error('Error en rollback:', rollbackError);
      }
    }
    
    if (req.file && fs.existsSync(req.file.path)) {
      try {
        fs.unlinkSync(req.file.path);
        console.log('🗑️ Archivo temporal eliminado por error');
      } catch (unlinkError) {
        console.error('Error eliminando archivo temporal:', unlinkError);
      }
    }
    
    res.status(500).json({ 
      success: false, 
      error: 'Error interno del servidor al subir documento',
      details: error.message,
      code: error.code || 'INTERNAL_ERROR'
    });
  }
}
  
// ========== OBTENER DOCUMENTOS (con filtros) - VERSIÓN CON ADMIN UNIVERSAL ==========
async getDocuments(req, res) {
  try {
    const { 
      page = 1, 
      limit = 20, 
      search = '', 
      categoria_id,
      archivado,
      eliminado,
      departamento_id // 🔥 NUEVO: para que admin pueda filtrar por departamento específico
    } = req.query;
    
    console.log('📄 Obteniendo documentos:', {
      user: req.user.id,
      userRol: req.user.rol,
      userDepartamento: req.user.departamento_id,
      page,
      limit,
      search,
      archivado: archivado !== undefined ? archivado : 'no enviado',
      eliminado: eliminado !== undefined ? eliminado : 'no enviado',
      categoria_id,
      departamento_id: departamento_id || 'no enviado'
    });
    
    // 🔥 CONSTRUIR CONSULTA BASE
    let query = `
      SELECT 
        d.*, 
        dep.nombre as departamento_nombre,
        dep.codigo as departamento_codigo,
        u.nombre_completo as subido_por_nombre,
        u.correo as subido_por_correo
      FROM documentos d
      LEFT JOIN departamentos dep ON d.departamento_id = dep.id
      LEFT JOIN usuarios u ON d.subido_por = u.id
      WHERE 1=1
    `;
    
    const params = [];
    let paramCount = 0;
    
    // 🔥 FILTRO POR DEPARTAMENTO: Si es admin, puede ver TODOS o filtrar por uno específico
    if (req.user.rol === 'administrador') {
      if (departamento_id && departamento_id !== '') {
        // Admin filtrando por un departamento específico
        paramCount++;
        query += ` AND d.departamento_id = $${paramCount}`;
        params.push(departamento_id);
        console.log(`👑 Admin filtrando por departamento específico: ${departamento_id}`);
      } else {
        // Admin viendo TODOS los departamentos
        console.log('👑 Admin viendo TODOS los departamentos');
        // No agregar filtro de departamento
      }
    } else {
      // Usuario normal: solo su departamento
      paramCount++;
      query += ` AND d.departamento_id = $${paramCount}`;
      params.push(req.user.departamento_id);
      console.log(`👤 Usuario normal filtrando por su departamento: ${req.user.departamento_id}`);
    }
    
    // 🔥 FILTROS DE ESTADO: Solo agregar SI vienen definidos
    if (archivado !== undefined) {
      paramCount++;
      query += ` AND d.archivado = $${paramCount}`;
      params.push(archivado === 'true');
      console.log(`   📌 Filtro archivado: ${archivado === 'true'}`);
    }
    
    if (eliminado !== undefined) {
      paramCount++;
      query += ` AND d.eliminado = $${paramCount}`;
      params.push(eliminado === 'true');
      console.log(`   📌 Filtro eliminado: ${eliminado === 'true'}`);
    } else {
      // Por defecto, si no se especifica eliminado, mostrar solo no eliminados
      // (esto es por seguridad, aunque el frontend siempre envía el parámetro)
      paramCount++;
      query += ` AND d.eliminado = $${paramCount}`;
      params.push(false);
      console.log(`   📌 Por defecto: eliminado = false`);
    }
    
    // 🔥 FILTRO DE BÚSQUEDA
    if (search && search.trim() !== '') {
      paramCount++;
      query += ` AND (
        d.titulo ILIKE $${paramCount} 
        OR d.descripcion ILIKE $${paramCount}
        OR d.nombre_archivo_original ILIKE $${paramCount}
        OR u.nombre_completo ILIKE $${paramCount}
      )`;
      params.push(`%${search.trim()}%`);
      console.log(`   📌 Búsqueda: "${search}"`);
    }
    
    // 🔥 FILTRO POR CATEGORÍA
    if (categoria_id && categoria_id !== '') {
      paramCount++;
      query += ` AND EXISTS (
        SELECT 1 FROM documentos_categorias dc
        WHERE dc.documento_id = d.id 
        AND dc.categoria_id = $${paramCount}
      )`;
      params.push(categoria_id);
      console.log(`   📌 Filtro categoría: ${categoria_id}`);
    }
    
    // 🔥 CONTAR TOTAL (sin paginación)
    const countQuery = `SELECT COUNT(*) as total FROM (${query}) AS sub`;
    const countResult = await pool.query(countQuery, params);
    const total = parseInt(countResult.rows[0]?.total || 0);
    
    // 🔥 AGREGAR PAGINACIÓN
    query += ` ORDER BY d.fecha_creacion DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    params.push(parseInt(limit), (parseInt(page) - 1) * parseInt(limit));
    
    // 🔥 EJECUTAR CONSULTA PRINCIPAL
    const result = await pool.query(query, params);
    
    // 🔥 OBTENER CATEGORÍAS PARA CADA DOCUMENTO
    const documentosConCategorias = await Promise.all(
      result.rows.map(async (doc) => {
        const categorias = await pool.query(
          `SELECT c.id, c.nombre, c.codigo, dc.fecha_asignacion
           FROM categorias_documento c
           JOIN documentos_categorias dc ON c.id = dc.categoria_id
           WHERE dc.documento_id = $1
           ORDER BY dc.fecha_asignacion DESC`,
          [doc.id]
        );
        
        return {
          ...doc,
          categorias: categorias.rows,
          fecha_creacion_formatted: formatDateForDisplay(doc.fecha_creacion),
          fecha_actualizacion_formatted: formatDateForDisplay(doc.fecha_actualizacion),
          tamaño_archivo_formatted: formatBytes(doc.tamaño_archivo)
        };
      })
    );
    
    console.log(`✅ ${documentosConCategorias.length} documentos encontrados (Total en BD: ${total})`);
    if (req.user.rol === 'administrador') {
      console.log(`👑 Admin viendo documentos de ${!departamento_id ? 'TODOS los departamentos' : `departamento ${departamento_id}`}`);
    }
    
    res.json({
      success: true,
      documentos: documentosConCategorias,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
    
  } catch (error) {
    console.error('❌ Error obteniendo documentos:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Error interno del servidor al obtener documentos',
      details: error.message
    });
  }
}

  // ========== 🔥 OBTENER TODOS LOS DOCUMENTOS (para catálogo) ==========
  async getAllDocuments(req, res) {
    try {
      const { page = 1, limit = 100, search = '' } = req.query;
      const offset = (parseInt(page) - 1) * parseInt(limit);
      
      console.log('📋 Obteniendo todos los documentos para catálogo');
      
      let query = `
        SELECT 
          d.*, 
          dep.nombre as departamento_nombre,
          dep.codigo as departamento_codigo,
          u.nombre_completo as subido_por_nombre,
          u.correo as subido_por_correo
        FROM documentos d
        LEFT JOIN departamentos dep ON d.departamento_id = dep.id
        LEFT JOIN usuarios u ON d.subido_por = u.id
        WHERE d.eliminado = false
      `;
      
      const params = [];
      let paramCount = 0;
      
      if (search && search.trim() !== '') {
        paramCount++;
        query += ` AND (
          d.titulo ILIKE $${paramCount} 
          OR d.descripcion ILIKE $${paramCount}
          OR u.nombre_completo ILIKE $${paramCount}
          OR dep.nombre ILIKE $${paramCount}
        )`;
        params.push(`%${search.trim()}%`);
      }
      
      const countQuery = `SELECT COUNT(*) as total FROM (${query}) AS sub`;
      const countResult = await pool.query(countQuery, params);
      const total = parseInt(countResult.rows[0]?.total || 0);
      
      query += ` ORDER BY d.fecha_creacion DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
      params.push(parseInt(limit), offset);
      
      const result = await pool.query(query, params);
      
      const documentosConCategorias = await Promise.all(
        result.rows.map(async (doc) => {
          const categorias = await pool.query(
            `SELECT c.id, c.nombre, c.codigo
             FROM categorias_documento c
             JOIN documentos_categorias dc ON c.id = dc.categoria_id
             WHERE dc.documento_id = $1`,
            [doc.id]
          );
          
          return {
            ...doc,
            categorias: categorias.rows,
            tamaño_archivo_formatted: formatBytes(doc.tamaño_archivo),
            fecha_creacion_formatted: formatDateForDisplay(doc.fecha_creacion)
          };
        })
      );
      
      console.log(`✅ ${result.rows.length} documentos encontrados en catálogo`);
      
      res.json({
        success: true,
        documentos: documentosConCategorias,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: total,
          pages: Math.ceil(total / parseInt(limit))
        }
      });
      
    } catch (error) {
      console.error('❌ Error obteniendo todos los documentos:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Error interno del servidor',
        details: error.message
      });
    }
  }

  // ========== 🔥 OBTENER ARTÍCULOS DISPONIBLES ==========
  async getArticulosDisponibles(req, res) {
    try {
      console.log('🔍 Obteniendo artículos disponibles en documentos');
      
      const result = await pool.query(
        `SELECT DISTINCT clasificacion_articulo 
         FROM documentos 
         WHERE clasificacion_articulo IS NOT NULL 
           AND clasificacion_articulo != ''
           AND eliminado = false
         ORDER BY clasificacion_articulo`
      );
      
      const articulos = result.rows.map(row => row.clasificacion_articulo);
      
      console.log(`✅ ${articulos.length} artículos encontrados:`, articulos);
      
      res.json({
        success: true,
        articulos
      });
      
    } catch (error) {
      console.error('❌ Error obteniendo artículos disponibles:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Error interno del servidor',
        details: error.message
      });
    }
  }
  
  // ========== OBTENER DOCUMENTO POR ID ==========
  async getDocumentById(req, res) {
    try {
      const { id } = req.params;
      
      console.log('🔍 Obteniendo documento ID:', id, {
        usuario: req.user.id
      });
      
      const result = await pool.query(
        `SELECT 
          d.*, 
          dep.nombre as departamento_nombre,
          dep.codigo as departamento_codigo,
          u.nombre_completo as subido_por_nombre,
          u.correo as subido_por_correo
         FROM documentos d
         LEFT JOIN departamentos dep ON d.departamento_id = dep.id
         LEFT JOIN usuarios u ON d.subido_por = u.id
         WHERE d.id = $1`,
        [id]
      );
      
      if (result.rows.length === 0) {
        return res.status(404).json({ 
          success: false, 
          error: 'Documento no encontrado' 
        });
      }
      
      const documento = result.rows[0];
      
      const puedeVer = req.user.departamento_id === documento.departamento_id || 
                      req.user.rol === 'administrador';
      
      if (!puedeVer && documento.eliminado) {
        return res.status(403).json({ 
          success: false, 
          error: 'No tienes permisos para ver este documento' 
        });
      }
      
      const categorias = await pool.query(
        `SELECT c.id, c.nombre, c.codigo, dc.fecha_asignacion
         FROM categorias_documento c
         JOIN documentos_categorias dc ON c.id = dc.categoria_id
         WHERE dc.documento_id = $1
         ORDER BY dc.fecha_asignacion DESC`,
        [id]
      );
      
      const historial = await pool.query(
        `SELECT 
          h.*, 
          u.nombre_completo as usuario_responsable_nombre,
          u.correo as usuario_responsable_correo
         FROM historial_documentos h
         LEFT JOIN usuarios u ON h.usuario_responsable_id = u.id
         WHERE h.documento_id = $1
         ORDER BY h.fecha DESC
         LIMIT 20`,
        [id]
      );
      
      const transferencias = await pool.query(
        `SELECT 
          t.*,
          d1.nombre as desde_departamento_nombre,
          d2.nombre as hacia_departamento_nombre,
          u.nombre_completo as transferido_por_nombre
         FROM transferencias_departamento t
         LEFT JOIN departamentos d1 ON t.desde_departamento_id = d1.id
         LEFT JOIN departamentos d2 ON t.hacia_departamento_id = d2.id
         LEFT JOIN usuarios u ON t.transferido_por = u.id
         WHERE t.documento_id = $1
         ORDER BY t.fecha_transferencia DESC`,
        [id]
      );
      
      console.log('✅ Documento obtenido exitosamente');
      
      res.json({
        success: true,
        documento: {
          ...documento,
          tamaño_archivo_formatted: formatBytes(documento.tamaño_archivo),
          fecha_creacion_formatted: formatDateForDisplay(documento.fecha_creacion),
          fecha_actualizacion_formatted: formatDateForDisplay(documento.fecha_actualizacion),
          fecha_vencimiento_formatted: documento.fecha_vencimiento 
            ? formatDateForDisplay(documento.fecha_vencimiento)
            : null,
          categorias: categorias.rows,
          historial: historial.rows,
          transferencias: transferencias.rows
        }
      });
      
    } catch (error) {
      console.error('❌ Error obteniendo documento:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Error interno del servidor al obtener documento',
        details: error.message
      });
    }
  }
  
// ========== DESCARGAR DOCUMENTO - VERSIÓN CORREGIDA PARA CATÁLOGO ==========
async downloadDocument(req, res) {
  try {
    const { id } = req.params;
    
    console.log('📥 Solicitud de descarga para documento ID:', id);
    console.log('👤 Usuario:', req.user.id, 'Rol:', req.user.rol, 'Depto:', req.user.departamento_id);
    
    const result = await pool.query(
      `SELECT d.*, dep.codigo as departamento_codigo 
       FROM documentos d 
       JOIN departamentos dep ON d.departamento_id = dep.id 
       WHERE d.id = $1 AND d.eliminado = false`,
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: 'Documento no encontrado o está eliminado' 
      });
    }
    
    const documento = result.rows[0];
    
    // 🔥 VERIFICACIÓN DE PERMISOS CORREGIDA PARA CATÁLOGO
    // Permitir descarga si:
    // 1. Es administrador (tiene todos los permisos)
    // 2. Es usuario normal (puede descargar cualquier documento del catálogo)
    // 3. Pertenece al mismo departamento (para documentos internos)
    
    let puedeDescargar = false;
    
    if (req.user.rol === 'administrador') {
      // Administrador puede descargar cualquier documento
      puedeDescargar = true;
      console.log('👑 Admin: Permiso concedido');
    } else {
      // Usuarios normales pueden descargar cualquier documento del catálogo
      // (sin restricción de departamento)
      puedeDescargar = true;
      console.log('👤 Usuario normal: Permiso concedido para catálogo');
    }
    
    // Opcional: Si quieres restringir documentos eliminados o archivados
    if (documento.eliminado) {
      console.log('❌ Documento eliminado, no se puede descargar');
      return res.status(403).json({ 
        success: false, 
        error: 'Este documento ha sido eliminado' 
      });
    }
    
    if (!puedeDescargar) {
      console.log('❌ Acceso denegado al documento:', documento.id);
      return res.status(403).json({ 
        success: false, 
        error: 'No tienes permisos para descargar este documento' 
      });
    }
    
    console.log('✅ Permiso concedido para descargar documento:', documento.id);
    
    console.log('\n🔍 DATOS DEL DOCUMENTO:');
    console.log(`   ID: ${documento.id}`);
    console.log(`   TÍTULO (de BD): "${documento.titulo}"`);
    console.log(`   Nombre original: "${documento.nombre_archivo_original}"`);
    console.log(`   Nombre en FTP: "${documento.nombre_archivo_sistema}"`);
    console.log(`   Extensión: "${documento.extension}"`);
    
    // Obtener la extensión correcta
    let extension = documento.extension;
    if (!extension || extension === '') {
      const extMatch = documento.nombre_archivo_original.match(/\.([^.]+)$/);
      extension = extMatch ? extMatch[1] : 'pdf';
      console.log(`   Extensión (deducida): "${extension}"`);
    }
    
    // Generar nombre para descarga usando el título de la BD
    let nombreBase = documento.titulo
      .trim()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // Eliminar acentos
      .replace(/[^a-zA-Z0-9\s\-_]/g, '') // Eliminar caracteres especiales
      .replace(/\s+/g, '_'); // Reemplazar espacios por _
    
    if (nombreBase.length > 200) {
      nombreBase = nombreBase.substring(0, 200);
    }
    
    const nombreArchivoDescarga = `${nombreBase}.${extension}`;
    
    console.log(`\n📄 NOMBRE PARA DESCARGA: "${nombreArchivoDescarga}"`);
    
    const tempDir = path.join(__dirname, '../temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    const tempFilePath = path.join(tempDir, `${Date.now()}_${documento.nombre_archivo_sistema}`);
    
    try {
      await ftpService.downloadFile(documento.ruta_archivo, tempFilePath);
      
      console.log(`📤 Enviando archivo como: ${nombreArchivoDescarga}`);
      
      // Enviar el archivo
      res.download(tempFilePath, nombreArchivoDescarga, (err) => {
        // Limpiar archivo temporal después de enviar
        if (fs.existsSync(tempFilePath)) {
          fs.unlinkSync(tempFilePath);
        }
        
        if (err) {
          console.error('❌ Error al enviar archivo:', err);
          if (!res.headersSent) {
            res.status(500).json({ error: 'Error al descargar el archivo' });
          }
        } else {
          console.log(`✅ Archivo descargado exitosamente como: ${nombreArchivoDescarga}`);
        }
      });
      
    } catch (ftpError) {
      console.error('❌ Error descargando del FTP:', ftpError);
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
      return res.status(500).json({ 
        success: false, 
        error: 'Error al descargar el archivo del servidor FTP' 
      });
    }
    
  } catch (error) {
    console.error('❌ Error en descarga de documento:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Error interno del servidor al descargar documento',
      details: error.message
    });
  }
}
  // ========== EDITAR DOCUMENTO ==========
  async updateDocument(req, res) {
    const client = await pool.connect();
    try {
      const { id } = req.params;
      const { 
        titulo, 
        descripcion, 
        archivado, 
        categoria_ids,
        clasificacion_articulo,
        clasificacion_fraccion,
        clasificacion_anio,
        clasificacion_periodo
      } = req.body;
      const nuevoArchivo = req.file;
      
      console.log('✏️ ===== INICIANDO ACTUALIZACIÓN DE DOCUMENTO =====');
      console.log(`   📄 Documento ID: ${id}`);
      console.log(`   📄 Usuario: ${req.user.id}`);
      console.log(`   📄 Cambios:`, { 
        titulo, 
        archivado, 
        categorias: categoria_ids,
        tieneNuevoArchivo: !!nuevoArchivo,
        clasificacion: {
          articulo: clasificacion_articulo,
          fraccion: clasificacion_fraccion,
          anio: clasificacion_anio,
          periodo: clasificacion_periodo
        }
      });
      
      const ipAddress = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress || '127.0.0.1';
      await client.query(`SET LOCAL app.usuario_id = '${req.user.id}'`);
      await client.query(`SET LOCAL app.ip_address = '${ipAddress}'`);
      
      await client.query('BEGIN');
      
      const docResult = await client.query(
        `SELECT d.* 
         FROM documentos d 
         WHERE d.id = $1 AND d.eliminado = false`,
        [id]
      );
      
      if (docResult.rows.length === 0) {
        if (nuevoArchivo) fs.unlinkSync(nuevoArchivo.path);
        await client.query('ROLLBACK');
        client.release();
        return res.status(404).json({ 
          success: false, 
          error: 'Documento no encontrado o está eliminado' 
        });
      }
      
      const documento = docResult.rows[0];
      
      const puedeEditar = req.user.id === documento.subido_por || 
                         req.user.rol === 'administrador' ||
                         (req.user.rol === 'jefe' && req.user.departamento_id === documento.departamento_id);
      
      if (!puedeEditar) {
        if (nuevoArchivo) fs.unlinkSync(nuevoArchivo.path);
        await client.query('ROLLBACK');
        client.release();
        return res.status(403).json({ 
          success: false, 
          error: 'No tienes permisos para editar este documento' 
        });
      }
      
      let nuevoArchivoInfo = null;
      let archivoViejoAEliminar = null;
      let archivoRenombrado = false;
      
      // CASO 1: SE SUBIÓ UN NUEVO ARCHIVO
      if (nuevoArchivo) {
        console.log('🔄 CASO 1: Se subió nuevo archivo para reemplazar');
        console.log(`   📄 Archivo nuevo: ${nuevoArchivo.originalname}`);
        
        const espacioResult = await client.query(
          `SELECT 
            COALESCE(usado_bytes, 0) as usado_bytes, 
            COALESCE(limite_bytes, 5368709120) as limite_bytes 
           FROM espacio_almacenamiento 
           WHERE departamento_id = $1`,
          [documento.departamento_id]
        );
        
        let espacioUsado = 0;
        let espacioLimite = 5368709120;
        
        if (espacioResult.rows.length > 0) {
          espacioUsado = parseInt(espacioResult.rows[0].usado_bytes);
          espacioLimite = parseInt(espacioResult.rows[0].limite_bytes);
        }
        
        const nuevoEspacio = espacioUsado - documento.tamaño_archivo + nuevoArchivo.size;
        
        if (nuevoEspacio > espacioLimite) {
          fs.unlinkSync(nuevoArchivo.path);
          await client.query('ROLLBACK');
          client.release();
          return res.status(400).json({ 
            success: false, 
            error: `Espacio de almacenamiento insuficiente. Necesitas ${formatBytes(nuevoEspacio - espacioLimite)} más` 
          });
        }
        
        const currentDir = path.dirname(documento.ruta_archivo);
        const fileExtension = path.extname(nuevoArchivo.originalname).toLowerCase();
        
        const tituloParaNombre = titulo && titulo !== documento.titulo ? titulo : documento.titulo;
        
        const cleanTitle = tituloParaNombre
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-zA-Z0-9\s_-]/g, '')
          .replace(/\s+/g, '_')
          .substring(0, 100);
        
        let finalFileName = `${cleanTitle}${fileExtension}`;
        let baseName = cleanTitle;
        let counter = 0;
        
        while (await ftpService.fileExists(currentDir, finalFileName)) {
          if (finalFileName === documento.nombre_archivo_sistema) {
            console.log('📁 El nombre del archivo no cambia, se reemplazará el existente');
            break;
          }
          counter++;
          finalFileName = `${baseName}${counter}${fileExtension}`;
          console.log(`   ⚠️ El nombre ya existe, intentando: ${finalFileName}`);
        }
        
        console.log(`📁 Nombre para nuevo archivo: ${finalFileName}`);
        
        const tempDir = path.dirname(nuevoArchivo.path);
        const newTempPath = path.join(tempDir, finalFileName);
        fs.renameSync(nuevoArchivo.path, newTempPath);
        
        const uploadResult = await ftpService.uploadFile(
          newTempPath, 
          currentDir,
          finalFileName
        );
        
        nuevoArchivoInfo = {
          ruta_archivo: uploadResult.fullPath,
          nombre_archivo_sistema: finalFileName,
          nombre_archivo_original: nuevoArchivo.originalname,
          tamaño_archivo: nuevoArchivo.size,
          tipo_archivo: nuevoArchivo.mimetype,
          extension: fileExtension.substring(1)
        };
        
        archivoViejoAEliminar = documento.ruta_archivo;
        
        if (fs.existsSync(newTempPath)) {
          fs.unlinkSync(newTempPath);
        }
        
        console.log(`✅ Nuevo archivo procesado: ${finalFileName}`);
      }
      
    // CASO 2: SOLO CAMBIA EL TÍTULO (renombrado sin cambiar archivo físico)
if (titulo && titulo !== documento.titulo) {
  console.log('🔄 CASO 2: Renombrando archivo por cambio de título');
  console.log(`   📄 Título anterior: "${documento.titulo}"`);
  console.log(`   📄 Título nuevo: "${titulo}"`);
  console.log(`   📄 Archivo actual: ${documento.nombre_archivo_sistema}`);
  console.log(`   📄 ¿Hay nuevo archivo? ${nuevoArchivo ? 'SÍ' : 'NO'}`);
  
  // 🔥 Obtener la ruta del directorio actual (sin el nombre del archivo)
  const currentDir = path.dirname(documento.ruta_archivo);
  const fileExtension = path.extname(documento.nombre_archivo_sistema).toLowerCase();
  
  // 🔥 Generar nuevo nombre de archivo basado en el nuevo título
  const cleanTitle = titulo
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9\s_-]/g, '')
    .replace(/\s+/g, '_')
    .substring(0, 100);
  
  let finalFileName = `${cleanTitle}${fileExtension}`;
  let baseName = cleanTitle;
  let counter = 0;
  
  console.log(`   📁 Directorio actual: ${currentDir}`);
  console.log(`   📄 Nombre sugerido: ${finalFileName}`);
  
  // 🔥 Verificar si el nuevo nombre ya existe en el mismo directorio
  let nombreUnico = false;
  while (!nombreUnico) {
    try {
      const exists = await ftpService.fileExists(currentDir, finalFileName);
      console.log(`   🔍 Verificando si existe: ${finalFileName} -> ${exists ? 'SÍ' : 'NO'}`);
      
      if (!exists) {
        nombreUnico = true;
        break;
      }
      counter++;
      finalFileName = `${baseName}${counter}${fileExtension}`;
      console.log(`   ⚠️ El nombre ya existe, intentando: ${finalFileName}`);
    } catch (err) {
      console.log(`   ⚠️ Error verificando, asumiendo que no existe: ${err.message}`);
      nombreUnico = true;
    }
  }
  
  // 🔥 Construir rutas completa antigua y nueva
  const oldFullPath = documento.ruta_archivo;
  const newFullPath = `${currentDir}/${finalFileName}`.replace(/\\/g, '/');
  
  console.log(`   📂 Ruta antigua: ${oldFullPath}`);
  console.log(`   📂 Ruta nueva: ${newFullPath}`);
  
  // 🔥 Solo renombrar si el nombre realmente cambió
  if (oldFullPath !== newFullPath) {
    try {
      // Verificar si el archivo origen existe antes de renombrar
      console.log('🔍 Verificando existencia del archivo origen...');
      const archivoExiste = await ftpService.fileExists(oldFullPath);
      
      if (!archivoExiste) {
        console.log('⚠️ EL ARCHIVO ORIGEN NO EXISTE EN FTP');
        console.log('   Solo se actualizará la base de datos');
        
        // Actualizar solo la base de datos
        if (!nuevoArchivoInfo) {
          nuevoArchivoInfo = {
            ruta_archivo: newFullPath,
            nombre_archivo_sistema: finalFileName,
            nombre_archivo_original: documento.nombre_archivo_original,
            tamaño_archivo: documento.tamaño_archivo,
            tipo_archivo: documento.tipo_archivo,
            extension: fileExtension.substring(1)
          };
        }
      } else {
        // 🔥 Intentar renombrar en FTP
        console.log('🔄 Ejecutando renameFile() en FTP...');
        const renameResult = await ftpService.renameFile(oldFullPath, newFullPath);
        
        if (renameResult && renameResult.success) {
          console.log('✅ Renombrado exitoso en FTP');
          archivoRenombrado = true;
          
          if (!nuevoArchivoInfo) {
            nuevoArchivoInfo = {
              ruta_archivo: renameResult.newPath,
              nombre_archivo_sistema: finalFileName,
              nombre_archivo_original: documento.nombre_archivo_original,
              tamaño_archivo: documento.tamaño_archivo,
              tipo_archivo: documento.tipo_archivo,
              extension: fileExtension.substring(1)
            };
          }
          console.log(`✅ Archivo renombrado exitosamente: ${oldFullPath} → ${newFullPath}`);
        } else {
          throw new Error('renameFile no devolvió éxito');
        }
      }
    } catch (renameError) {
      console.error('❌ Error renombrando archivo:', renameError.message);
      console.log('⚠️ Continuando con actualización de BD...');
      
      // Actualizar base de datos aunque el renombrado físico haya fallado
      if (!nuevoArchivoInfo) {
        nuevoArchivoInfo = {
          ruta_archivo: newFullPath,
          nombre_archivo_sistema: finalFileName,
          nombre_archivo_original: documento.nombre_archivo_original,
          tamaño_archivo: documento.tamaño_archivo,
          tipo_archivo: documento.tipo_archivo,
          extension: fileExtension.substring(1)
        };
      }
    }
  } else {
    console.log('📁 El nombre del archivo no cambió, no es necesario renombrar');
  }
}
      
      // CASO 3: CAMBIO DE UBICACIÓN - CORREGIDO
      const ubicacionCambiada = 
        (clasificacion_articulo !== undefined && clasificacion_articulo !== documento.clasificacion_articulo) ||
        (clasificacion_fraccion !== undefined && clasificacion_fraccion !== documento.clasificacion_fraccion) ||
        (clasificacion_anio !== undefined && clasificacion_anio !== documento.clasificacion_anio) ||
        (clasificacion_periodo !== undefined && clasificacion_periodo !== documento.clasificacion_periodo);

      if (ubicacionCambiada && !nuevoArchivo) {
        console.log('🔄 CASO 3: Cambio de ubicación - moviendo archivo en FTP');
        
        const nuevoArticulo = clasificacion_articulo !== undefined ? clasificacion_articulo : documento.clasificacion_articulo;
        const nuevaFraccion = clasificacion_fraccion !== undefined ? clasificacion_fraccion : documento.clasificacion_fraccion;
        const nuevoAnio = clasificacion_anio !== undefined ? clasificacion_anio : documento.clasificacion_anio;
        const nuevoPeriodo = clasificacion_periodo !== undefined ? clasificacion_periodo : documento.clasificacion_periodo;
        
        let nuevaRutaRelativa = `articulo_${nuevoArticulo}/fraccion_${nuevaFraccion}`;
        
        if (nuevoAnio) {
          nuevaRutaRelativa += `/${nuevoAnio}`;
          if (nuevoPeriodo) {
            const carpetaPeriodo = nuevoPeriodo
              .toLowerCase()
              .replace(/\s+/g, '_')
              .replace(/[áéíóú]/g, (match) => {
                const map = { 'á': 'a', 'é': 'e', 'í': 'i', 'ó': 'o', 'ú': 'u' };
                return map[match] || match;
              });
            nuevaRutaRelativa += `/${carpetaPeriodo}`;
          }
        }
        
        const nombreArchivo = path.basename(documento.ruta_archivo);
        
        // 🔥 CORREGIDO: Usar ftpService.basePath en lugar de '/uploads' fijo
        const nuevaRutaCompleta = `${ftpService.basePath}/${nuevaRutaRelativa}/${nombreArchivo}`;
        
        console.log(`   📂 Ruta antigua: ${documento.ruta_archivo}`);
        console.log(`   📂 Ruta nueva: ${nuevaRutaCompleta}`);
        console.log(`   📂 Usando basePath: ${ftpService.basePath}`);
        
        try {
          const renameResult = await ftpService.renameFile(documento.ruta_archivo, nuevaRutaCompleta);
          console.log('✅ Archivo movido exitosamente en FTP:', renameResult);
          
          nuevoArchivoInfo = {
            ruta_archivo: nuevaRutaCompleta,
            nombre_archivo_sistema: nombreArchivo,
            nombre_archivo_original: documento.nombre_archivo_original,
            tamaño_archivo: documento.tamaño_archivo,
            tipo_archivo: documento.tipo_archivo,
            extension: documento.extension
          };
          
        } catch (moveError) {
          console.error('❌ Error moviendo archivo en FTP:', moveError);
          throw new Error(`Error al mover archivo: ${moveError.message}`);
        }
      }
      
      // ========== ACTUALIZAR BASE DE DATOS ==========
      const updateFields = [];
      const updateValues = [];
      let paramCount = 1;
      
      if (titulo !== undefined && titulo !== documento.titulo) {
        updateFields.push(`titulo = $${paramCount}`);
        updateValues.push(titulo.trim());
        paramCount++;
      }
      
      if (descripcion !== undefined) {
        const newDesc = descripcion?.trim() || null;
        if (newDesc !== documento.descripcion) {
          updateFields.push(`descripcion = $${paramCount}`);
          updateValues.push(newDesc);
          paramCount++;
        }
      }
      
      if (archivado !== undefined) {
        const newArchivado = archivado === true || archivado === 'true';
        if (newArchivado !== documento.archivado) {
          updateFields.push(`archivado = $${paramCount}`);
          updateValues.push(newArchivado);
          paramCount++;
        }
      }
      
      if (clasificacion_articulo !== undefined && clasificacion_articulo !== documento.clasificacion_articulo) {
        updateFields.push(`clasificacion_articulo = $${paramCount}`);
        updateValues.push(clasificacion_articulo);
        paramCount++;
      }
      
      if (clasificacion_fraccion !== undefined && clasificacion_fraccion !== documento.clasificacion_fraccion) {
        updateFields.push(`clasificacion_fraccion = $${paramCount}`);
        updateValues.push(clasificacion_fraccion);
        paramCount++;
      }
      
      if (clasificacion_anio !== undefined && clasificacion_anio !== documento.clasificacion_anio) {
        updateFields.push(`clasificacion_anio = $${paramCount}`);
        updateValues.push(clasificacion_anio);
        paramCount++;
      }
      
      if (clasificacion_periodo !== undefined && clasificacion_periodo !== documento.clasificacion_periodo) {
        updateFields.push(`clasificacion_periodo = $${paramCount}`);
        updateValues.push(clasificacion_periodo);
        paramCount++;
      }
      
      if (nuevoArchivoInfo) {
        updateFields.push(`ruta_archivo = $${paramCount}`);
        updateValues.push(nuevoArchivoInfo.ruta_archivo);
        paramCount++;
        
        updateFields.push(`nombre_archivo_sistema = $${paramCount}`);
        updateValues.push(nuevoArchivoInfo.nombre_archivo_sistema);
        paramCount++;
        
        updateFields.push(`nombre_archivo_original = $${paramCount}`);
        updateValues.push(nuevoArchivoInfo.nombre_archivo_original);
        paramCount++;
        
        updateFields.push(`tamaño_archivo = $${paramCount}`);
        updateValues.push(nuevoArchivoInfo.tamaño_archivo);
        paramCount++;
        
        updateFields.push(`tipo_archivo = $${paramCount}`);
        updateValues.push(nuevoArchivoInfo.tipo_archivo);
        paramCount++;
        
        updateFields.push(`extension = $${paramCount}`);
        updateValues.push(nuevoArchivoInfo.extension);
        paramCount++;
      }
      
      if (updateFields.length === 0 && categoria_ids === undefined) {
        if (nuevoArchivo) fs.unlinkSync(nuevoArchivo.path);
        await client.query('ROLLBACK');
        client.release();
        return res.status(400).json({ 
          success: false, 
          error: 'No se proporcionaron cambios para actualizar' 
        });
      }
      
      updateFields.push(`fecha_actualizacion = CURRENT_TIMESTAMP`);
      updateValues.push(id);
      
      const updateQuery = `
        UPDATE documentos 
        SET ${updateFields.join(', ')} 
        WHERE id = $${paramCount}
        RETURNING *
      `;
      
      const result = await client.query(updateQuery, updateValues);
      const documentoActualizado = result.rows[0];
      
      console.log('✅ Documento actualizado en base de datos');
      
      if (categoria_ids !== undefined) {
        console.log('🔄 Actualizando categorías...');
        
        await client.query(
          'DELETE FROM documentos_categorias WHERE documento_id = $1',
          [id]
        );
        
        if (Array.isArray(categoria_ids) && categoria_ids.length > 0) {
          const idsValidos = categoria_ids
            .map(id => typeof id === 'string' ? parseInt(id, 10) : id)
            .filter(id => !isNaN(id) && id > 0);
          
          if (idsValidos.length > 0) {
            for (const categoriaId of idsValidos) {
              await client.query(
                `INSERT INTO documentos_categorias 
                 (documento_id, categoria_id, fecha_asignacion) 
                 VALUES ($1, $2, CURRENT_TIMESTAMP)
                 ON CONFLICT (documento_id, categoria_id) DO NOTHING`,
                [id, categoriaId]
              );
            }
            
            console.log(`✅ ${idsValidos.length} categorías asociadas`);
          }
        }
      }
      
      if (nuevoArchivoInfo) {
        const diferenciaTamaño = nuevoArchivoInfo.tamaño_archivo - documento.tamaño_archivo;
        
        if (diferenciaTamaño !== 0) {
          await client.query(
            `UPDATE espacio_almacenamiento 
             SET usado_bytes = GREATEST(0, COALESCE(usado_bytes, 0) + $1),
                 fecha_calculo = CURRENT_TIMESTAMP
             WHERE departamento_id = $2`,
            [diferenciaTamaño, documento.departamento_id]
          );
          
          console.log(`📊 Espacio actualizado: ${diferenciaTamaño > 0 ? '+' : ''}${formatBytes(diferenciaTamaño)}`);
        }
      }
      
      await client.query('COMMIT');
      client.release();
      
      if (archivoViejoAEliminar && archivoViejoAEliminar !== nuevoArchivoInfo?.ruta_archivo) {
        try {
          await ftpService.deleteFile(archivoViejoAEliminar);
          console.log(`✅ Archivo viejo eliminado del FTP: ${archivoViejoAEliminar}`);
        } catch (deleteError) {
          console.error('❌ Error eliminando archivo viejo:', deleteError.message);
        }
      }
      
      const docCompleto = await pool.query(
        `SELECT d.*, 
          dep.nombre as departamento_nombre,
          u.nombre_completo as subido_por_nombre
         FROM documentos d
         LEFT JOIN departamentos dep ON d.departamento_id = dep.id
         LEFT JOIN usuarios u ON d.subido_por = u.id
         WHERE d.id = $1`,
        [id]
      );
      
      const categoriasDoc = await pool.query(
        `SELECT c.id, c.nombre, c.codigo, dc.fecha_asignacion
         FROM categorias_documento c
         JOIN documentos_categorias dc ON c.id = dc.categoria_id
         WHERE dc.documento_id = $1
         ORDER BY dc.fecha_asignacion DESC`,
        [id]
      );
      
      console.log(`✅ ===== ACTUALIZACIÓN COMPLETADA =====`);
      console.log(`   📄 ID: ${id}`);
      console.log(`   📄 Título: ${documentoActualizado.titulo}`);
      console.log(`   📄 Archivo: ${documentoActualizado.nombre_archivo_sistema}`);
      console.log(`   📄 Clasificación: ${documentoActualizado.clasificacion_articulo}/${documentoActualizado.clasificacion_fraccion}/${documentoActualizado.clasificacion_anio}/${documentoActualizado.clasificacion_periodo}`);
      console.log(`   📄 Renombrado: ${archivoRenombrado ? 'SÍ' : 'NO'}`);
      
      res.json({
        success: true,
        message: 'Documento actualizado correctamente' + 
                 (nuevoArchivo ? ' (archivo reemplazado)' : '') +
                 (archivoRenombrado ? ' (archivo renombrado)' : ''),
        documento: {
          ...docCompleto.rows[0],
          categorias: categoriasDoc.rows,
          tamaño_archivo_formatted: formatBytes(documentoActualizado.tamaño_archivo),
          fecha_actualizacion_formatted: formatDateForDisplay(documentoActualizado.fecha_actualizacion)
        }
      });
      
    } catch (error) {
      console.error('❌ Error actualizando documento:', error);
      
      if (client) {
        try {
          await client.query('ROLLBACK');
          client.release();
        } catch (rollbackError) {
          console.error('Error en rollback:', rollbackError);
        }
      }
      
      if (req.file && fs.existsSync(req.file.path)) {
        try {
          fs.unlinkSync(req.file.path);
        } catch (unlinkError) {
          console.error('Error eliminando archivo temporal:', unlinkError);
        }
      }
      
      res.status(500).json({ 
        success: false, 
        error: 'Error interno del servidor al actualizar documento',
        details: error.message
      });
    }
  }
  
  // ========== TRANSFERIR DOCUMENTO ==========
/**
 * Transferir documento entre departamentos
 */
async transferDocument(req, res) {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { hacia_departamento_id, motivo } = req.body;
    
    console.log('🔄 Iniciando transferencia:', {
      documento_id: id,
      hacia_departamento: hacia_departamento_id,
      usuario: req.user.id,
      rol: req.user.rol
    });
    
    if (!hacia_departamento_id) {
      client.release();
      return res.status(400).json({ 
        success: false, 
        error: 'El departamento destino es requerido' 
      });
    }
    
    const ipAddress = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress || '127.0.0.1';
    await client.query(`SET LOCAL app.usuario_id = '${req.user.id}'`);
    await client.query(`SET LOCAL app.ip_address = '${ipAddress}'`);
    
    await client.query('BEGIN');
    
    // 🔥 CONSULTA CORREGIDA: Los administradores pueden transferir CUALQUIER documento
    let query = `
      SELECT d.*, dep.nombre as departamento_actual 
      FROM documentos d 
      JOIN departamentos dep ON d.departamento_id = dep.id 
      WHERE d.id = $1 AND d.eliminado = false
    `;
    
    const params = [id];
    
    // Solo verificar departamento si NO es administrador
    if (req.user.rol !== 'administrador') {
      query += ` AND d.departamento_id = $2`;
      params.push(req.user.departamento_id);
    }
    
    const docResult = await client.query(query, params);
    
    if (docResult.rows.length === 0) {
      await client.query('ROLLBACK');
      client.release();
      
      if (req.user.rol === 'administrador') {
        return res.status(404).json({ 
          success: false, 
          error: 'Documento no encontrado o está eliminado' 
        });
      } else {
        return res.status(404).json({ 
          success: false, 
          error: 'Documento no encontrado en tu departamento' 
        });
      }
    }
    
    const documento = docResult.rows[0];
    const desde_departamento_id = documento.departamento_id;
    
    // Verificar que el destino sea diferente al origen
    if (parseInt(hacia_departamento_id) === desde_departamento_id) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(400).json({ 
        success: false, 
        error: 'No puedes transferir al mismo departamento' 
      });
    }
    
    // Verificar que el departamento destino existe y está activo
    const deptResult = await client.query(
      'SELECT * FROM departamentos WHERE id = $1 AND activo = true',
      [hacia_departamento_id]
    );
    
    if (deptResult.rows.length === 0) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(400).json({ 
        success: false, 
        error: 'Departamento destino no encontrado o inactivo' 
      });
    }
    
    const departamentoDestino = deptResult.rows[0];
    
    // Actualizar el departamento del documento
    await client.query(
      `UPDATE documentos 
       SET departamento_id = $1, 
           fecha_actualizacion = CURRENT_TIMESTAMP 
       WHERE id = $2`,
      [hacia_departamento_id, id]
    );
    
    console.log('✅ Documento actualizado con nuevo departamento');
    
    // Registrar en historial de transferencias
    await client.query(
      `INSERT INTO transferencias_departamento (
        documento_id, desde_departamento_id, hacia_departamento_id, 
        transferido_por, motivo, transferencia_masiva
      ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        id,
        desde_departamento_id,
        hacia_departamento_id,
        req.user.id,
        motivo?.trim() || 'Transferencia administrativa',
        false
      ]
    );
    
    // Actualizar espacio de almacenamiento (restar del origen)
    await client.query(
      `UPDATE espacio_almacenamiento 
       SET usado_bytes = GREATEST(0, COALESCE(usado_bytes, 0) - $1),
           fecha_calculo = CURRENT_TIMESTAMP
       WHERE departamento_id = $2`,
      [documento.tamaño_archivo, desde_departamento_id]
    );
    
    // Agregar espacio al destino
    await client.query(
      `INSERT INTO espacio_almacenamiento (departamento_id, usado_bytes, limite_bytes)
       VALUES ($1, $2, 5368709120)
       ON CONFLICT (departamento_id) 
       DO UPDATE SET 
         usado_bytes = espacio_almacenamiento.usado_bytes + $2,
         fecha_calculo = CURRENT_TIMESTAMP`,
      [hacia_departamento_id, documento.tamaño_archivo]
    );
    
    await client.query('COMMIT');
    client.release();
    
    console.log('✅ Transferencia completada exitosamente');
    
    res.json({
      success: true,
      message: 'Documento transferido exitosamente',
      documento_id: id,
      detalles: {
        desde: documento.departamento_actual,
        hacia: departamentoDestino.nombre,
        fecha: new Date().toISOString()
      }
    });
    
  } catch (error) {
    console.error('❌ Error transfiriendo documento:', error);
    
    if (client) {
      try {
        await client.query('ROLLBACK');
        client.release();
      } catch (rollbackError) {
        console.error('Error en rollback:', rollbackError);
      }
    }
    
    res.status(500).json({ 
      success: false, 
      error: 'Error interno del servidor al transferir documento',
      details: error.message
    });
  }
}
  
// ========== ELIMINAR DOCUMENTO ==========
async deleteDocument(req, res) {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { permanente = false } = req.query;
    
    console.log('\n🗑️ ===== SOLICITUD DE ELIMINACIÓN =====');
    console.log('   Documento ID:', id);
    console.log('   Permanente:', permanente === 'true');
    console.log('   Usuario:', req.user.id);
    console.log('   Rol:', req.user.rol);
    
    const ipAddress = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress || '127.0.0.1';
    await client.query(`SET LOCAL app.usuario_id = '${req.user.id}'`);
    await client.query(`SET LOCAL app.ip_address = '${ipAddress}'`);
    
    await client.query('BEGIN');
    
    // Obtener documento con toda la información necesaria
    const docResult = await client.query(
      `SELECT d.*, 
              dep.nombre as departamento_nombre,
              u.nombre_completo as subido_por_nombre
       FROM documentos d
       LEFT JOIN departamentos dep ON d.departamento_id = dep.id
       LEFT JOIN usuarios u ON d.subido_por = u.id
       WHERE d.id = $1`,
      [id]
    );
    
    if (docResult.rows.length === 0) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(404).json({ 
        success: false, 
        error: 'Documento no encontrado' 
      });
    }
    
    const documento = docResult.rows[0];
    
    // Verificar permisos
    const puedeEliminar = req.user.id === documento.subido_por || 
                         req.user.rol === 'administrador' ||
                         (req.user.rol === 'jefe' && req.user.departamento_id === documento.departamento_id);
    
    if (!puedeEliminar) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(403).json({ 
        success: false, 
        error: 'No tienes permisos para eliminar este documento' 
      });
    }
    
// ELIMINACIÓN FÍSICA (solo admin)
if (permanente === 'true' && req.user.rol === 'administrador') {
  console.log('🔥 ELIMINACIÓN FÍSICA por administrador');
  console.log('📦 Documento a eliminar:', {
    id: documento.id,
    titulo: documento.titulo,
    ruta_archivo: documento.ruta_archivo,
    tamaño: documento.tamaño_archivo
  });
  
  // Guardar información antes de eliminar
  const rutaArchivoFTP = documento.ruta_archivo;
  const tamanioArchivo = documento.tamaño_archivo;
  const departamentoId = documento.departamento_id;
  
  // ========== 🔥 ORDEN CORRECTO: PRIMERO ELIMINAR RELACIONES ==========
  console.log('📦 Eliminando registros relacionados...');
  
  // 1. Eliminar historial MANUALMENTE (ANTES de eliminar el documento)
  await client.query(
    'DELETE FROM historial_documentos WHERE documento_id = $1',
    [id]
  );
  console.log('   ✅ Historial eliminado');
  
  // 2. Eliminar categorías
  await client.query(
    'DELETE FROM documentos_categorias WHERE documento_id = $1',
    [id]
  );
  console.log('   ✅ Categorías eliminadas');
  
  // 3. Eliminar transferencias
  await client.query(
    'DELETE FROM transferencias_departamento WHERE documento_id = $1',
    [id]
  );
  console.log('   ✅ Transferencias eliminadas');
  
  // 4. AHORA SÍ, eliminar el documento (ya no hay restricciones)
  console.log('   🗑️ Eliminando documento de la BD...');
  const deleteResult = await client.query(
    'DELETE FROM documentos WHERE id = $1 RETURNING *',
    [id]
  );
  
  if (deleteResult.rows.length === 0) {
    throw new Error('No se pudo eliminar el documento de la BD');
  }
  
  console.log('   ✅ Documento eliminado de BD');
  
  // 5. Actualizar espacio de almacenamiento
  await client.query(
    `UPDATE espacio_almacenamiento 
     SET usado_bytes = GREATEST(0, COALESCE(usado_bytes, 0) - $1),
         fecha_calculo = CURRENT_TIMESTAMP
     WHERE departamento_id = $2`,
    [tamanioArchivo, departamentoId]
  );
  console.log('   ✅ Espacio actualizado');
  
  // 6. Hacer COMMIT de la transacción
  await client.query('COMMIT');
  console.log('✅ COMMIT exitoso - Documento eliminado de BD');
  client.release();
  
  // 7. Eliminar archivo FTP (después del COMMIT exitoso)
  let ftpResult = { success: false, message: 'No se intentó' };
  
  if (rutaArchivoFTP) {
    try {
      console.log(`📂 Eliminando archivo FTP: ${rutaArchivoFTP}`);
      ftpResult = await ftpService.deleteFile(rutaArchivoFTP);
      
      if (ftpResult.success) {
        console.log(`✅ Archivo eliminado del FTP exitosamente`);
        console.log(`   Método: ${ftpResult.metodo || 'directo'}`);
        console.log(`   Ruta: ${ftpResult.path || rutaArchivoFTP}`);
      } else {
        console.log(`⚠️ No se pudo eliminar el archivo FTP: ${ftpResult.message}`);
      }
      
    } catch (ftpError) {
      console.error('❌ Error eliminando archivo del FTP:', ftpError.message);
      ftpResult = { success: false, error: ftpError.message };
    }
  }
  
  console.log('✅✅✅ Documento eliminado permanentemente del sistema');
  
  res.json({
    success: true,
    message: ftpResult.success 
      ? 'Documento ELIMINADO PERMANENTEMENTE del sistema (FTP + BD)'
      : 'Documento ELIMINADO de BD pero hubo problemas con el archivo FTP',
    eliminacion: 'fisica',
    documento_id: id,
    espacio_liberado: formatBytes(tamanioArchivo),
    ftp_eliminado: ftpResult.success || false,
    ftp_detalle: ftpResult
  });
  
} else {
  // ELIMINACIÓN LÓGICA (mover a papelera)
  console.log('📦 Eliminación lógica (mover a papelera)');
  
  if (documento.eliminado) {
    await client.query('ROLLBACK');
    client.release();
    return res.status(400).json({ 
      success: false, 
      error: 'El documento ya está eliminado' 
    });
  }
  
  await client.query(
    `UPDATE documentos 
     SET eliminado = true, 
         fecha_actualizacion = CURRENT_TIMESTAMP 
     WHERE id = $1`,
    [id]
  );
  
  await client.query('COMMIT');
  client.release();
  
  console.log('✅ Documento movido a papelera');
  
  res.json({
    success: true,
    message: 'Documento movido a la papelera. Puede ser restaurado posteriormente.',
    eliminacion: 'logica',
    documento_id: id,
    puede_restaurar: true,
    fecha_eliminacion: new Date().toISOString()
  });
}
    
  } catch (error) {
    console.error('❌ Error eliminando documento:');
    console.error('   Mensaje:', error.message);
    console.error('   Stack:', error.stack);
    
    if (client) {
      try {
        await client.query('ROLLBACK');
        client.release();
      } catch (rollbackError) {
        console.error('Error en rollback:', rollbackError);
      }
    }
    
    res.status(500).json({ 
      success: false, 
      error: 'Error interno del servidor al eliminar documento',
      details: error.message
    });
  }
}
  
  // ========== RESTAURAR DOCUMENTO ==========
  async restoreDocument(req, res) {
    const client = await pool.connect();
    try {
      const { id } = req.params;
      
      console.log('♻️ Restaurando documento ID:', id, {
        usuario: req.user.id,
        rol: req.user.rol
      });
      
      const ipAddress = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress || '127.0.0.1';
      await client.query(`SET LOCAL app.usuario_id = '${req.user.id}'`);
      await client.query(`SET LOCAL app.ip_address = '${ipAddress}'`);
      
      await client.query('BEGIN');
      
      const docResult = await client.query(
        'SELECT * FROM documentos WHERE id = $1 AND eliminado = true',
        [id]
      );
      
      if (docResult.rows.length === 0) {
        await client.query('ROLLBACK');
        client.release();
        return res.status(404).json({ 
          success: false, 
          error: 'Documento no encontrado o no está eliminado' 
        });
      }
      
      const documento = docResult.rows[0];
      
      const puedeRestaurar = req.user.rol === 'administrador' ||
                           (req.user.rol === 'jefe' && req.user.departamento_id === documento.departamento_id);
      
      if (!puedeRestaurar) {
        await client.query('ROLLBACK');
        client.release();
        return res.status(403).json({ 
          success: false, 
          error: 'No tienes permisos para restaurar este documento' 
        });
      }
      
      await client.query(
        `UPDATE documentos 
         SET eliminado = false, 
             fecha_actualizacion = CURRENT_TIMESTAMP 
         WHERE id = $1`,
        [id]
      );
      
      await client.query('COMMIT');
      client.release();
      
      console.log('✅ Documento restaurado exitosamente');
      
      res.json({
        success: true,
        message: 'Documento restaurado exitosamente',
        documento_id: id,
        restaurado_por: req.user.nombre_completo,
        fecha_restauracion: new Date().toISOString()
      });
      
    } catch (error) {
      console.error('❌ Error restaurando documento:', error);
      
      if (client) {
        try {
          await client.query('ROLLBACK');
          client.release();
        } catch (rollbackError) {
          console.error('Error en rollback:', rollbackError);
        }
      }
      
      res.status(500).json({ 
        success: false, 
        error: 'Error interno del servidor al restaurar documento',
        details: error.message
      });
    }
  }
  
  // ========== OBTENER PAPELERA ==========
  async getPapelera(req, res) {
    try {
      const { page = 1, limit = 20 } = req.query;
      const offset = (parseInt(page) - 1) * parseInt(limit);
      
      console.log('🗑️ Obteniendo papelera:', {
        usuario: req.user.id,
        rol: req.user.rol,
        departamento: req.user.departamento_id
      });
      
      let query = `
        SELECT 
          d.*, 
          dep.nombre as departamento_nombre,
          u.nombre_completo as subido_por_nombre,
          u.correo as subido_por_correo
        FROM documentos d
        LEFT JOIN departamentos dep ON d.departamento_id = dep.id
        LEFT JOIN usuarios u ON d.subido_por = u.id
        WHERE d.eliminado = true 
      `;
      
      let params = [];
      let paramCount = 0;
      
      // 🔥 ADMIN PUEDE VER TODA LA PAPELERA
      if (req.user.rol !== 'administrador') {
        paramCount++;
        query += ` AND d.departamento_id = $${paramCount}`;
        params.push(req.user.departamento_id);
      } else {
        console.log('👑 Admin viendo TODA la papelera');
      }
      
      const countQuery = `SELECT COUNT(*) as total FROM (${query}) AS sub`;
      const countResult = await pool.query(countQuery, params);
      const total = parseInt(countResult.rows[0].total);
      
      query += ` ORDER BY d.fecha_actualizacion DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
      params.push(parseInt(limit), offset);
      
      const result = await pool.query(query, params);
      
      const documentosConCategorias = await Promise.all(
        result.rows.map(async (doc) => {
          const categorias = await pool.query(
            `SELECT c.id, c.nombre, c.codigo
             FROM categorias_documento c
             JOIN documentos_categorias dc ON c.id = dc.categoria_id
             WHERE dc.documento_id = $1`,
            [doc.id]
          );
          
          return {
            ...doc,
            categorias: categorias.rows,
            tamaño_archivo_formatted: formatBytes(doc.tamaño_archivo),
            fecha_creacion_formatted: formatDateForDisplay(doc.fecha_creacion),
            fecha_actualizacion_formatted: formatDateForDisplay(doc.fecha_actualizacion),
            dias_en_papelera: calculateDaysInTrash(doc.fecha_actualizacion)
          };
        })
      );
      
      console.log(`✅ ${result.rows.length} documentos en papelera`);
      
      res.json({
        success: true,
        papelera: true,
        documentos: documentosConCategorias,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: total,
          pages: Math.ceil(total / parseInt(limit))
        }
      });
      
    } catch (error) {
      console.error('❌ Error obteniendo papelera:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Error interno del servidor al obtener papelera',
        details: error.message
      });
    }
  }
  
  // ========== OBTENER ESTADÍSTICAS ==========
  async getDocumentStats(req, res) {
    try {
      const { departamento_id } = req.query;
      
      // 🔥 Si es admin y no pide un departamento específico, puede ver estadísticas globales
      if (req.user.rol === 'administrador' && !departamento_id) {
        console.log('👑 Admin obteniendo estadísticas globales');
        
        const stats = await pool.query(
          `SELECT 
            (SELECT COUNT(*) FROM documentos WHERE eliminado = false) as total_documentos,
            (SELECT COUNT(*) FROM documentos WHERE eliminado = false AND archivado = true) as archivados,
            (SELECT COUNT(*) FROM documentos WHERE eliminado = true) as eliminados,
            (SELECT COALESCE(SUM(tamaño_archivo), 0) FROM documentos WHERE eliminado = false) as espacio_usado,
            (SELECT COUNT(DISTINCT departamento_id) FROM documentos WHERE eliminado = false) as departamentos_con_docs
          `
        );
        
        const estadisticas = stats.rows[0];
        
        return res.json({
          success: true,
          estadisticas: {
            ...estadisticas,
            espacio_usado_formatted: formatBytes(estadisticas.espacio_usado),
            espacio_usado_calculado_formatted: formatBytes(estadisticas.espacio_usado),
            espacio_limite_formatted: 'Ilimitado',
            porcentaje_uso: 0,
            global: true
          }
        });
      }
      
      // Comportamiento normal para no admins o admin con departamento específico
      const deptoId = departamento_id || req.user.departamento_id;
      
      console.log('📊 Obteniendo estadísticas para departamento:', deptoId);
      
      const stats = await pool.query(
        `SELECT 
          (SELECT COUNT(*) FROM documentos WHERE departamento_id = $1 AND eliminado = false) as total_documentos,
          (SELECT COUNT(*) FROM documentos WHERE departamento_id = $1 AND eliminado = false AND archivado = true) as archivados,
          (SELECT COUNT(*) FROM documentos WHERE departamento_id = $1 AND eliminado = true) as eliminados,
          (SELECT COALESCE(SUM(tamaño_archivo), 0) FROM documentos WHERE departamento_id = $1 AND eliminado = false) as espacio_usado,
          (SELECT COALESCE(usado_bytes, 0) FROM espacio_almacenamiento WHERE departamento_id = $1) as espacio_usado_calculado,
          (SELECT COALESCE(limite_bytes, 5368709120) FROM espacio_almacenamiento WHERE departamento_id = $1) as espacio_limite
        `,
        [deptoId]
      );
      
      const estadisticas = stats.rows[0];
      
      const porcentajeUso = estadisticas.espacio_limite > 0 
        ? (estadisticas.espacio_usado_calculado / estadisticas.espacio_limite) * 100 
        : 0;
      
      res.json({
        success: true,
        estadisticas: {
          ...estadisticas,
          espacio_usado_formatted: formatBytes(estadisticas.espacio_usado),
          espacio_usado_calculado_formatted: formatBytes(estadisticas.espacio_usado_calculado),
          espacio_limite_formatted: formatBytes(estadisticas.espacio_limite),
          porcentaje_uso: Math.round(porcentajeUso * 100) / 100
        }
      });
      
    } catch (error) {
      console.error('❌ Error obteniendo estadísticas:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Error obteniendo estadísticas',
        details: error.message
      });
    }
  }
  
  // ========== OBTENER CATEGORÍAS DE DOCUMENTO ==========
  async getCategoriasDocumento(req, res) {
    try {
      const { documento_id } = req.params;
      
      const result = await pool.query(
        `SELECT c.id, c.nombre, c.codigo, dc.fecha_asignacion
         FROM categorias_documento c
         JOIN documentos_categorias dc ON c.id = dc.categoria_id
         WHERE dc.documento_id = $1
         ORDER BY dc.fecha_asignacion DESC`,
        [documento_id]
      );
      
      res.json({
        success: true,
        categorias: result.rows
      });
      
    } catch (error) {
      console.error('❌ Error obteniendo categorías del documento:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Error obteniendo categorías del documento',
        details: error.message
      });
    }
  }
}

// ========== EXPORTAR INSTANCIA ÚNICA ==========
const documentControllerInstance = new DocumentController();
console.log('✅ DocumentController instanciado y listo para usar');
module.exports = documentControllerInstance;
// src/services/ftpService.js
const FtpClient = require('basic-ftp');
const fs = require('fs');
const path = require('path');

class FTPService {
  constructor() {
    this.config = {
      host: process.env.FTP_HOST || 'localhost',
      port: parseInt(process.env.FTP_PORT) || 21,
      user: process.env.FTP_USER || 'admin',
      password: process.env.FTP_PASSWORD || 'admin123',
      secure: process.env.FTP_SECURE === 'true',
      secureOptions: process.env.FTP_SECURE === 'true' ? { 
        rejectUnauthorized: false 
      } : undefined,
      passive: true,
      timeout: 30000,
    };
    
    this.basePath = process.env.FTP_BASE_PATH || '/documentos';
    this.client = null;
    this.connectionPromise = null;
    this.lastUse = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 3;
    
    console.log('🔧 Configuración FTP cargada:', {
      host: this.config.host,
      port: this.config.port,
      user: this.config.user,
      basePath: this.basePath
    });
  }

  /**
   * Obtener conexión FTP (reutilizable)
   */
  async getConnection() {
    // Si ya hay una conexión en proceso, esperar por ella
    if (this.connectionPromise) {
      console.log('⏳ Esperando conexión FTP en curso...');
      return this.connectionPromise;
    }

    // Si ya hay cliente conectado y está activo, reutilizarlo
    if (this.client && this.client.connected) {
      this.lastUse = Date.now();
      this.reconnectAttempts = 0;
      return this.client;
    }

    // Crear nueva conexión
    this.connectionPromise = this._createConnection();
    
    try {
      this.client = await this.connectionPromise;
      this.lastUse = Date.now();
      this.reconnectAttempts = 0;
      console.log('✅ Conexión FTP establecida y guardada para reutilizar');
      return this.client;
    } catch (error) {
      console.error('❌ Error conectando al FTP:', error.message);
      throw error;
    } finally {
      this.connectionPromise = null;
    }
  }

  /**
   * Crear nueva conexión FTP 
   */
  async _createConnection() {
    const client = new FtpClient.Client();
    client.ftp.verbose = process.env.NODE_ENV === 'development';
    
    // Configurar timeout
    client.ftp.socket.setTimeout(this.config.timeout);
    
    // Manejar cierre de conexión
    client.ftp.socket.on('close', () => {
      console.log('🔌 Conexión FTP cerrada');
      this.client = null;
    });

    client.ftp.socket.on('error', (error) => {
      console.error('🔌 Error en socket FTP:', error.message);
      this.client = null;
    });
    
    await client.access({
      host: this.config.host,
      port: this.config.port,
      user: this.config.user,
      password: this.config.password,
      secure: this.config.secure,
      secureOptions: this.config.secureOptions,
      passive: this.config.passive,
    });
    
    return client;
  }

  /**
   * Asegurar conexión activa
   */
  async ensureConnection() {
    try {
      return await this.getConnection();
    } catch (error) {
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        console.log(`🔄 Reintentando conexión FTP (intento ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
        this.client = null;
        return this.getConnection();
      }
      throw error;
    }
  }

  /**
   * Cerrar conexión explícitamente
   */
  async close() {
    if (this.client && this.client.connected) {
      try {
        this.client.close();
        console.log('🔌 Conexión FTP cerrada explícitamente');
      } catch (error) {
        console.error('Error cerrando conexión FTP:', error.message);
      }
      this.client = null;
    }
  }

  /**
   * Obtener ruta competa 
   * @param {string} relativePath - Ruta relativa
   * @returns {string} Ruta completa normalizada
   */
  getFullPath(relativePath) {
    // Si la ruta ya comienza con el basePath, devolverla tal cual
    if (relativePath.startsWith(this.basePath)) {
      return relativePath.replace(/\\/g, '/');
    }
    
    // Asegurar que basePath comience con /
    const base = this.basePath.startsWith('/') ? this.basePath : `/${this.basePath}`;
    
    // Asegurar que relativePath no comience con / si ya tenemos base con /
    const cleanRelative = relativePath.startsWith('/') ? relativePath.substring(1) : relativePath;
    
    // Unir y normalizar
    const fullPath = path.join(base, cleanRelative).replace(/\\/g, '/');
    
    // Asegurar que no haya dobles barras
    return fullPath.replace(/\/+/g, '/');
  }

  /**
   * Extraer partes de una ruta FTP
   * @param {string} fullPath - Ruta completa
   * @returns {Object} Partes de la ruta
   */
  parsePath(fullPath) {
    const parts = fullPath.split('/').filter(p => p.length > 0);
    
    // Identificar estructura: uploads/articulo_Y/fraccion_Z/anio/trimestre
    let articulo = null;
    let fraccion = null;
    let anio = null;
    let periodo = null;
    
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (part.startsWith('articulo_')) {
        articulo = part;
      } else if (part.startsWith('fraccion_')) {
        fraccion = part;
      } else if (/^\d{4}$/.test(part)) { // Año (2024, 2025, etc.)
        anio = part;
      } else if (part.includes('trimestre') || part.includes('semestre')) {
        periodo = part;
      }
    }
    
    return {
      fullPath,
      parts,
      articulo,
      fraccion,
      anio,
      periodo,
      pathWithoutBase: '/' + parts.slice(1).join('/') // Asumiendo que el primer elemento es 'uploads'
    };
  }

  /**
   * Crear directorios recursivamente
   * @param {string} dirPath - Ruta del directorio a crear
   */
  async ensureDirectoryExists(dirPath) {
    const client = await this.ensureConnection();
    
    // Obtener ruta completa
    const fullPath = this.getFullPath(dirPath);
    console.log(`📁 Verificando/creando estructura: ${fullPath}`);
    
    const parts = fullPath.split('/').filter(p => p.length > 0);
    let currentPath = '';
    
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      currentPath += '/' + part;
      
      try {
        // Intentar cambiar al directorio
        await client.cd(currentPath);
        console.log(`   ✅ Ya existe: ${currentPath}`);
      } catch (error) {
        // Si no existe, crearlo
        try {
          console.log(`   📁 Creando: ${currentPath}`);
          await client.send(`MKD ${currentPath}`);
          await client.cd(currentPath);
          console.log(`   ✅ Creado: ${currentPath}`);
        } catch (mkdirError) {
          // Si el error es porque ya existe (algunos servidores)
          if (mkdirError.message.includes('exists') || mkdirError.message.includes('550')) {
            console.log(`   ⚠️ Ya existe (confirmado): ${currentPath}`);
          } else {
            console.error(`   ❌ Error creando ${currentPath}:`, mkdirError.message);
            throw mkdirError;
          }
        }
      }
    }
    
    console.log(`✅ Estructura completa verificada/creada: ${fullPath}`);
    return {
      success: true,
      path: fullPath,
      parsed: this.parsePath(fullPath)
    };
  }

  /**
   * Crear estructura jerárquica SIN departamento
   * @param {Object} clasificacion - Objeto con clasificación jerárquica
   */
  async createHierarchicalStructure(clasificacion) {
    if (!clasificacion || !clasificacion.articulo || !clasificacion.fraccion) {
      throw new Error('Clasificación incompleta: se requiere artículo y fracción');
    }
    
    // 🔥 NUEVA ESTRUCTURA: SOLO artículo/fracción/año/período
    // SIN departamento_
    let ruta = `articulo_${clasificacion.articulo}/fraccion_${clasificacion.fraccion}`;
    
    // Agregar año si existe
    if (clasificacion.periodo && clasificacion.periodo.valor) {
      ruta += `/${clasificacion.periodo.valor}`;
      
      // Agregar trimestre/semestre si existe
      if (clasificacion.periodo.subperiodo) {
        // Convertir a formato de carpeta: "Primer Trimestre" → "primer_trimestre"
        const carpetaPeriodo = clasificacion.periodo.subperiodo
          .toLowerCase()
          .replace(/\s+/g, '_')
          .replace(/[áéíóú]/g, (match) => {
            const map = { 'á': 'a', 'é': 'e', 'í': 'i', 'ó': 'o', 'ú': 'u' };
            return map[match] || match;
          });
        ruta += `/${carpetaPeriodo}`;
      }
    }
    
    console.log(`🏗️ Creando estructura jerárquica: ${ruta}`);
    
    // Crear toda la estructura
    const result = await this.ensureDirectoryExists(ruta);
    
    return {
      success: true,
      fullPath: result.path,
      relativePath: ruta,
      parsed: result.parsed
    };
  }

  /**
   * Subir archivo al FTP - VERSIÓN MODIFICADA (SIN DEPARTAMENTO)
   * @param {string} localPath - Ruta local del archivo
   * @param {string} remoteDir - Directorio remoto (opcional)
   * @param {string} remoteFileName - Nombre del archivo (opcional)
   * @param {Object} clasificacion - Clasificación jerárquica (opcional)
   */
  async uploadFile(localPath, remoteDir = null, remoteFileName = null, clasificacion = null) {
    const client = await this.ensureConnection();
    
    try {
      if (!fs.existsSync(localPath)) {
        throw new Error(`Archivo local no existe: ${localPath}`);
      }

      const stats = fs.statSync(localPath);
      console.log(`📤 Subiendo: ${path.basename(localPath)} (${formatBytes(stats.size)})`);
      
      const fileName = remoteFileName || path.basename(localPath);
      
      // Determinar la ruta completa del directorio remoto
      let fullRemoteDir;
      
      if (clasificacion) {
        // 🔥 NUEVA ESTRUCTURA: Usar clasificación SIN departamento 
        console.log('🏗️ Usando clasificación jerárquica SIN departamento');
        const estructura = await this.createHierarchicalStructure(clasificacion);
        fullRemoteDir = estructura.fullPath;
        console.log(`   📂 Ruta jerárquica: ${fullRemoteDir}`);
      } else if (remoteDir) {
        // Si no hay clasificación pero hay remoteDir, usarlo
        fullRemoteDir = this.getFullPath(remoteDir);
        await this.ensureDirectoryExists(fullRemoteDir);
      } else {
        // Si no hay nada, usar la raíz
        fullRemoteDir = this.getFullPath('/');
      }
      
      const fullRemotePath = path.join(fullRemoteDir, fileName).replace(/\\/g, '/');
      
      console.log(`   📂 Directorio destino: ${fullRemoteDir}`);
      console.log(`   📂 Ruta completa: ${fullRemotePath}`);
      
      // Cambiar al directorio y subir archivo
      await client.cd(fullRemoteDir);
      await client.uploadFrom(localPath, fileName);
      
      console.log(`✅ Archivo subido exitosamente: ${fullRemotePath}`);
      
      return {
        success: true,
        fileName,
        fullPath: fullRemotePath,
        relativePath: fullRemotePath.replace(this.basePath, '').replace(/^\//, ''),
        size: stats.size,
        uploadedAt: new Date().toISOString(),
        parsed: this.parsePath(fullRemotePath)
      };
      
    } catch (error) {
      console.error('❌ Error subiendo archivo:', error.message);
      throw error;
    }
  }

  /**
   * Descargar archivo del FTP
   */
  async downloadFile(remotePath, localPath) {
    const client = await this.ensureConnection();
    
    try {
      console.log(`📥 Descargando: ${remotePath}`);
      
      // Obtener ruta completa
      const fullRemotePath = this.getFullPath(remotePath);
      console.log(`   📂 Ruta completa: ${fullRemotePath}`);
      
      const remoteDir = path.dirname(fullRemotePath);
      const remoteFileName = path.basename(fullRemotePath);
      
      await client.cd(remoteDir);
      
      const localDir = path.dirname(localPath);
      if (!fs.existsSync(localDir)) {
        fs.mkdirSync(localDir, { recursive: true });
      }
      
      await client.downloadTo(localPath, remoteFileName);
      
      const stats = fs.statSync(localPath);
      console.log(`✅ Archivo descargado: ${localPath} (${formatBytes(stats.size)})`);
      
      return { 
        success: true, 
        localPath,
        remotePath: fullRemotePath,
        parsed: this.parsePath(fullRemotePath)
      };
      
    } catch (error) {
      console.error('❌ Error descargando:', error.message);
      throw error;
    }
  }

  /**
   * 🔥 CORREGIDO: Eliminar archivo del FTP con búsqueda alternativa
   */
  async deleteFile(remotePath) {
    console.log(`\n🗑️ [FTP] ===== INICIANDO ELIMINACIÓN DE ARCHIVO =====`);
    console.log(`   📂 Ruta solicitada: ${remotePath}`);
    
    let client = null;
    try {
      client = await this.ensureConnection();
      
      // Obtener ruta completa
      const fullRemotePath = this.getFullPath(remotePath);
      console.log(`   📂 Ruta completa calculada: ${fullRemotePath}`);
      
      // Extraer información de la ruta
      const nombreArchivo = path.basename(fullRemotePath);
      const directorioPadre = path.dirname(fullRemotePath);
      
      console.log(`   📄 Nombre archivo: ${nombreArchivo}`);
      console.log(`   📁 Directorio: ${directorioPadre}`);
      
      // Verificar si el archivo existe en la ruta esperada
      console.log('🔍 Verificando si el archivo existe en la ruta esperada...');
      const existeEnRuta = await this.fileExists(fullRemotePath);
      
      if (existeEnRuta) {
        console.log(`✅ Archivo encontrado en la ruta esperada`);
        
        // Eliminar el archivo
        await client.cd(directorioPadre);
        await client.remove(nombreArchivo);
        console.log(`✅ Archivo eliminado exitosamente de: ${fullRemotePath}`);
        
        // Limpiar directorios vacíos
        await this.cleanupEmptyDirectories(directorioPadre);
        
        console.log(`✅✅✅ [FTP] ELIMINACIÓN COMPLETADA`);
        return { 
          success: true, 
          path: fullRemotePath,
          metodo: 'directo'
        };
      }
      
      // Si no existe en la ruta esperada, buscar en ubicaciones alternativas
      console.log(`⚠️ Archivo NO encontrado en la ruta esperada. Buscando en ubicaciones alternativas...`);
      
      // Estrategia 1: Buscar en el directorio padre y subdirectorios
      const archivosEncontrados = await this.buscarArchivoPorNombre(directorioPadre, nombreArchivo);
      
      if (archivosEncontrados.length > 0) {
        console.log(`✅ Archivo encontrado en ubicación alternativa:`);
        archivosEncontrados.forEach((ruta, index) => {
          console.log(`   ${index + 1}. ${ruta}`);
        });
        
        // Eliminar la primera ocurrencia encontrada
        const rutaEncontrada = archivosEncontrados[0];
        console.log(`🗑️ Eliminando archivo de: ${rutaEncontrada}`);
        
        const dirEncontrado = path.dirname(rutaEncontrada);
        const nombreEncontrado = path.basename(rutaEncontrada);
        
        await client.cd(dirEncontrado);
        await client.remove(nombreEncontrado);
        console.log(`✅ Archivo eliminado exitosamente de ubicación alternativa`);
        
        // Limpiar directorios vacíos
        await this.cleanupEmptyDirectories(dirEncontrado);
        
        return { 
          success: true, 
          path: rutaEncontrada,
          metodo: 'busqueda'
        };
      }
      
      // Estrategia 2: Buscar recursivamente desde la raíz
      console.log('🔍 Buscando archivo recursivamente desde la raíz...');
      const raiz = this.basePath;
      const busquedaGlobal = await this.buscarArchivoPorNombre(raiz, nombreArchivo);
      
      if (busquedaGlobal.length > 0) {
        console.log(`✅ Archivo encontrado en búsqueda global:`);
        busquedaGlobal.forEach((ruta, index) => {
          console.log(`   ${index + 1}. ${ruta}`);
        });
        
        const rutaEncontrada = busquedaGlobal[0];
        console.log(`🗑️ Eliminando archivo de: ${rutaEncontrada}`);
        
        const dirEncontrado = path.dirname(rutaEncontrada);
        const nombreEncontrado = path.basename(rutaEncontrada);
        
        await client.cd(dirEncontrado);
        await client.remove(nombreEncontrado);
        console.log(`✅ Archivo eliminado exitosamente de ubicación global`);
        
        // Limpiar directorios vacíos
        await this.cleanupEmptyDirectories(dirEncontrado);
        
        return { 
          success: true, 
          path: rutaEncontrada,
          metodo: 'global'
        };
      }
      
      // Si no se encuentra el archivo en ninguna ubicación
      console.log(`❌ No se pudo encontrar el archivo "${nombreArchivo}" en ninguna ubicación del FTP`);
      
      // Listar contenido del directorio padre para diagnóstico
      try {
        console.log(`📂 Contenido del directorio ${directorioPadre}:`);
        await client.cd(directorioPadre);
        const files = await client.list();
        files.forEach(f => {
          console.log(`   - ${f.name} (${f.isDirectory ? 'DIR' : 'FILE'})`);
        });
      } catch (listError) {
        console.log(`   No se pudo listar el directorio: ${listError.message}`);
      }
      
      return { 
        success: false, 
        message: 'Archivo no encontrado en FTP',
        path: fullRemotePath,
        existe: false
      };
      
    } catch (error) {
      console.error(`❌ [FTP] Error eliminando archivo ${remotePath}:`, error.message);
      console.error(error.stack);
      
      // Intentar método alternativo con comandos directos
      try {
        console.log('🔄 Intentando método alternativo de eliminación...');
        const fullRemotePath = this.getFullPath(remotePath);
        
        // Intentar con comando DELE directo
        await client.send(`DELE ${fullRemotePath}`);
        console.log('✅ Método alternativo exitoso');
        
        return { success: true, method: 'direct', path: fullRemotePath };
        
      } catch (altError) {
        console.error('❌ Método alternativo también falló:', altError.message);
        throw error;
      }
    }
  }

  /**
   * Buscar archivo por nombre en directorio y subdirectorios
   * @param {string} directorio - Directorio base para la búsqueda
   * @param {string} nombreArchivo - Nombre del archivo a buscar
   * @param {number} profundidad - Profundidad máxima de búsqueda
   */
  async buscarArchivoPorNombre(directorio, nombreArchivo, profundidad = 0, maxProfundidad = 5) {
    if (profundidad > maxProfundidad) {
      return [];
    }
    
    const resultados = [];
    
    try {
      const client = await this.ensureConnection();
      const dirCompleto = this.getFullPath(directorio);
      
      // Intentar acceder al directorio
      try {
        await client.cd(dirCompleto);
      } catch (error) {
        // Si no se puede acceder, retornar vacío
        return [];
      }
      
      const items = await client.list();
      
      for (const item of items) {
        if (item.isDirectory) {
          // Buscar recursivamente en subdirectorios
          const subResultados = await this.buscarArchivoPorNombre(
            path.join(dirCompleto, item.name).replace(/\\/g, '/'),
            nombreArchivo,
            profundidad + 1,
            maxProfundidad
          );
          resultados.push(...subResultados);
        } else if (item.name === nombreArchivo) {
          resultados.push(path.join(dirCompleto, item.name).replace(/\\/g, '/'));
        }
      }
      
    } catch (error) {
      console.log(`⚠️ Error buscando en ${directorio}: ${error.message}`);
    }
    
    return resultados;
  }

  /**
   * Limpiar directorios vacíos recursivamente
   * @param {string} dirPath - Ruta del directorio a verificar
   */
  async cleanupEmptyDirectories(dirPath) {
    const client = await this.ensureConnection();
    
    try {
      const fullPath = this.getFullPath(dirPath);
      console.log(`🧹 Verificando si directorio está vacío: ${fullPath}`);
      
      // No eliminar directorios base importantes
      if (fullPath === this.basePath || 
          fullPath.match(/\/articulo_\d+$/) ||
          fullPath.match(/\/articulo_\d+\/fraccion_\w+$/)) {
        console.log(`   📁 Directorio base, no se elimina`);
        return;
      }
      
      try {
        await client.cd(fullPath);
        const files = await client.list();
        
        // Si está vacío, eliminarlo
        if (files.length === 0) {
          console.log(`📁 Directorio vacío, eliminando: ${fullPath}`);
          await client.removeDir(fullPath);
          
          // Intentar limpiar el directorio padre recursivamente
          const parentDir = path.dirname(fullPath);
          if (parentDir && parentDir !== '.' && parentDir !== '/') {
            await this.cleanupEmptyDirectories(parentDir);
          }
        }
      } catch (error) {
        console.log(`   ⚠️ Error accediendo al directorio: ${error.message}`);
      }
      
    } catch (error) {
      console.log('   ⚠️ Error en limpieza de directorios:', error.message);
    }
  }

  /**
   * Verificar si archivo existe
   * @param {string} remotePath - Ruta del archivo o directorio
   * @param {string|null} fileName - Nombre del archivo (opcional)
   */
  async fileExists(remotePath, fileName = null) {
    const client = await this.ensureConnection();
    
    try {
      // CASO 1: Nos pasan dos parámetros (remoteDir, fileName)
      if (fileName !== null) {
        // Obtener ruta completa del directorio
        const fullRemoteDir = this.getFullPath(remotePath);
        console.log(`   🔍 Verificando existencia en directorio: ${fullRemoteDir}, archivo: ${fileName}`);
        
        try {
          await client.cd(fullRemoteDir);
          const files = await client.list();
          const existe = files.some(f => f.name === fileName);
          console.log(`      📁 Resultado: ${existe ? 'EXISTE' : 'NO EXISTE'}`);
          return existe;
        } catch (error) {
          console.log(`      ❌ Error accediendo al directorio: ${error.message}`);
          return false;
        }
      }
      
      // CASO 2: Nos pasan un solo parámetro (ruta completa del archivo)
      const fullRemotePath = this.getFullPath(remotePath);
      console.log(`   🔍 Verificando archivo: ${fullRemotePath}`);
      
      const remoteDir = path.dirname(fullRemotePath);
      const remoteFileName = path.basename(fullRemotePath);
      
      try {
        await client.cd(remoteDir);
        const files = await client.list();
        const existe = files.some(f => f.name === remoteFileName);
        console.log(`      📁 Resultado: ${existe ? 'EXISTE' : 'NO EXISTE'}`);
        return existe;
      } catch (error) {
        console.log(`      ❌ Error: ${error.message}`);
        return false;
      }
      
    } catch (error) {
      console.error('Error verificando existencia:', error.message);
      return false;
    }
  }

  /**
   * Renombrar archivo en FTP
   */
  async renameFile(oldPath, newPath) {
    console.log('🔄 [FTP] Intentando renombrar/mover archivo:');
    console.log(`   📂 De: ${oldPath}`);
    console.log(`   📂 A:  ${newPath}`);
    
    const client = await this.ensureConnection();
    
    try {
      // Obtener rutas completas
      const fullOldPath = this.getFullPath(oldPath);
      const fullNewPath = this.getFullPath(newPath);
      
      console.log(`   🔄 Rutas completas:`);
      console.log(`      De: ${fullOldPath}`);
      console.log(`      A:  ${fullNewPath}`);
      
      // Verificar que el archivo origen existe
      console.log('🔍 Verificando existencia del archivo origen...');
      const exists = await this.fileExists(fullOldPath);
      if (!exists) {
        throw new Error(`El archivo origen no existe: ${fullOldPath}`);
      }
      console.log('✅ Archivo origen existe');
      
      // Asegurar que el directorio destino existe
      const destDir = path.dirname(fullNewPath);
      await this.ensureDirectoryExists(destDir);
      
      console.log('📤 Ejecutando rename...');
      
      // Intentar con comandos RNFR/RNTO
      try {
        await client.send(`RNFR ${fullOldPath}`);
        await client.send(`RNTO ${fullNewPath}`);
        console.log('✅ RNFR/RNTO exitoso');
      } catch (renameError) {
        console.log('⚠️ RNFR/RNTO falló, intentando método alternativo...');
        
        // Método alternativo: copiar y eliminar
        await this.copyFile(fullOldPath, fullNewPath);
        await this.deleteFile(fullOldPath);
        console.log('✅ Método alternativo exitoso');
      }
      
      console.log(`✅✅✅ Archivo renombrado/movido exitosamente en FTP`);
      console.log(`   📂 Nueva ruta: ${fullNewPath}`);
      
      return { 
        success: true, 
        oldPath: fullOldPath, 
        newPath: fullNewPath,
        fileName: path.basename(fullNewPath),
        parsed: this.parsePath(fullNewPath)
      };
      
    } catch (error) {
      console.error('❌❌❌ Error en FTP renameFile:');
      console.error(`   Código: ${error.code}`);
      console.error(`   Mensaje: ${error.message}`);
      throw error;
    }
  }

  /**
   * Listar archivos en directorio
   */
  async listFiles(remoteDir = '/') {
    const client = await this.ensureConnection();
    
    try {
      const fullRemoteDir = this.getFullPath(remoteDir);
      console.log(`📂 Listando directorio: ${fullRemoteDir}`);
      
      try {
        await client.cd(fullRemoteDir);
      } catch {
        console.log(`   📁 Directorio no existe: ${fullRemoteDir}`);
        return { success: true, files: [], count: 0, exists: false };
      }
      
      const files = await client.list();
      
      const formattedFiles = files.map(file => ({
        name: file.name,
        size: file.size,
        sizeFormatted: formatBytes(file.size),
        type: file.isDirectory ? 'directory' : 'file',
        modified: file.modifiedAt || file.date,
        permissions: file.permissions,
        link: file.link,
        group: file.group,
        user: file.user,
        hardLinkCount: file.hardLinkCount
      }));
      
      console.log(`   📁 Encontrados ${formattedFiles.length} archivos/directorios`);
      
      return {
        success: true,
        files: formattedFiles,
        count: formattedFiles.length,
        exists: true,
        path: fullRemoteDir,
        parsed: this.parsePath(fullRemoteDir)
      };
      
    } catch (error) {
      console.error('Error listando archivos:', error.message);
      throw error;
    }
  }

  /**
   * Mover archivo (alias de renameFile)
   */
  async moveFile(oldPath, newPath) {
    return this.renameFile(oldPath, newPath);
  }

  /**
   * Copiar archivo
   */
  async copyFile(sourcePath, destPath) {
    const client = await this.ensureConnection();
    
    try {
      const fullSourcePath = this.getFullPath(sourcePath);
      const fullDestPath = this.getFullPath(destPath);
      
      console.log(`📋 Copiando archivo:`);
      console.log(`   📂 De: ${fullSourcePath}`);
      console.log(`   📂 A:  ${fullDestPath}`);
      
      // Verificar que el origen existe
      const exists = await this.fileExists(fullSourcePath);
      if (!exists) {
        throw new Error(`Archivo origen no existe: ${fullSourcePath}`);
      }
      
      // Asegurar directorio destino
      await this.ensureDirectoryExists(path.dirname(fullDestPath));
      
      // Intentar comandos de copia
      try {
        await client.send(`CPFR ${fullSourcePath}`);
        await client.send(`CPTO ${fullDestPath}`);
        console.log('✅ Archivo copiado exitosamente');
        return { success: true, source: fullSourcePath, dest: fullDestPath };
      } catch (copyError) {
        console.log('⚠️ El servidor no soporta CPFR/CPTO, usando método alternativo...');
        
        // Método alternativo: descargar y subir
        const tempDir = path.join(__dirname, '../temp');
        if (!fs.existsSync(tempDir)) {
          fs.mkdirSync(tempDir, { recursive: true });
        }
        
        const tempFile = path.join(tempDir, `temp_copy_${Date.now()}_${path.basename(fullSourcePath)}`);
        
        await this.downloadFile(fullSourcePath, tempFile);
        await this.uploadFile(tempFile, path.dirname(fullDestPath), path.basename(fullDestPath));
        
        // Limpiar archivo temporal
        if (fs.existsSync(tempFile)) {
          fs.unlinkSync(tempFile);
        }
        
        console.log('✅ Archivo copiado exitosamente (método alternativo)');
        return { success: true, source: fullSourcePath, dest: fullDestPath, method: 'download-upload' };
      }
      
    } catch (error) {
      console.error('❌ Error copiando archivo:', error.message);
      throw error;
    }
  }

  /**
   * Obtener información de un archivo
   */
  async getFileInfo(remotePath) {
    const client = await this.ensureConnection();
    
    try {
      const fullPath = this.getFullPath(remotePath);
      console.log(`🔍 Obteniendo info de: ${fullPath}`);
      
      const remoteDir = path.dirname(fullPath);
      const remoteFileName = path.basename(fullPath);
      
      await client.cd(remoteDir);
      const files = await client.list();
      const fileInfo = files.find(f => f.name === remoteFileName);
      
      if (!fileInfo) {
        return { success: false, exists: false };
      }
      
      return {
        success: true,
        exists: true,
        name: fileInfo.name,
        size: fileInfo.size,
        sizeFormatted: formatBytes(fileInfo.size),
        type: fileInfo.isDirectory ? 'directory' : 'file',
        modified: fileInfo.modifiedAt || fileInfo.date,
        permissions: fileInfo.permissions,
        path: fullPath,
        parsed: this.parsePath(fullPath)
      };
      
    } catch (error) {
      console.error('Error obteniendo info del archivo:', error.message);
      return { success: false, exists: false, error: error.message };
    }
  }

  /**
   * Probar conexión FTP
   */
  async testConnection() {
    try {
      console.log('🔌 Probando conexión FTP...');
      const client = await this.getConnection();
      const pwd = await client.pwd();
      
      console.log('✅ Conexión FTP exitosa. Directorio actual:', pwd);
      
      return {
        success: true,
        connected: true,
        currentDirectory: pwd,
        config: {
          host: this.config.host,
          port: this.config.port,
          basePath: this.basePath
        }
      };
      
    } catch (error) {
      console.error('❌ Error probando conexión FTP:', error.message);
      
      return {
        success: false,
        connected: false,
        error: error.message,
        config: {
          host: this.config.host,
          port: this.config.port,
          basePath: this.basePath
        }
      };
    }
  }

  /**
   * Buscar archivos por criterios
   * @param {Object} criterios - Criterios de búsqueda
   */
  async searchFiles(criterios = {}) {
    const { articulo, fraccion, anio, periodo, nombre } = criterios;
    
    // 🔥 Construir ruta base SIN departamento
    let basePath = '';
    if (articulo) basePath += `/articulo_${articulo}`;
    if (fraccion) basePath += `/fraccion_${fraccion}`;
    if (anio) basePath += `/${anio}`;
    if (periodo) basePath += `/${periodo}`;
    
    if (!basePath) {
      basePath = '/';
    }
    
    console.log(`🔍 Buscando archivos en: ${basePath}`);
    
    const result = await this.listFiles(basePath);
    
    // Filtrar por nombre si se especificó
    if (nombre && result.files) {
      result.files = result.files.filter(f => 
        f.type === 'file' && f.name.toLowerCase().includes(nombre.toLowerCase())
      );
      result.count = result.files.length;
    }
    
    return {
      ...result,
      criterios,
      searchPath: basePath
    };
  }

  /**
   * Método para migrar archivos de estructura antigua a nueva
   * @param {string} oldPath - Ruta antigua (con departamento)
   * @param {string} newPath - Ruta nueva (sin departamento)
   */
  async migrateFile(oldPath, newPath) {
    console.log('🔄 Migrando archivo de estructura antigua a nueva');
    return this.renameFile(oldPath, newPath);
  }

  /**
   * Obtener ruta desde BD (para debugging)
   */
  async getRutaDesdeBD(documentoId) {
    try {
      const { pool } = require('../config/database');
      const result = await pool.query(
        'SELECT ruta_archivo FROM documentos WHERE id = $1',
        [documentoId]
      );
      
      if (result.rows.length > 0) {
        return result.rows[0].ruta_archivo;
      }
      return null;
    } catch (error) {
      console.error('Error obteniendo ruta desde BD:', error);
      return null;
    }
  }
}

// Función auxiliar para formatear bytes
function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// Exportar instancia única
const ftpService = new FTPService();
module.exports = ftpService;
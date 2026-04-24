// src/controllers/categoriaController.js
const db = require('../config/database');
const { registrarLogSistema } = require('../utils/logging');

/**
 * @desc    Obtener todas las categorías
 * @route   GET /api/categorias
 * @access  Administrador
 */
const obtenerCategorias = async (req, res) => {
    try {
        // 🔥 MODIFICADO: Si es admin, puede ver TODAS las categorías
        // Si es usuario normal, solo ve las categorías asignadas a su departamento
        let query;
        let params = [];
        
        if (req.user.rol === 'administrador') {
            console.log('👑 Admin obteniendo TODAS las categorías');
            query = `
                SELECT c.*, 
                       COUNT(DISTINCT cd.departamento_id) AS departamentos_asignados,
                       COUNT(DISTINCT CASE WHEN cd.activo = true THEN cd.departamento_id END) AS departamentos_activos,
                       COUNT(DISTINCT dc.documento_id) AS total_documentos
                FROM categorias_documento c
                LEFT JOIN categorias_departamentos cd ON c.id = cd.categoria_id
                LEFT JOIN documentos_categorias dc ON c.id = dc.categoria_id
                GROUP BY c.id
                ORDER BY c.nombre;
            `;
        } else {
            console.log(`👤 Usuario normal obteniendo categorías de su departamento: ${req.user.departamento_id}`);
            query = `
                SELECT c.*, 
                       COUNT(DISTINCT cd.departamento_id) AS departamentos_asignados,
                       COUNT(DISTINCT CASE WHEN cd.activo = true THEN cd.departamento_id END) AS departamentos_activos,
                       COUNT(DISTINCT dc.documento_id) AS total_documentos,
                       CASE WHEN cd2.activo = true THEN true ELSE false END as asignada_a_mi_departamento,
                       cd2.fecha_asignacion as fecha_asignacion_mi_departamento
                FROM categorias_documento c
                LEFT JOIN categorias_departamentos cd ON c.id = cd.categoria_id
                LEFT JOIN documentos_categorias dc ON c.id = dc.categoria_id
                LEFT JOIN categorias_departamentos cd2 ON c.id = cd2.categoria_id AND cd2.departamento_id = $1
                WHERE EXISTS (
                    SELECT 1 FROM categorias_departamentos cd3
                    WHERE cd3.categoria_id = c.id
                    AND cd3.departamento_id = $1
                    AND cd3.activo = true
                )
                GROUP BY c.id, cd2.activo, cd2.fecha_asignacion
                ORDER BY c.nombre;
            `;
            params = [req.user.departamento_id];
        }
        
        const categorias = await db.query(query, params);
        
        res.json({
            exito: true,
            categorias: categorias.rows,
            rol: req.user.rol,
            departamento_id: req.user.departamento_id
        });
    } catch (error) {
        console.error('Error obteniendo categorías:', error);
        res.status(500).json({
            exito: false,
            mensaje: 'Error obteniendo categorías',
            error: error.message
        });
    }
};

/**
 * @desc    Crear nueva categoría
 * @route   POST /api/categorias
 * @access  Administrador
 */
const crearCategoria = async (req, res) => {
    const { nombre, codigo, descripcion, exclusiva } = req.body;
    const usuarioId = req.user?.id;
    
    try {
        // Validaciones
        if (!nombre || !codigo) {
            return res.status(400).json({
                exito: false,
                mensaje: 'Nombre y código son requeridos'
            });
        }
        
        // Verificar si ya existe una categoría con el mismo código
        const categoriaExistente = await db.query(
            'SELECT id FROM categorias_documento WHERE codigo = $1',
            [codigo]
        );
        
        if (categoriaExistente.rows.length > 0) {
            return res.status(400).json({
                exito: false,
                mensaje: 'Ya existe una categoría con este código'
            });
        }
        
        const query = `
            INSERT INTO categorias_documento (nombre, codigo, descripcion, exclusiva, activo)
            VALUES ($1, $2, $3, $4, true)
            RETURNING *;
        `;
        
        const result = await db.query(query, [
            nombre, 
            codigo, 
            descripcion || null, 
            exclusiva || false
        ]);
        
        const nuevaCategoria = result.rows[0];
        
        // Registrar log
        if (registrarLogSistema) {
            await registrarLogSistema(
                'categorias',
                'create',
                'categoria_documento',
                nuevaCategoria.id,
                nuevaCategoria.nombre,
                `Categoría creada: ${nombre} (${codigo})`,
                { 
                    categoria: nuevaCategoria,
                    usuario_id: usuarioId 
                },
                usuarioId,
                req.user?.nombre_completo,
                req.user?.correo,
                req.ip
            );
        }
        
        res.status(201).json({
            exito: true,
            mensaje: 'Categoría creada exitosamente',
            categoria: nuevaCategoria
        });
    } catch (error) {
        console.error('Error creando categoría:', error);
        res.status(500).json({
            exito: false,
            mensaje: 'Error creando categoría',
            error: error.message
        });
    }
};

/**
 * @desc    Actualizar categoría
 * @route   PUT /api/categorias/:id
 * @access  Administrador
 */
const actualizarCategoria = async (req, res) => {
    const { id } = req.params;
    const { nombre, codigo, descripcion, exclusiva, activo } = req.body;
    const usuarioId = req.user?.id;
    
    try {
        // Verificar que la categoría existe
        const categoriaExistente = await db.query(
            'SELECT * FROM categorias_documento WHERE id = $1',
            [id]
        );
        
        if (categoriaExistente.rows.length === 0) {
            return res.status(404).json({
                exito: false,
                mensaje: 'Categoría no encontrada'
            });
        }
        
        const categoriaActual = categoriaExistente.rows[0];
        
        // Si se cambia el código, verificar que no exista otro con el mismo código
        if (codigo && codigo !== categoriaActual.codigo) {
            const codigoExistente = await db.query(
                'SELECT id FROM categorias_documento WHERE codigo = $1 AND id != $2',
                [codigo, id]
            );
            
            if (codigoExistente.rows.length > 0) {
                return res.status(400).json({
                    exito: false,
                    mensaje: 'Ya existe otra categoría con este código'
                });
            }
        }
        
        const query = `
            UPDATE categorias_documento 
            SET nombre = COALESCE($1, nombre),
                codigo = COALESCE($2, codigo),
                descripcion = COALESCE($3, descripcion),
                exclusiva = COALESCE($4, exclusiva),
                activo = COALESCE($5, activo)
            WHERE id = $6
            RETURNING *;
        `;
        
        const result = await db.query(query, [
            nombre || categoriaActual.nombre,
            codigo || categoriaActual.codigo,
            descripcion !== undefined ? descripcion : categoriaActual.descripcion,
            exclusiva !== undefined ? exclusiva : categoriaActual.exclusiva,
            activo !== undefined ? activo : categoriaActual.activo,
            id
        ]);
        
        const categoriaActualizada = result.rows[0];
        
        // Registrar log
        if (registrarLogSistema) {
            await registrarLogSistema(
                'categorias',
                'update',
                'categoria_documento',
                id,
                categoriaActualizada.nombre,
                `Categoría actualizada: ${categoriaActualizada.nombre}`,
                { 
                    cambios: req.body,
                    anterior: categoriaActual,
                    usuario_id: usuarioId 
                },
                usuarioId,
                req.user?.nombre_completo,
                req.user?.correo,
                req.ip
            );
        }
        
        res.json({
            exito: true,
            mensaje: 'Categoría actualizada exitosamente',
            categoria: categoriaActualizada
        });
    } catch (error) {
        console.error('Error actualizando categoría:', error);
        res.status(500).json({
            exito: false,
            mensaje: 'Error actualizando categoría',
            error: error.message
        });
    }
};

/**
 * @desc    Obtener categorías asignadas a un departamento
 * @route   GET /api/categorias/departamento/:departamentoId
 * @access  Administrador, Jefe de Departamento
 */
const obtenerCategoriasPorDepartamento = async (req, res) => {
    const { departamentoId } = req.params;
    const { soloActivas = true } = req.query;
    
    try {
        // 🔥 MODIFICADO: Si es admin, puede ver categorías de CUALQUIER departamento
        // Si es usuario normal, solo puede ver su propio departamento
        if (req.user.rol !== 'administrador' && parseInt(departamentoId) !== req.user.departamento_id) {
            return res.status(403).json({
                exito: false,
                mensaje: 'No tienes permisos para ver categorías de este departamento'
            });
        }
        
        console.log(`${req.user.rol === 'administrador' ? '👑 Admin' : '👤 Usuario'} viendo categorías del departamento ${departamentoId}`);
        
        const query = `
            SELECT * FROM vista_categorias_departamentos
            WHERE departamento_id = $1 
            AND ($2 = false OR asignacion_activa = true)
            ORDER BY categoria_nombre;
        `;
        
        const result = await db.query(query, [
            departamentoId, 
            soloActivas === 'true' || soloActivas === undefined
        ]);
        
        res.json({
            exito: true,
            categorias: result.rows,
            rol: req.user.rol
        });
    } catch (error) {
        console.error('Error obteniendo categorías del departamento:', error);
        res.status(500).json({
            exito: false,
            mensaje: 'Error obteniendo categorías del departamento',
            error: error.message
        });
    }
};

/**
 * @desc    Obtener categorías disponibles para asignar a un departamento
 * @route   GET /api/categorias/disponibles/:departamentoId
 * @access  Administrador
 */
const obtenerCategoriasDisponibles = async (req, res) => {
    const { departamentoId } = req.params;
    
    try {
        // 🔥 MODIFICADO: Verificar que el usuario sea admin
        if (req.user.rol !== 'administrador') {
            return res.status(403).json({
                exito: false,
                mensaje: 'Solo administradores pueden ver categorías disponibles para asignar'
            });
        }
        
        const query = `
            SELECT c.*
            FROM categorias_documento c
            WHERE c.activo = true 
            AND c.id NOT IN (
                SELECT cd.categoria_id 
                FROM categorias_departamentos cd 
                WHERE cd.departamento_id = $1 
                AND cd.activo = true
            )
            ORDER BY c.nombre;
        `;
        
        const result = await db.query(query, [departamentoId]);
        
        res.json({
            exito: true,
            categorias: result.rows
        });
    } catch (error) {
        console.error('Error obteniendo categorías disponibles:', error);
        res.status(500).json({
            exito: false,
            mensaje: 'Error obteniendo categorías disponibles',
            error: error.message
        });
    }
};

/**
 * @desc    Asignar categoría a departamento
 * @route   POST /api/categorias/asignar
 * @access  Administrador
 */
const asignarCategoria = async (req, res) => {
    const { categoria_id, departamento_id, motivo = 'Asignación manual' } = req.body;
    const usuarioId = req.user?.id;
    
    try {
        // 🔥 MODIFICADO: Verificar que el usuario sea admin
        if (req.user.rol !== 'administrador') {
            return res.status(403).json({
                exito: false,
                mensaje: 'Solo administradores pueden asignar categorías'
            });
        }
        
        console.log(`📋 Datos recibidos para asignar categoría:`, {
            categoria_id,
            departamento_id,
            motivo,
            usuarioId,
            usuario: req.user
        });

        if (!categoria_id || !departamento_id) {
            console.log('❌ Faltan parámetros:', { categoria_id, departamento_id });
            return res.status(400).json({
                exito: false,
                mensaje: 'Categoría y departamento son requeridos'
            });
        }

        if (!usuarioId) {
            console.log('❌ Usuario no autenticado');
            return res.status(401).json({
                exito: false,
                mensaje: 'Usuario no autenticado'
            });
        }

        // Obtener IP del usuario
        const ipAddress = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;
        console.log(`🔍 IP del usuario: ${ipAddress}`);

        const query = `
            SELECT * FROM asignar_categoria_departamento(
                $1, $2, $3, $4
            ) as resultado;
        `;
        
        console.log('📤 Ejecutando función PostgreSQL:', { 
            categoria_id, 
            departamento_id, 
            usuarioId, 
            ipAddress 
        });
        
        const result = await db.query(query, [
            categoria_id, 
            departamento_id, 
            usuarioId, 
            ipAddress
        ]);
        
        console.log('📥 Resultado de PostgreSQL:', result.rows[0]);
        
        if (!result.rows[0] || !result.rows[0].resultado) {
            console.error('❌ PostgreSQL devolvió resultado vacío');
            return res.status(500).json({
                exito: false,
                mensaje: 'Error interno del servidor: respuesta vacía de PostgreSQL'
            });
        }
        
        const resultado = result.rows[0].resultado;
        console.log('📊 Resultado parseado:', resultado);
        
        if (resultado.exitoso) {
            console.log('✅ Asignación exitosa');
            res.json({
                exito: true,
                mensaje: resultado.mensaje,
                accion: resultado.accion
            });
        } else {
            console.log('❌ Error en asignación:', resultado.mensaje);
            res.status(400).json({
                exito: false,
                mensaje: resultado.mensaje,
                codigo_error: resultado.codigo_error
            });
        }
    } catch (error) {
        console.error('💥 Error asignando categoría:', error);
        res.status(500).json({
            exito: false,
            mensaje: 'Error asignando categoría',
            error: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
};

/**
 * @desc    Desasignar categoría de departamento
 * @route   POST /api/categorias/desasignar
 * @access  Administrador
 */
const desasignarCategoria = async (req, res) => {
    const { categoria_id, departamento_id, motivo = 'Desasignación manual' } = req.body;
    const usuarioId = req.user?.id;
    
    try {
        // 🔥 MODIFICADO: Verificar que el usuario sea admin
        if (req.user.rol !== 'administrador') {
            return res.status(403).json({
                exito: false,
                mensaje: 'Solo administradores pueden desasignar categorías'
            });
        }
        
        if (!categoria_id || !departamento_id) {
            return res.status(400).json({
                exito: false,
                mensaje: 'Categoría y departamento son requeridos'
            });
        }

        if (!usuarioId) {
            return res.status(401).json({
                exito: false,
                mensaje: 'Usuario no autenticado'
            });
        }

        const ipAddress = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;
        
        const query = `
            SELECT * FROM desasignar_categoria_departamento(
                $1, $2, $3, $4, $5
            ) as resultado;
        `;
        
        const result = await db.query(query, [
            categoria_id, 
            departamento_id, 
            usuarioId, 
            motivo,
            ipAddress
        ]);
        
        if (!result.rows[0] || !result.rows[0].resultado) {
            return res.status(500).json({
                exito: false,
                mensaje: 'Error interno del servidor'
            });
        }
        
        const resultado = result.rows[0].resultado;
        
        if (resultado.exitoso) {
            res.json({
                exito: true,
                mensaje: resultado.mensaje,
                documentos_afectados: resultado.documentos_afectados
            });
        } else {
            res.status(400).json({
                exito: false,
                mensaje: resultado.mensaje,
                codigo_error: resultado.codigo_error
            });
        }
    } catch (error) {
        console.error('Error desasignando categoría:', error);
        res.status(500).json({
            exito: false,
            mensaje: 'Error desasignando categoría',
            error: error.message
        });
    }
};

/**
 * @desc    Transferir categoría entre departamentos
 * @route   POST /api/categorias/transferir
 * @access  Administrador
 */
const transferirCategoria = async (req, res) => {
    const { 
        categoria_id, 
        desde_departamento_id, 
        hacia_departamento_id, 
        transferir_documentos = false, 
        motivo = 'Reorganización administrativa' 
    } = req.body;
    const usuarioId = req.user?.id;
    
    console.log('🔥 === TRANSFERIR CATEGORÍA (CONTROLADOR) ===');
    console.log('📦 Datos recibidos:', { categoria_id, desde_departamento_id, hacia_departamento_id, transferir_documentos, motivo });
    console.log('👤 Usuario:', usuarioId);
    
    try {
        // 🔥 Verificar que el usuario sea admin
        if (req.user.rol !== 'administrador') {
            return res.status(403).json({
                exito: false,
                mensaje: 'Solo administradores pueden transferir categorías'
            });
        }
        
        // Validaciones
        if (!categoria_id) {
            return res.status(400).json({
                exito: false,
                mensaje: 'categoria_id es requerido'
            });
        }
        
        if (!desde_departamento_id) {
            return res.status(400).json({
                exito: false,
                mensaje: 'desde_departamento_id es requerido'
            });
        }
        
        if (!hacia_departamento_id) {
            return res.status(400).json({
                exito: false,
                mensaje: 'hacia_departamento_id es requerido'
            });
        }

        if (!usuarioId) {
            return res.status(401).json({
                exito: false,
                mensaje: 'Usuario no autenticado'
            });
        }

        const ipAddress = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress || '127.0.0.1';
        
        console.log('📞 Llamando a función PostgreSQL con parámetros:', {
            categoria_id,
            desde_departamento_id,
            hacia_departamento_id,
            usuarioId,
            transferir_documentos,
            motivo,
            ipAddress
        });
        
        // 🔥 ORDEN CORRECTO DE PARÁMETROS según la función PostgreSQL
        const query = `
            SELECT * FROM transferir_categoria_departamento(
                $1::INTEGER,   -- p_categoria_id
                $2::INTEGER,   -- p_desde_departamento_id
                $3::INTEGER,   -- p_hacia_departamento_id
                $4::INTEGER,   -- p_usuario_id
                $5::BOOLEAN,   -- p_transferir_documentos
                $6::TEXT,      -- p_motivo
                $7::TEXT       -- p_ip_address
            ) as resultado;
        `;
        
        const result = await db.query(query, [
            parseInt(categoria_id),
            parseInt(desde_departamento_id),
            parseInt(hacia_departamento_id),
            parseInt(usuarioId),
            transferir_documentos === true || transferir_documentos === 'true',
            motivo || 'Reorganización administrativa',
            ipAddress
        ]);
        
        console.log('📥 Respuesta de PostgreSQL:', JSON.stringify(result.rows[0], null, 2));
        
        if (!result.rows[0] || !result.rows[0].resultado) {
            console.error('❌ PostgreSQL devolvió resultado vacío');
            return res.status(500).json({
                exito: false,
                mensaje: 'Error interno del servidor: respuesta vacía de PostgreSQL'
            });
        }
        
        const resultado = result.rows[0].resultado;
        console.log('📊 Resultado parseado:', resultado);
        
        if (resultado.exitoso) {
            console.log('✅ Transferencia exitosa');
            res.json({
                exito: true,
                mensaje: resultado.mensaje,
                detalles: resultado.detalles
            });
        } else {
            console.log('❌ Error en transferencia:', resultado.mensaje);
            res.status(400).json({
                exito: false,
                mensaje: resultado.mensaje,
                codigo_error: resultado.codigo_error || 'ERROR_TRANSFERENCIA'
            });
        }
    } catch (error) {
        console.error('💥 Error transfiriendo categoría:', error);
        console.error('Stack:', error.stack);
        res.status(500).json({
            exito: false,
            mensaje: 'Error transfiriendo categoría',
            error: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
};

/**
 * @desc    Obtener estadísticas de categorías
 * @route   GET /api/categorias/estadisticas
 * @access  Administrador
 */
const obtenerEstadisticasCategorias = async (req, res) => {
    try {
        // 🔥 MODIFICADO: Verificar que el usuario sea admin
        if (req.user.rol !== 'administrador') {
            return res.status(403).json({
                exito: false,
                mensaje: 'Solo administradores pueden ver estadísticas globales'
            });
        }
        
        const query = `
            WITH estadisticas AS (
                SELECT 
                    c.id,
                    c.nombre,
                    c.codigo,
                    c.exclusiva,
                    COUNT(DISTINCT CASE WHEN cd.activo = true THEN cd.departamento_id END) as departamentos_asignados,
                    COUNT(DISTINCT dc.documento_id) as total_documentos,
                    COALESCE(SUM(d.tamaño_archivo), 0) as espacio_total_bytes
                FROM categorias_documento c
                LEFT JOIN categorias_departamentos cd ON c.id = cd.categoria_id
                LEFT JOIN documentos_categorias dc ON c.id = dc.categoria_id
                LEFT JOIN documentos d ON dc.documento_id = d.id AND d.eliminado = false
                GROUP BY c.id
            )
            SELECT 
                COUNT(*) as total_categorias,
                COUNT(*) FILTER (WHERE exclusiva = true) as categorias_exclusivas,
                SUM(departamentos_asignados) as total_asignaciones,
                SUM(total_documentos) as documentos_categorizados,
                ROUND(AVG(departamentos_asignados), 2) as promedio_asignaciones,
                ROUND(SUM(espacio_total_bytes) / (1024*1024*1024), 2) as espacio_total_gb
            FROM estadisticas;
        `;
        
        const result = await db.query(query);
        
        res.json({
            exito: true,
            estadisticas: result.rows[0]
        });
    } catch (error) {
        console.error('Error obteniendo estadísticas:', error);
        res.status(500).json({
            exito: false,
            mensaje: 'Error obteniendo estadísticas',
            error: error.message
        });
    }
};

/**
 * @desc    Obtener historial de asignaciones
 * @route   GET /api/categorias/historial
 * @access  Administrador
 */
const obtenerHistorialAsignaciones = async (req, res) => {
    const { categoria_id, departamento_id, dias_atras } = req.query;
    
    try {
        // 🔥 MODIFICADO: Verificar que el usuario sea admin
        if (req.user.rol !== 'administrador') {
            return res.status(403).json({
                exito: false,
                mensaje: 'Solo administradores pueden ver el historial de asignaciones'
            });
        }
        
        const query = `
            SELECT 
                h.id,
                h.categoria_id,
                c.nombre as categoria_nombre,
                h.departamento_id,
                d.nombre as departamento_nombre,
                h.accion,
                h.detalles,
                h.usuario_responsable_id,
                u.nombre_completo as usuario_responsable_nombre,
                h.ip_address,
                h.fecha
            FROM historial_categorias_departamentos h
            JOIN categorias_documento c ON h.categoria_id = c.id
            JOIN departamentos d ON h.departamento_id = d.id
            LEFT JOIN usuarios u ON h.usuario_responsable_id = u.id
            WHERE ($1::INTEGER IS NULL OR h.categoria_id = $1)
            AND ($2::INTEGER IS NULL OR h.departamento_id = $2)
            AND h.fecha >= CURRENT_DATE - (COALESCE($3, 30) || ' days')::INTERVAL
            ORDER BY h.fecha DESC
            LIMIT 100;
        `;
        
        const result = await db.query(query, [
            categoria_id || null,
            departamento_id || null,
            dias_atras || 30
        ]);
        
        res.json({
            exito: true,
            historial: result.rows
        });
    } catch (error) {
        console.error('Error obteniendo historial:', error);
        res.status(500).json({
            exito: false,
            mensaje: 'Error obteniendo historial',
            error: error.message
        });
    }
};


/**
 * @desc    Obtener asignaciones de una categoría específica
 * @route   GET /api/categorias/:id/asignaciones
 * @access  Administrador 
 */
const obtenerAsignacionesCategoria = async (req, res) => {
    const { id } = req.params;
    const { soloActivas = true } = req.query;
    
    try {
        // 🔥 MODIFICADO: Verificar que el usuario sea admin
        if (req.user.rol !== 'administrador') {
            return res.status(403).json({
                exito: false,
                mensaje: 'Solo administradores pueden ver asignaciones de categorías'
            });
        }
        
        const query = `
            SELECT * FROM obtener_asignaciones_categoria($1)
            WHERE ($2 = false OR asignacion_activa = true)
        `;
        
        const result = await db.query(query, [id, soloActivas === 'true']);
        
        res.json({
            exito: true,
            asignaciones: result.rows
        });
    } catch (error) {
        console.error('Error obteniendo asignaciones:', error);
        res.status(500).json({
            exito: false,
            mensaje: 'Error obteniendo asignaciones',
            error: error.message
        });
    }
};

/**
 * @desc    Obtener departamentos con categoría específica
 * @route   GET /api/categorias/:categoriaId/departamentos
 * @access  Administrador
 */

const obtenerDepartamentosConCategoria = async (req, res) => {
    const { categoriaId } = req.params;
    const { soloActivos = true } = req.query;
    
    try {
        if (req.user.rol !== 'administrador') {
            return res.status(403).json({
                exito: false,
                mensaje: 'Solo administradores pueden ver departamentos con categoría'
            });
        }
        
        console.log(`📋 Obteniendo departamentos para categoría ${categoriaId}, soloActivos=${soloActivos}`);
        
        // 🔥 CORREGIDO: Asegurar que siempre se devuelva departamento_id
        const query = `
            SELECT 
                d.id as departamento_id,
                d.nombre as departamento_nombre,
                d.codigo as departamento_codigo,
                d.activo as departamento_activo,
                cd.activo as asignacion_activa,
                cd.fecha_asignacion,
                cd.fecha_desasignacion,
                COALESCE(COUNT(DISTINCT doc.id), 0) as documentos_en_categoria
            FROM categorias_departamentos cd
            JOIN departamentos d ON cd.departamento_id = d.id
            LEFT JOIN documentos_categorias dc ON cd.categoria_id = dc.categoria_id AND dc.documento_id IS NOT NULL
            LEFT JOIN documentos doc ON dc.documento_id = doc.id 
                AND doc.departamento_id = cd.departamento_id
                AND doc.eliminado = false
            WHERE cd.categoria_id = $1
            GROUP BY d.id, d.nombre, d.codigo, d.activo, cd.activo, cd.fecha_asignacion, cd.fecha_desasignacion
            ORDER BY d.nombre;
        `;
        
        const result = await db.query(query, [categoriaId]);
        
        // 🔥 FILTRAR en JavaScript en lugar de SQL para asegurar datos
        let departamentos = result.rows;
        
        if (soloActivos === 'true' || soloActivos === true) {
            departamentos = departamentos.filter(d => d.asignacion_activa === true);
        }
        
        console.log(`✅ Encontrados ${departamentos.length} departamentos`);
        console.log('📋 Primer departamento:', departamentos[0]);
        
        res.json({
            exito: true,
            departamentos: departamentos
        });
    } catch (error) {
        console.error('Error obteniendo departamentos:', error);
        res.status(500).json({
            exito: false,
            mensaje: 'Error obteniendo departamentos',
            error: error.message
        });
    }
};

/**
 * @desc    Verificar si una categoría puede ser asignada a un departamento
 * @route   GET /api/categorias/:categoriaId/verificar/:departamentoId
 * @access  Administrador
 */
const verificarAsignacionCategoria = async (req, res) => {
    const { categoriaId, departamentoId } = req.params;
    
    try {
        // 🔥 MODIFICADO: Verificar que el usuario sea admin
        if (req.user.rol !== 'administrador') {
            return res.status(403).json({
                exito: false,
                mensaje: 'Solo administradores pueden verificar asignaciones'
            });
        }
        
        const query = `
            SELECT 
                CASE 
                    WHEN NOT EXISTS (SELECT 1 FROM categorias_documento WHERE id = $1 AND activo = true) THEN
                        jsonb_build_object(
                            'puede_asignar', false,
                            'mensaje', 'La categoría no existe o está inactiva',
                            'codigo_error', 'CATEGORIA_INACTIVA'
                        )
                    WHEN NOT EXISTS (SELECT 1 FROM departamentos WHERE id = $2 AND activo = true) THEN
                        jsonb_build_object(
                            'puede_asignar', false,
                            'mensaje', 'El departamento no existe o está inactivo',
                            'codigo_error', 'DEPARTAMENTO_INACTIVO'
                        )
                    WHEN EXISTS (
                        SELECT 1 FROM categorias_departamentos 
                        WHERE categoria_id = $1 
                        AND departamento_id = $2 
                        AND activo = true
                    ) THEN
                        jsonb_build_object(
                            'puede_asignar', false,
                            'mensaje', 'La categoría ya está asignada a este departamento',
                            'codigo_error', 'ASIGNACION_EXISTENTE'
                        )
                    WHEN EXISTS (
                        SELECT 1 FROM categorias_departamentos cd
                        JOIN categorias_documento c ON cd.categoria_id = c.id
                        WHERE cd.categoria_id = $1 
                        AND cd.departamento_id != $2
                        AND cd.activo = true
                        AND c.exclusiva = true
                    ) THEN
                        jsonb_build_object(
                            'puede_asignar', false,
                            'mensaje', 'Esta categoría es exclusiva y ya está asignada a otro departamento',
                            'codigo_error', 'CATEGORIA_EXCLUSIVA_ASIGNADA'
                        )
                    ELSE
                        jsonb_build_object(
                            'puede_asignar', true,
                            'mensaje', 'La categoría puede ser asignada'
                        )
                END as resultado;
        `;
        
        const result = await db.query(query, [categoriaId, departamentoId]);
        
        res.json(result.rows[0].resultado);
    } catch (error) {
        console.error('Error verificando asignación:', error);
        res.status(500).json({
            exito: false,
            mensaje: 'Error verificando asignación',
            error: error.message
        });
    }
};

/**
 * @desc    Obtener todas las categorías activas del sistema (para catálogo)
 * @route   GET /api/categorias/todas
 * @access  Autenticado (no requiere admin)
 */
const obtenerTodasCategorias = async (req, res) => {
    try {
        // 🔥 MODIFICADO: Este endpoint es público para usuarios autenticados
        // No requiere ser admin, solo estar autenticado
        console.log(`👤 Usuario ${req.user.rol} obteniendo todas las categorías del catálogo`);
        
        const query = `
            SELECT DISTINCT c.id, c.nombre, c.codigo
            FROM categorias_documento c
            WHERE c.activo = true
            ORDER BY c.nombre;
        `;
        
        const result = await db.query(query);
        
        res.json({
            success: true,
            categorias: result.rows
        });
    } catch (error) {
        console.error('Error obteniendo todas las categorías:', error);
        res.status(500).json({
            success: false,
            mensaje: 'Error obteniendo categorías',
            error: error.message
        });
    }
};

/**
 * @desc    Obtener estadísticas de categorías por departamento
 * @route   GET /api/categorias/departamento/:departamentoId/estadisticas
 * @access  Administrador, Jefe de Departamento
 */
const obtenerEstadisticasCategoriasPorDepartamento = async (req, res) => {
    const { departamentoId } = req.params;
    
    try {
        // 🔥 NUEVO: Verificar permisos
        if (req.user.rol !== 'administrador' && parseInt(departamentoId) !== req.user.departamento_id) {
            return res.status(403).json({
                exito: false,
                mensaje: 'No tienes permisos para ver estadísticas de este departamento'
            });
        }
        
        console.log(`${req.user.rol === 'administrador' ? '👑 Admin' : '👤 Usuario'} viendo estadísticas de categorías del departamento ${departamentoId}`);
        
        const query = `
            SELECT 
                COUNT(DISTINCT cd.categoria_id) as total_categorias_asignadas,
                COUNT(DISTINCT CASE WHEN cd.activo = true THEN cd.categoria_id END) as categorias_activas,
                COUNT(DISTINCT dc.documento_id) as documentos_categorizados,
                COUNT(DISTINCT CASE WHEN c.exclusiva = true THEN c.id END) as categorias_exclusivas
            FROM categorias_departamentos cd
            LEFT JOIN categorias_documento c ON cd.categoria_id = c.id
            LEFT JOIN documentos_categorias dc ON cd.categoria_id = dc.categoria_id
            WHERE cd.departamento_id = $1
        `;
        
        const result = await db.query(query, [departamentoId]);
        
        res.json({
            exito: true,
            estadisticas: result.rows[0]
        });
    } catch (error) {
        console.error('Error obteniendo estadísticas por departamento:', error);
        res.status(500).json({
            exito: false,
            mensaje: 'Error obteniendo estadísticas',
            error: error.message
        });
    }
};

// EXPORTAR TODAS LAS FUNCIONES
module.exports = {
    obtenerCategorias,
    crearCategoria,
    actualizarCategoria,
    obtenerCategoriasPorDepartamento,
    obtenerCategoriasDisponibles,
    asignarCategoria,
    desasignarCategoria,
    transferirCategoria,
    obtenerEstadisticasCategorias,
    obtenerHistorialAsignaciones,
    obtenerAsignacionesCategoria,
    obtenerDepartamentosConCategoria,
    verificarAsignacionCategoria,
    obtenerTodasCategorias,
    obtenerEstadisticasCategoriasPorDepartamento // ← NUEVO
};
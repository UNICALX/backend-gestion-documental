// controllers/AdminController.js 
const bcrypt = require('bcrypt');
const { pool } = require('../config/database');

class AdminController {
  // ==================== USUARIOS  ====================
  
  async getUsuarios(req, res) {
    try {
      const result = await pool.query(
        `SELECT u.id, u.correo, u.nombre_completo, u.rol, u.activo, 
                u.fecha_registro, u.departamento_id, d.nombre as departamento_nombre
         FROM usuarios u
         LEFT JOIN departamentos d ON u.departamento_id = d.id
         ORDER BY u.fecha_registro DESC`
      );
      res.json(result.rows);
    } catch (error) {
      console.error('Error obteniendo usuarios:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  }
  
  async getUsuarioById(req, res) {
    try {
      const { id } = req.params;
      const result = await pool.query(
        `SELECT u.id, u.correo, u.nombre_completo, u.rol, u.activo, 
                u.fecha_registro, u.departamento_id, d.nombre as departamento_nombre
         FROM usuarios u
         LEFT JOIN departamentos d ON u.departamento_id = d.id
         WHERE u.id = $1`,
        [id]
      );
      
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Usuario no encontrado' });
      }
      
      res.json(result.rows[0]);
    } catch (error) {
      console.error('Error obteniendo usuario:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  }

  // Obtener historial de un usuario específico 
  async getUsuarioHistorial(req, res) {
    try {
      const { id } = req.params;
      
      const result = await pool.query(
        `SELECT 
            h.*, 
            u_resp.nombre_completo as responsable_nombre,
            u_resp.correo as responsable_email
         FROM historial_usuarios h
         LEFT JOIN usuarios u_resp ON h.usuario_responsable_id = u_resp.id
         WHERE h.usuario_id = $1
         ORDER BY h.fecha DESC`,
        [id]
      );
      
      res.json({
        success: true,
        data: result.rows
      });
    } catch (error) {
      console.error('Error obteniendo historial de usuario:', error);
      res.status(500).json({ 
        success: false,
        error: 'Error interno del servidor' 
      });
    }
  }
  
  async createUsuario(req, res) {
    try {
      const { correo, nombre_completo, departamento_id, rol, activo = true, contrasena } = req.body;
      const usuarioResponsableId = req.user?.id;
      
      // Validaciones
      if (!correo || !nombre_completo || !contrasena) {
        return res.status(400).json({ error: 'Correo, nombre completo y contraseña son requeridos' });
      }
      
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(correo)) {
        return res.status(400).json({ error: 'Correo electrónico inválido' });
      }
      
      const rolesPermitidos = ['administrador', 'jefe', 'usuario'];
      if (rol && !rolesPermitidos.includes(rol)) {
        return res.status(400).json({ error: `Rol inválido. Debe ser: ${rolesPermitidos.join(', ')}` });
      }
      
      // Verificar si el correo ya existe
      const existingUser = await pool.query(
        'SELECT id FROM usuarios WHERE correo = $1',
        [correo]
      );
      
      if (existingUser.rows.length > 0) {
        return res.status(400).json({ error: 'El correo electrónico ya está registrado' });
      }
      
      // Verificar departamento si se proporciona
      if (departamento_id) {
        const deptExists = await pool.query(
          'SELECT id FROM departamentos WHERE id = $1 AND activo = true',
          [departamento_id]
        );
        if (deptExists.rows.length === 0) {
          return res.status(400).json({ error: 'Departamento no encontrado o inactivo' });
        }
      }
      
      // Hashear contraseña
      const saltRounds = 10;
      const hashContrasena = await bcrypt.hash(contrasena, saltRounds);
      
      // Insertar usuario
      const result = await pool.query(
        `INSERT INTO usuarios (correo, nombre_completo, departamento_id, rol, activo, hash_contrasena)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, correo, nombre_completo, rol, activo, fecha_registro, departamento_id`,
        [
          correo.toLowerCase().trim(),
          nombre_completo.trim(),
          departamento_id || null,
          rol || 'usuario',
          activo,
          hashContrasena
        ]
      );
      
      // Obtener nombre del departamento
      let usuario = result.rows[0];
      if (usuario.departamento_id) {
        const deptResult = await pool.query(
          'SELECT nombre FROM departamentos WHERE id = $1',
          [usuario.departamento_id]
        );
        usuario.departamento_nombre = deptResult.rows[0]?.nombre;
      }
      
      // Registrar en historial manualmente 
      await pool.query(
        `INSERT INTO historial_usuarios (
          usuario_id, accion, detalles, cambios, usuario_responsable_id, ip_address
        ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          usuario.id,
          'create',
          'Usuario creado en el sistema',
          JSON.stringify({
            correo: usuario.correo,
            nombre_completo: usuario.nombre_completo,
            rol: usuario.rol,
            activo: usuario.activo,
            departamento_id: usuario.departamento_id
          }),
          usuarioResponsableId || usuario.id,
          req.ip
        ]
      );
      
      res.status(201).json({
        message: 'Usuario creado exitosamente',
        usuario: usuario
      });
      
    } catch (error) {
      console.error('Error creando usuario:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  }
  
  async updateUsuario(req, res) {
    try {
      const { id } = req.params;
      const { correo, nombre_completo, departamento_id, rol, activo } = req.body;
      const usuarioResponsableId = req.user?.id;
      
      // Verificar si el usuario existe
      const userExists = await pool.query(
        'SELECT id FROM usuarios WHERE id = $1',
        [id]
      );
      
      if (userExists.rows.length === 0) {
        return res.status(404).json({ error: 'Usuario no encontrado' });
      }
      
      // Validar rol
      const rolesPermitidos = ['administrador', 'jefe', 'usuario'];
      if (rol && !rolesPermitidos.includes(rol)) {
        return res.status(400).json({ error: `Rol inválido. Debe ser: ${rolesPermitidos.join(', ')}` });
      }
      
      // Verificar departamento si se proporciona
      if (departamento_id) {
        const deptExists = await pool.query(
          'SELECT id FROM departamentos WHERE id = $1 AND activo = true',
          [departamento_id]
        );
        if (deptExists.rows.length === 0) {
          return res.status(400).json({ error: 'Departamento no encontrado o inactivo' });
        }
      }
      
      // Obtener datos actuales para comparar
      const usuarioActual = await pool.query(
        'SELECT correo, nombre_completo, rol, activo, departamento_id FROM usuarios WHERE id = $1',
        [id]
      );
      
      // Actualizar usuario 
      const result = await pool.query(
        `UPDATE usuarios 
         SET correo = COALESCE($1, correo),
             nombre_completo = COALESCE($2, nombre_completo),
             departamento_id = $3,
             rol = COALESCE($4, rol),
             activo = COALESCE($5, activo)
         WHERE id = $6
         RETURNING id, correo, nombre_completo, rol, activo, fecha_registro, departamento_id`,
        [
          correo ? correo.toLowerCase().trim() : null,
          nombre_completo ? nombre_completo.trim() : null,
          departamento_id || null,
          rol || null,
          activo !== undefined ? activo : null,
          id
        ]
      );
      
      // Obtener nombre del departamento
      let usuario = result.rows[0];
      if (usuario.departamento_id) {
        const deptResult = await pool.query(
          'SELECT nombre FROM departamentos WHERE id = $1',
          [usuario.departamento_id]
        );
        usuario.departamento_nombre = deptResult.rows[0]?.nombre;
      }
      
      // Registrar cambios en historial
      const cambios = [];
      if (correo && correo !== usuarioActual.rows[0].correo) cambios.push(`correo: ${usuarioActual.rows[0].correo} → ${correo}`);
      if (nombre_completo && nombre_completo !== usuarioActual.rows[0].nombre_completo) cambios.push(`nombre: ${usuarioActual.rows[0].nombre_completo} → ${nombre_completo}`);
      if (rol && rol !== usuarioActual.rows[0].rol) cambios.push(`rol: ${usuarioActual.rows[0].rol} → ${rol}`);
      if (activo !== undefined && activo !== usuarioActual.rows[0].activo) cambios.push(`estado: ${usuarioActual.rows[0].activo ? 'activo' : 'inactivo'} → ${activo ? 'activo' : 'inactivo'}`);
      
      if (cambios.length > 0) {
        // Determinar tipo de acción específica
        let accion = 'update';
        let detalles = 'Usuario actualizado';
        
        if (activo !== undefined && activo !== usuarioActual.rows[0].activo) {
          accion = activo ? 'activate' : 'deactivate';
          detalles = activo ? 'Usuario activado' : 'Usuario desactivado';
        } else if (rol && rol !== usuarioActual.rows[0].rol) {
          accion = 'change_role';
          detalles = 'Rol de usuario cambiado';
        } else if (departamento_id && departamento_id !== usuarioActual.rows[0].departamento_id) {
          accion = 'change_department';
          detalles = 'Departamento de usuario cambiado';
        }
        
        await pool.query(
          `INSERT INTO historial_usuarios (
            usuario_id, accion, detalles, cambios, usuario_responsable_id, ip_address
          ) VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            usuario.id,
            accion,
            detalles,
            JSON.stringify({
              cambios: cambios,
              responsable_id: usuarioResponsableId
            }),
            usuarioResponsableId,
            req.ip
          ]
        );
      }
      
      res.json({
        message: 'Usuario actualizado exitosamente',
        usuario: usuario
      });
      
    } catch (error) {
      console.error('Error actualizando usuario:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  }
  
  async deleteUsuario(req, res) {
    try {
      const { id } = req.params;
      const usuarioResponsableId = req.user?.id;
      
      // Verificar si el usuario existe
      const userExists = await pool.query(
        'SELECT id, correo FROM usuarios WHERE id = $1',
        [id]
      );
      
      if (userExists.rows.length === 0) {
        return res.status(404).json({ error: 'Usuario no encontrado' });
      }
      
      // No permitir eliminar al propio usuario administrador
      if (parseInt(id) === req.user.id) {
        return res.status(400).json({ error: 'No puedes eliminar tu propia cuenta' });
      }
      
      // Registrar antes de desactivar
      await pool.query(
        `INSERT INTO historial_usuarios (
          usuario_id, accion, detalles, cambios, usuario_responsable_id, ip_address
        ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          id,
          'deactivate',
          'Usuario desactivado del sistema',
          JSON.stringify({
            responsable_id: usuarioResponsableId,
            motivo: 'Desactivación por administrador'
          }),
          usuarioResponsableId,
          req.ip
        ]
      );
      
      // Desactivar usuario
      await pool.query(
        'UPDATE usuarios SET activo = false WHERE id = $1',
        [id]
      );
      
      res.json({
        message: 'Usuario desactivado exitosamente',
        usuario_id: id
      });
      
    } catch (error) {
      console.error('Error eliminando usuario:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  }
  
  // Cambiar estado de usuario (activar/desactivar) con historial
  async toggleUsuarioEstado(req, res) {
    try {
      const { id } = req.params;
      const { activo } = req.body;
      const usuarioResponsableId = req.user?.id;
      
      // Validar que activo sea booleano
      if (activo === undefined || typeof activo !== 'boolean') {
        return res.status(400).json({ error: 'El campo "activo" (booleano) es requerido' });
      }
      
      // Verificar si el usuario existe
      const userExists = await pool.query(
        'SELECT id, correo, activo FROM usuarios WHERE id = $1',
        [id]
      );
      
      if (userExists.rows.length === 0) {
        return res.status(404).json({ error: 'Usuario no encontrado' });
      }
      
      // No permitir desactivar al propio usuario administrador
      if (parseInt(id) === req.user.id && activo === false) {
        return res.status(400).json({ error: 'No puedes desactivar tu propia cuenta' });
      }
      
      // Registrar cambio de estado en historial
      const accion = activo ? 'activate' : 'deactivate';
      const detalles = activo ? 'Usuario activado en el sistema' : 'Usuario desactivado del sistema';
      
      await pool.query(
        `INSERT INTO historial_usuarios (
          usuario_id, accion, detalles, cambios, usuario_responsable_id
        ) VALUES ($1, $2, $3, $4, $5)`,
        [
          id,
          accion,
          detalles,
          JSON.stringify({
            estado_anterior: userExists.rows[0].activo,
            estado_nuevo: activo
          }),
          usuarioResponsableId
        ]
      );
      
      // Cambiar estado del usuario
      await pool.query(
        'UPDATE usuarios SET activo = $1 WHERE id = $2',
        [activo, id]
      );
      
      // Obtener usuario actualizado
      const result = await pool.query(
        `SELECT u.id, u.correo, u.nombre_completo, u.rol, u.activo, 
                u.fecha_registro, u.departamento_id, d.nombre as departamento_nombre
         FROM usuarios u
         LEFT JOIN departamentos d ON u.departamento_id = d.id
         WHERE u.id = $1`,
        [id]
      );
      
      res.json({
        message: `Usuario ${activo ? 'activado' : 'desactivado'} exitosamente`,
        usuario: result.rows[0]
      });
      
    } catch (error) {
      console.error('Error cambiando estado de usuario:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  }
  
  // Cambiar contraseña de usuario con historial
  async changeUserPassword(req, res) {
    try {
      const { id } = req.params;
      const { nuevaContrasena } = req.body;
      const usuarioResponsableId = req.user?.id;
      
      console.log(`🔐 Cambiando contraseña para usuario ${id}`);
      
      // Validar que la nueva contraseña sea proporcionada
      if (!nuevaContrasena) {
        return res.status(400).json({ 
          success: false,
          error: 'La nueva contraseña es requerida' 
        });
      }
      
      if (nuevaContrasena.length < 6) {
        return res.status(400).json({ 
          success: false,
          error: 'La contraseña debe tener al menos 6 caracteres' 
        });
      }
      
      // Verificar si el usuario existe
      const userExists = await pool.query(
        'SELECT id, correo FROM usuarios WHERE id = $1',
        [id]
      );
      
      if (userExists.rows.length === 0) {
        return res.status(404).json({ 
          success: false,
          error: 'Usuario no encontrado' 
        });
      }
      
      // Hashear nueva contraseña
      const saltRounds = 10;
      const hashContrasena = await bcrypt.hash(nuevaContrasena, saltRounds);
      
      // Registrar cambio de contraseña en historial
      await pool.query(
        `INSERT INTO historial_usuarios (
          usuario_id, accion, detalles, cambios, usuario_responsable_id
        ) VALUES ($1, 'change_password', 'Contraseña actualizada', $2, $3)`,
        [
          id,
          JSON.stringify({ accion: 'cambio_contrasena', responsable: usuarioResponsableId }),
          usuarioResponsableId
        ]
      );
      
      // Actualizar contraseña
      await pool.query(
        'UPDATE usuarios SET hash_contrasena = $1 WHERE id = $2',
        [hashContrasena, id]
      );
      
      console.log(`✅ Contraseña cambiada para usuario ${id}`);
      
      res.json({
        success: true,
        message: 'Contraseña actualizada exitosamente',
        usuario_id: id
      });
      
    } catch (error) {
      console.error('Error cambiando contraseña:', error);
      res.status(500).json({ 
        success: false,
        error: 'Error interno del servidor' 
      });
    }
  }

  // ==================== DEPARTAMENTOS ====================
  
// ==================== DEPARTAMENTOS ====================
  
  async getDepartamentos(req, res) {
    try {
      const result = await pool.query(
        `SELECT d.*, 
                COALESCE(ea.usado_bytes, 0) as espacio_usado,
                COALESCE(ea.limite_bytes, 5368709120) as espacio_limite,
                (SELECT COUNT(*) FROM usuarios u WHERE u.departamento_id = d.id AND u.activo = true) as total_usuarios,
                (SELECT COUNT(*) FROM documentos doc WHERE doc.departamento_id = d.id AND doc.eliminado = false) as total_documentos
         FROM departamentos d
         LEFT JOIN espacio_almacenamiento ea ON d.id = ea.departamento_id
         ORDER BY d.nombre`
      );
      res.json(result.rows);
    } catch (error) {
      console.error('Error obteniendo departamentos:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  }
  
  async createDepartamento(req, res) {
    try {
      const { nombre, codigo, descripcion, activo = true } = req.body;
      
      // Obtener usuarioResponsableId de forma segura
      let usuarioResponsableId = 1; // ID por defecto (usuario sistema)
      if (req.user && req.user.id) {
        usuarioResponsableId = req.user.id;
      }
      
      // Validaciones
      if (!nombre || !codigo) {
        return res.status(400).json({ error: 'Nombre y código son requeridos' });
      }
      
      // Verificar si el código ya existe
      const existingDept = await pool.query(
        'SELECT id FROM departamentos WHERE codigo = $1',
        [codigo.toUpperCase()]
      );
      
      if (existingDept.rows.length > 0) {
        return res.status(400).json({ error: 'El código de departamento ya está registrado' });
      }
      
      // Insertar departamento
      const result = await pool.query(
        `INSERT INTO departamentos (nombre, codigo, descripcion, activo)
         VALUES ($1, $2, $3, $4)
         RETURNING id, nombre, codigo, descripcion, activo, fecha_creacion`,
        [
          nombre.trim(),
          codigo.toUpperCase().trim(),
          descripcion?.trim() || '',
          activo
        ]
      );
      
      // Crear registro de espacio de almacenamiento
      await pool.query(
        'INSERT INTO espacio_almacenamiento (departamento_id) VALUES ($1)',
        [result.rows[0].id]
      );
      
      // Registrar en historial
      await pool.query(
        `INSERT INTO historial_departamentos (
          departamento_id, accion, detalles, cambios, usuario_responsable_id, ip_address
        ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          result.rows[0].id,
          'create',
          'Departamento creado',
          JSON.stringify({
            nombre: nombre,
            codigo: codigo,
            descripcion: descripcion,
            activo: activo
          }),
          usuarioResponsableId,
          req.ip || '127.0.0.1'
        ]
      );
      
      res.status(201).json({
        message: 'Departamento creado exitosamente',
        departamento: result.rows[0]
      });
      
    } catch (error) {
      console.error('Error creando departamento:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  }
  
  async updateDepartamento(req, res) {
    try {
      const { id } = req.params;
      const { nombre, codigo, descripcion, activo } = req.body;
      
      // Obtener usuarioResponsableId de forma segura
      let usuarioResponsableId = 1; // ID por defecto
      if (req.user && req.user.id) {
        usuarioResponsableId = req.user.id;
      }
      
      // Verificar si el departamento existe
      const deptExists = await pool.query(
        'SELECT id, nombre, codigo, activo FROM departamentos WHERE id = $1',
        [id]
      );
      
      if (deptExists.rows.length === 0) {
        return res.status(404).json({ error: 'Departamento no encontrado' });
      }
      
      // Verificar si el código ya existe (excluyendo el actual)
      if (codigo) {
        const existingCode = await pool.query(
          'SELECT id FROM departamentos WHERE codigo = $1 AND id != $2',
          [codigo.toUpperCase(), id]
        );
        
        if (existingCode.rows.length > 0) {
          return res.status(400).json({ error: 'El código de departamento ya está registrado' });
        }
      }
      
      // Obtener datos actuales para comparar
      const deptActual = deptExists.rows[0];
      
      // Actualizar departamento
      const result = await pool.query(
        `UPDATE departamentos 
         SET nombre = COALESCE($1, nombre),
             codigo = COALESCE($2, codigo),
             descripcion = COALESCE($3, descripcion),
             activo = COALESCE($4, activo),
             fecha_actualizacion = CURRENT_TIMESTAMP
         WHERE id = $5
         RETURNING id, nombre, codigo, descripcion, activo, fecha_creacion, fecha_actualizacion`,
        [
          nombre ? nombre.trim() : null,
          codigo ? codigo.toUpperCase().trim() : null,
          descripcion !== undefined ? descripcion.trim() : null,
          activo !== undefined ? activo : null,
          id
        ]
      );
      
      // Registrar cambios en historial
      const cambios = [];
      if (nombre && nombre !== deptActual.nombre) cambios.push(`nombre: ${deptActual.nombre} → ${nombre}`);
      if (codigo && codigo !== deptActual.codigo) cambios.push(`código: ${deptActual.codigo} → ${codigo}`);
      if (activo !== undefined && activo !== deptActual.activo) cambios.push(`estado: ${deptActual.activo ? 'activo' : 'inactivo'} → ${activo ? 'activo' : 'inactivo'}`);
      
      if (cambios.length > 0) {
        // Determinar tipo de acción
        let accion = 'update';
        let detalles = 'Departamento actualizado';
        
        if (activo !== undefined && activo !== deptActual.activo) {
          accion = activo ? 'activate' : 'deactivate';
          detalles = activo ? 'Departamento activado' : 'Departamento desactivado';
        }
        
        await pool.query(
          `INSERT INTO historial_departamentos (
            departamento_id, accion, detalles, cambios, usuario_responsable_id, ip_address
          ) VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            id,
            accion,
            detalles,
            JSON.stringify({
              cambios: cambios,
              responsable_id: usuarioResponsableId
            }),
            usuarioResponsableId,
            req.ip || '127.0.0.1'
          ]
        );
      }
      
      res.json({
        message: 'Departamento actualizado exitosamente',
        departamento: result.rows[0]
      });
      
    } catch (error) {
      console.error('Error actualizando departamento:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  }
  
  async deleteDepartamento(req, res) {
    try {
      const { id } = req.params;
      
      // Obtener usuarioResponsableId de forma segura
      let usuarioResponsableId = 1; // ID por defecto
      if (req.user && req.user.id) {
        usuarioResponsableId = req.user.id;
      }
      
      // Verificar si el departamento existe
      const deptExists = await pool.query(
        'SELECT id, nombre FROM departamentos WHERE id = $1',
        [id]
      );
      
      if (deptExists.rows.length === 0) {
        return res.status(404).json({ error: 'Departamento no encontrado' });
      }
      
      // Verificar si hay usuarios en el departamento
      const usersInDept = await pool.query(
        'SELECT COUNT(*) FROM usuarios WHERE departamento_id = $1 AND activo = true',
        [id]
      );
      
      if (parseInt(usersInDept.rows[0].count) > 0) {
        return res.status(400).json({ 
          error: 'No se puede eliminar el departamento porque tiene usuarios activos',
          total_usuarios: parseInt(usersInDept.rows[0].count)
        });
      }
      
      // Verificar si hay documentos en el departamento
      const docsInDept = await pool.query(
        'SELECT COUNT(*) FROM documentos WHERE departamento_id = $1 AND eliminado = false',
        [id]
      );
      
      if (parseInt(docsInDept.rows[0].count) > 0) {
        return res.status(400).json({ 
          error: 'No se puede eliminar el departamento porque tiene documentos',
          total_documentos: parseInt(docsInDept.rows[0].count)
        });
      }
      
      // Registrar en historial
      await pool.query(
        `INSERT INTO historial_departamentos (
          departamento_id, accion, detalles, cambios, usuario_responsable_id, ip_address
        ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          id,
          'deactivate',
          'Departamento desactivado',
          JSON.stringify({
            responsable_id: usuarioResponsableId,
            motivo: 'Desactivación por administrador'
          }),
          usuarioResponsableId,
          req.ip || '127.0.0.1'
        ]
      );
      
      // Desactivar departamento
      await pool.query(
        'UPDATE departamentos SET activo = false WHERE id = $1',
        [id]
      );
      
      res.json({
        message: 'Departamento desactivado exitosamente',
        departamento_id: id
      });
      
    } catch (error) {
      console.error('Error eliminando departamento:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  }
  
  async toggleDepartamentoStatus(req, res) {
    try {
      const { id } = req.params;
      const { activo } = req.body;
      
      // Obtener usuarioResponsableId de forma segura
      let usuarioResponsableId = 1; // ID por defecto (usuario sistema)
      if (req.user && req.user.id) {
        usuarioResponsableId = req.user.id;
      }
      
      // Validar que activo sea booleano
      if (activo === undefined || typeof activo !== 'boolean') {
        return res.status(400).json({ error: 'El campo "activo" (booleano) es requerido' });
      }
      
      // Verificar si el departamento existe
      const deptExists = await pool.query(
        'SELECT id, nombre, activo FROM departamentos WHERE id = $1',
        [id]
      );
      
      if (deptExists.rows.length === 0) {
        return res.status(404).json({ error: 'Departamento no encontrado' });
      }
      
      // Registrar cambio de estado en historial
      const accion = activo ? 'activate' : 'deactivate';
      const detalles = activo ? 'Departamento activado en el sistema' : 'Departamento desactivado del sistema';
      
      await pool.query(
        `INSERT INTO historial_departamentos (
          departamento_id, accion, detalles, cambios, usuario_responsable_id, ip_address
        ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          id,
          accion,
          detalles,
          JSON.stringify({
            estado_anterior: deptExists.rows[0].activo,
            estado_nuevo: activo,
            ip: req.ip || '127.0.0.1'
          }),
          usuarioResponsableId,
          req.ip || '127.0.0.1'
        ]
      );
      
      // Cambiar estado del departamento
      await pool.query(
        'UPDATE departamentos SET activo = $1, fecha_actualizacion = CURRENT_TIMESTAMP WHERE id = $2',
        [activo, id]
      );
      
      // Obtener departamento actualizado
      const result = await pool.query(
        'SELECT * FROM departamentos WHERE id = $1',
        [id]
      );
      
      res.json({
        message: `Departamento ${activo ? 'activado' : 'desactivado'} exitosamente`,
        departamento: result.rows[0]
      });
      
    } catch (error) {
      console.error('Error cambiando estado de departamento:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  }
  
  // Obtener historial de un departamento específico
  async getDepartamentoHistorial(req, res) {
    try {
      const { id } = req.params;
      
      const result = await pool.query(
        `SELECT 
            h.*, 
            u_resp.nombre_completo as responsable_nombre,
            u_resp.correo as responsable_email
         FROM historial_departamentos h
         LEFT JOIN usuarios u_resp ON h.usuario_responsable_id = u_resp.id
         WHERE h.departamento_id = $1
         ORDER BY h.fecha DESC`,
        [id]
      );
      
      res.json({
        success: true,
        data: result.rows
      });
    } catch (error) {
      console.error('Error obteniendo historial de departamento:', error);
      res.status(500).json({ 
        success: false,
        error: 'Error interno del servidor' 
      });
    }
  }

  // 🔥 AGREGAR ESTE NUEVO MÉTODO
async getDepartamentoById(req, res) {
  try {
    const { id } = req.params;
    
    console.log(`🔍 Obteniendo departamento ID: ${id}`);
    
    const result = await pool.query(
      `SELECT 
         d.*, 
         COALESCE(ea.usado_bytes, 0) as espacio_usado,
         COALESCE(ea.limite_bytes, 5368709120) as espacio_limite,
         (SELECT COUNT(*) FROM usuarios u WHERE u.departamento_id = d.id AND u.activo = true) as total_usuarios,
         (SELECT COUNT(*) FROM documentos doc WHERE doc.departamento_id = d.id AND doc.eliminado = false) as total_documentos,
         (SELECT COALESCE(SUM(tamaño_archivo), 0) FROM documentos doc WHERE doc.departamento_id = d.id AND doc.eliminado = false) as espacio_utilizado_bytes
       FROM departamentos d
       LEFT JOIN espacio_almacenamiento ea ON d.id = ea.departamento_id
       WHERE d.id = $1`,
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ 
        success: false,
        error: 'Departamento no encontrado' 
      });
    }
    
    res.json({
      success: true,
      departamento: result.rows[0]
    });
    
  } catch (error) {
    console.error('❌ Error obteniendo departamento por ID:', error);
    res.status(500).json({ 
      success: false,
      error: 'Error interno del servidor' 
    });
  }
}
// En controllers/adminController.js - AGREGAR ESTOS MÉTODOS

  /**
   * Obtener estadísticas de artículos (para admin dashboard)
   */
  async getArticulosStats(req, res) {
    try {
      const stats = await pool.query(
        `SELECT 
           COUNT(*) as total_articulos,
           SUM((SELECT COUNT(*) FROM departamento_articulos)) as total_asignaciones,
           json_agg(
             json_build_object(
               'articulo', a.nombre,
               'departamentos', (SELECT COUNT(*) FROM departamento_articulos WHERE articulo_id = a.id),
               'documentos', (SELECT COUNT(*) FROM documentos WHERE clasificacion_articulo = a.nombre AND eliminado = false)
             )
           ) as detalle
         FROM articulos a
         WHERE a.activo = true`
      );
      
      res.json({
        success: true,
        data: stats.rows[0]
      });
    } catch (error) {
      console.error('Error obteniendo estadísticas de artículos:', error);
      res.status(500).json({ success: false, error: 'Error del servidor' });
    }
  }

  /**
   * Obtener todos los permisos de artículos (para admin)
   */
  async getAllArticulosPermisos(req, res) {
    try {
      const result = await pool.query(
        `SELECT 
           da.*,
           d.nombre as departamento_nombre,
           d.codigo as departamento_codigo,
           a.nombre as articulo_nombre,
           u.nombre_completo as asignado_por
         FROM departamento_articulos da
         JOIN departamentos d ON da.departamento_id = d.id
         JOIN articulos a ON da.articulo_id = a.id
         LEFT JOIN usuarios u ON da.usuario_asignador_id = u.id
         ORDER BY d.nombre, a.nombre`
      );
      
      res.json({
        success: true,
        data: result.rows
      });
    } catch (error) {
      console.error('Error obteniendo permisos de artículos:', error);
      res.status(500).json({ success: false, error: 'Error del servidor' });
    }
  }
  // ==================== DOCUMENTOS ====================
  
  async getAllDocuments(req, res) {
    try {
      const { 
        fecha_desde, 
        fecha_hasta, 
        usuario_id, 
        departamento_id, 
        tipo, 
        eliminado = false 
      } = req.query;

      let query = `
        SELECT 
          d.*,
          u.nombre_completo as usuario_nombre,
          dep.nombre as departamento_nombre,
          dep.codigo as departamento_codigo
        FROM documentos d
        JOIN usuarios u ON d.subido_por = u.id
        JOIN departamentos dep ON d.departamento_id = dep.id
        WHERE d.eliminado = $1
      `;

      const params = [eliminado === 'true'];
      let paramIndex = 2;

      if (usuario_id) {
        query += ` AND d.subido_por = $${paramIndex}`;
        params.push(parseInt(usuario_id));
        paramIndex++;
      }

      if (departamento_id) {
        query += ` AND d.departamento_id = $${paramIndex}`;
        params.push(parseInt(departamento_id));
        paramIndex++;
      }

      if (fecha_desde) {
        query += ` AND d.fecha_creacion >= $${paramIndex}`;
        params.push(fecha_desde);
        paramIndex++;
      }

      if (fecha_hasta) {
        query += ` AND d.fecha_creacion <= $${paramIndex}`;
        params.push(fecha_hasta);
        paramIndex++;
      }

      if (tipo) {
        query += ` AND d.tipo_archivo ILIKE $${paramIndex}`;
        params.push(`%${tipo}%`);
        paramIndex++;
      }

      query += ` ORDER BY d.fecha_creacion DESC`;

      const result = await pool.query(query, params);
      
      res.json({
        success: true,
        data: result.rows
      });

    } catch (error) {
      console.error('Error obteniendo documentos:', error);
      res.status(500).json({ 
        success: false,
        error: 'Error interno del servidor' 
      });
    }
  }
// ==================== DOCUMENTOS ====================

async getDocumentHistory(req, res) {
  try {
    const { id } = req.params;
    
    console.log('📋 Obteniendo historial para documento ID:', id);
    
    // Verificar si el documento existe
    const documentoExiste = await pool.query(
      'SELECT id, titulo FROM documentos WHERE id = $1',
      [id]
    );
    
    if (documentoExiste.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Documento no encontrado'
      });
    }
    
    // Obtener el documento actual para comparar
    const documentoActual = await pool.query(
      'SELECT id, titulo, descripcion, fecha_creacion, fecha_actualizacion FROM documentos WHERE id = $1',
      [id]
    );
    
    // Intentar obtener historial REAL de historial_documentos
    let historialReal = [];
    try {
      const historialResult = await pool.query(
        `SELECT 
            h.*,
            COALESCE(u_resp.nombre_completo, 'Sistema') as responsable_nombre,
            COALESCE(u_resp.correo, 'sistema@localhost') as responsable_email,
            COALESCE(u_resp.rol, 'system') as responsable_rol,
            d.titulo as documento_nombre,
            dep.nombre as departamento_nombre
         FROM historial_documentos h
         LEFT JOIN usuarios u_resp ON h.usuario_responsable_id = u_resp.id
         JOIN documentos d ON h.documento_id = d.id
         LEFT JOIN departamentos dep ON d.departamento_id = dep.id
         WHERE h.documento_id = $1
         ORDER BY h.fecha DESC
         LIMIT 100`,
        [id]
      );
      
      historialReal = historialResult.rows;
      console.log(`📊 Historial REAL encontrado: ${historialReal.length} registros`);
      
    } catch (historialError) {
      console.log('⚠️ No se pudo obtener historial real:', historialError.message);
    }
    
    // Si NO hay historial real, construir uno con información disponible
    if (historialReal.length === 0) {
      console.log('⚠️ Construyendo historial de respaldo...');
      
      // 🔥 MODIFICADO: Ahora detecta cambios de título correctamente
      const backupQuery = `
        -- Creación del documento
        SELECT 
          'create' as accion,
          'Documento creado en el sistema' as detalles,
          u_creador.nombre_completo as responsable_nombre,
          u_creador.correo as responsable_email,
          d.fecha_creacion as fecha,
          'system' as ip_address,
          jsonb_build_object(
            'titulo', d.titulo,
            'tipo_archivo', d.tipo_archivo,
            'tamaño', d.tamaño_archivo,
            'creador', u_creador.nombre_completo
          ) as cambios
        FROM documentos d
        JOIN usuarios u_creador ON d.subido_por = u_creador.id
        WHERE d.id = $1
        
        UNION ALL
        
        -- 🔥 REGISTRO DE MODIFICACIONES (detecta si fue renombrado o actualización)
        SELECT 
          CASE 
            -- Si el título cambió pero no la descripción, es un renombrado
            WHEN d.titulo != (SELECT titulo FROM documentos WHERE id = $1 AND fecha_actualizacion = d.fecha_actualizacion LIMIT 1)
            THEN 'rename'
            ELSE 'update'
          END as accion,
          CASE 
            WHEN d.titulo != (SELECT titulo FROM documentos WHERE id = $1 AND fecha_actualizacion < d.fecha_actualizacion ORDER BY fecha_actualizacion DESC LIMIT 1)
            THEN 'Documento renombrado'
            ELSE 'Documento modificado'
          END as detalles,
          u_mod.nombre_completo as responsable_nombre,
          u_mod.correo as responsable_email,
          d.fecha_actualizacion as fecha,
          'system' as ip_address,
          jsonb_build_object(
            'ultima_modificacion', d.fecha_actualizacion,
            'titulo_anterior', (SELECT titulo FROM documentos WHERE id = $1 AND fecha_actualizacion < d.fecha_actualizacion ORDER BY fecha_actualizacion DESC LIMIT 1),
            'titulo_nuevo', d.titulo
          ) as cambios
        FROM documentos d
        JOIN usuarios u_mod ON d.subido_por = u_mod.id
        WHERE d.id = $1 
          AND d.fecha_actualizacion IS NOT NULL
          AND d.fecha_actualizacion != d.fecha_creacion
        
        UNION ALL
        
        -- Transferencias (si existen)
        SELECT 
          'transfer' as accion,
          'Documento transferido de departamento' as detalles,
          u_trans.nombre_completo as responsable_nombre,
          u_trans.correo as responsable_email,
          td.fecha_transferencia as fecha,
          'system' as ip_address,
          jsonb_build_object(
            'desde_departamento_id', td.desde_departamento_id,
            'hacia_departamento_id', td.hacia_departamento_id,
            'motivo', td.motivo
          ) as cambios
        FROM transferencias_departamento td
        JOIN usuarios u_trans ON td.transferido_por = u_trans.id
        WHERE td.documento_id = $1
        
        ORDER BY fecha DESC
      `;
      
      const backupResult = await pool.query(backupQuery, [id]);
      historialReal = backupResult.rows;
      console.log(`📊 Historial de respaldo generado: ${historialReal.length} registros`);
    }
    
    // Obtener información completa del documento
    const docInfoQuery = `
      SELECT 
        d.*,
        u_creador.nombre_completo as creador_nombre,
        u_creador.correo as creador_email,
        dep.nombre as departamento_nombre,
        td.nombre as tipo_documento_nombre,
        (
          SELECT COUNT(*) 
          FROM historial_documentos h2 
          WHERE h2.documento_id = d.id
        ) as total_registros_historial
      FROM documentos d
      JOIN usuarios u_creador ON d.subido_por = u_creador.id
      JOIN departamentos dep ON d.departamento_id = dep.id
      LEFT JOIN tipos_documento td ON d.tipo_documento_id = td.id
      WHERE d.id = $1
    `;
    
    const docInfoResult = await pool.query(docInfoQuery, [id]);
    const documento = docInfoResult.rows[0];
    
    // Formatear respuesta con las acciones correctas
    const historialFormateado = historialReal.map(registro => {
      // 🔥 CORRECCIÓN: Asegurar que los renombrados tengan la acción correcta
      let accionFinal = registro.accion;
      let detallesFinal = registro.detalles;
      
      // Si los detalles indican renombrado, forzar acción 'rename'
      if (registro.detalles && registro.detalles.toLowerCase().includes('renombrado')) {
        accionFinal = 'rename';
      }
      
      // Si hay cambios con título_anterior y título_nuevo, es un renombrado
      if (registro.cambios && 
          (registro.cambios.titulo_anterior || registro.cambios?.titulo_anterior)) {
        accionFinal = 'rename';
        detallesFinal = `Documento renombrado de "${registro.cambios.titulo_anterior}" a "${registro.cambios.titulo_nuevo}"`;
      }
      
      return {
        id: registro.id || `temp-${Date.now()}-${Math.random()}`,
        accion: accionFinal,
        accion_detallada: this.getAccionDetallada(accionFinal),
        detalles: detallesFinal,
        responsable_nombre: registro.responsable_nombre || 'Usuario desconocido',
        responsable_email: registro.responsable_email || 'sin-email@localhost',
        responsable_rol: registro.responsable_rol || 'usuario',
        fecha: registro.fecha,
        ip_address: registro.ip_address,
        cambios: registro.cambios ? (typeof registro.cambios === 'string' ? JSON.parse(registro.cambios) : registro.cambios) : null,
        es_real: !!registro.id
      };
    });
    
    // Agregar información de quién editó por última vez
    let ultimoEditor = null;
    let ultimaEdicion = null;
    
    if (historialFormateado.length > 0) {
      const ultimoRegistro = historialFormateado[0];
      ultimoEditor = ultimoRegistro.responsable_nombre;
      ultimaEdicion = ultimoRegistro.fecha;
    }
    
    res.json({
      success: true,
      data: {
        documento: {
          id: documento.id,
          titulo: documento.titulo,
          creador: documento.creador_nombre,
          fecha_creacion: documento.fecha_creacion,
          fecha_actualizacion: documento.fecha_actualizacion,
          estado: documento.eliminado ? 'eliminado' : documento.archivado ? 'archivado' : 'activo',
          departamento: documento.departamento_nombre,
          tipo_documento: documento.tipo_documento_nombre,
          total_registros_historial: documento.total_registros_historial || 0
        },
        historial: historialFormateado,
        resumen: {
          total_registros: historialFormateado.length,
          tiene_historial_real: historialFormateado.some(r => r.es_real),
          ultima_accion: historialFormateado[0]?.accion_detallada || 'Ninguna',
          ultimo_responsable: ultimoEditor,
          ultima_fecha: ultimaEdicion,
          mensaje: historialFormateado.some(r => r.es_real) 
            ? 'Historial completo obtenido de la base de datos'
            : '⚠️ Historial generado a partir de información disponible'
        }
      }
    });
    
  } catch (error) {
    console.error('❌ Error en getDocumentHistory:', error);
    res.status(500).json({
      success: false,
      error: 'Error obteniendo historial del documento',
      details: error.message
    });
  }
}
// Agrega esta función al AdminController para diagnosticar
async debugHistorialDocumento(req, res) {
  try {
    const { id } = req.params;
    
    console.log('🔍 DEBUG: Analizando historial para documento', id);
    
    // 1. Verificar si la tabla existe
    const tableExists = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'historial_documentos'
      )
    `);
    
    // 2. Verificar estructura de la tabla
    const tableStructure = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'historial_documentos'
      ORDER BY ordinal_position
    `);
    
    // 3. Verificar triggers
    const triggers = await pool.query(`
      SELECT tgname, tgtype, tgenabled
      FROM pg_trigger 
      WHERE tgrelid = 'historial_documentos'::regclass
    `);
    
    // 4. Verificar registros para este documento
    const registros = await pool.query(
      'SELECT COUNT(*) as total FROM historial_documentos WHERE documento_id = $1',
      [id]
    );
    
    // 5. Verificar documento
    const documento = await pool.query(
      'SELECT id, titulo, fecha_creacion, fecha_actualizacion FROM documentos WHERE id = $1',
      [id]
    );
    
    res.json({
      success: true,
      diagnostico: {
        tabla_existe: tableExists.rows[0].exists,
        estructura_tabla: tableStructure.rows,
        triggers: triggers.rows,
        registros_para_documento: parseInt(registros.rows[0].total),
        documento: documento.rows[0] || null,
        fecha_actual: new Date().toISOString()
      },
      recomendaciones: tableExists.rows[0].exists 
        ? 'La tabla existe. Si no hay registros, el trigger no está funcionando.'
        : 'La tabla historial_documentos NO EXISTE. Debes crearla.'
    });
    
  } catch (error) {
    console.error('Error en debug:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}
// Agrega esta función helper en la misma clase (puede ir al final)
getAccionDetallada(accion) {
  if (!accion) return 'DESCONOCIDO';
  
  const acciones = {
    'create': 'CREACIÓN',
    'insert': 'CREACIÓN',
    'upload': 'CREACIÓN',
    'update': 'MODIFICACIÓN',
    'modify': 'MODIFICACIÓN',
    'edit': 'MODIFICACIÓN',
    'delete': 'ELIMINACIÓN',
    'archive': 'ARCHIVADO',
    'restore': 'RESTAURACIÓN',
    'transfer': 'TRANSFERENCIA',
    'move': 'TRANSFERENCIA',
    'rename': 'CAMBIO DE NOMBRE',
    'share': 'COMPARTIR',
    'download': 'DESCARGA',
    'view': 'VISUALIZACIÓN',
    'activate': 'ACTIVACIÓN',
    'deactivate': 'DESACTIVACIÓN'
  };
  
  return acciones[accion.toLowerCase()] || accion.toUpperCase();
}

  // Obtener historial completo de un documento (con tabla historial_documentos)
  async getDocumentoHistorial(req, res) {
    try {
      const { id } = req.params;
      
      const result = await pool.query(
        `SELECT 
            h.*, 
            u_resp.nombre_completo as responsable_nombre,
            u_resp.correo as responsable_email,
            d.titulo as documento_nombre
         FROM historial_documentos h
         LEFT JOIN usuarios u_resp ON h.usuario_responsable_id = u_resp.id
         JOIN documentos d ON h.documento_id = d.id
         WHERE h.documento_id = $1
         ORDER BY h.fecha DESC`,
        [id]
      );
      
      res.json({
        success: true,
        data: result.rows
      });
    } catch (error) {
      console.error('Error obteniendo historial de documento:', error);
      res.status(500).json({ 
        success: false,
        error: 'Error interno del servidor' 
      });
    }
  }

  async getDocumentStats(req, res) {
    try {
      const statsQuery = `
        SELECT 
          COUNT(*) as total,
          COALESCE(SUM(tamaño_archivo), 0) as espacio_total,
          COUNT(CASE WHEN fecha_creacion >= NOW() - INTERVAL '7 days' THEN 1 END) as nuevos_7_dias
        FROM documentos
        WHERE eliminado = false
      `;

      const statsResult = await pool.query(statsQuery);
      
      const deptQuery = `
        SELECT 
          d.nombre as departamento,
          COUNT(doc.id) as cantidad
        FROM departamentos d
        LEFT JOIN documentos doc ON d.id = doc.departamento_id AND doc.eliminado = false
        WHERE d.activo = true
        GROUP BY d.id, d.nombre
        ORDER BY cantidad DESC
      `;

      const deptResult = await pool.query(deptQuery);
      
      const typeQuery = `
        SELECT 
          tipo_archivo as tipo,
          COUNT(*) as cantidad
        FROM documentos
        WHERE eliminado = false
        GROUP BY tipo_archivo
        ORDER BY cantidad DESC
      `;

      const typeResult = await pool.query(typeQuery);
      
      const dailyQuery = `
        SELECT 
          DATE(fecha_creacion) as fecha,
          COUNT(*) as cantidad
        FROM documentos
        WHERE eliminado = false 
          AND fecha_creacion >= NOW() - INTERVAL '30 days'
        GROUP BY DATE(fecha_creacion)
        ORDER BY fecha DESC
        LIMIT 30
      `;

      const dailyResult = await pool.query(dailyQuery);
      
      res.json({
        success: true,
        data: {
          total: parseInt(statsResult.rows[0].total),
          espacio_total: parseInt(statsResult.rows[0].espacio_total),
          por_departamento: deptResult.rows,
          por_tipo: typeResult.rows,
          por_dia: dailyResult.rows,
          nuevos_7_dias: parseInt(statsResult.rows[0].nuevos_7_dias)
        }
      });

    } catch (error) {
      console.error('Error obteniendo estadísticas de documentos:', error);
      res.status(500).json({ 
        success: false,
        error: 'Error interno del servidor' 
      });
    }
  }

  // ==================== LOGS DE ACTIVIDAD ====================
  
  async getActivityLogs(req, res) {
    try {
      const { limit = 100, tipo = 'all' } = req.query;
      
      console.log(`📊 Obteniendo logs de actividad - Tipo: ${tipo}, Límite: ${limit}`);

      let query = '';
      const params = [parseInt(limit)];

      if (tipo === 'usuarios') {
        query = `
          SELECT 
            'usuario' as tipo_entidad,
            h.id,
            h.usuario_id as entidad_id,
            h.accion,
            h.detalles,
            h.cambios,
            h.usuario_responsable_id,
            h.ip_address,
            h.fecha,
            u.correo as entidad_nombre,
            u.nombre_completo as usuario_nombre,
            u.correo as usuario_email,
            COALESCE(u_resp.nombre_completo, 'Sistema') as responsable_nombre,
            u_resp.correo as responsable_email,
            NULL as departamento_nombre,
            NULL as documento_nombre
          FROM historial_usuarios h
          JOIN usuarios u ON h.usuario_id = u.id
          LEFT JOIN usuarios u_resp ON h.usuario_responsable_id = u_resp.id
          ORDER BY h.fecha DESC
          LIMIT $1
        `;
      } else if (tipo === 'departamentos') {
        query = `
          SELECT 
            'departamento' as tipo_entidad,
            h.id,
            h.departamento_id as entidad_id,
            h.accion,
            h.detalles,
            h.cambios,
            h.usuario_responsable_id,
            h.ip_address,
            h.fecha,
            d.nombre as entidad_nombre,
            'Sistema' as usuario_nombre,
            'sistema@localhost' as usuario_email,
            COALESCE(u_resp.nombre_completo, 'Sistema') as responsable_nombre,
            u_resp.correo as responsable_email,
            d.nombre as departamento_nombre,
            NULL as documento_nombre
          FROM historial_departamentos h
          JOIN departamentos d ON h.departamento_id = d.id
          LEFT JOIN usuarios u_resp ON h.usuario_responsable_id = u_resp.id
          ORDER BY h.fecha DESC
          LIMIT $1
        `;
      } else if (tipo === 'documentos') {
        query = `
          SELECT 
            'documento' as tipo_entidad,
            h.id,
            h.documento_id as entidad_id,
            h.accion,
            h.detalles,
            h.cambios,
            h.usuario_responsable_id,
            h.ip_address,
            h.fecha,
            d.titulo as entidad_nombre,
            u.nombre_completo as usuario_nombre,
            u.correo as usuario_email,
            COALESCE(u_resp.nombre_completo, u.nombre_completo) as responsable_nombre,
            COALESCE(u_resp.correo, u.correo) as responsable_email,
            dep.nombre as departamento_nombre,
            d.titulo as documento_nombre
          FROM historial_documentos h
          JOIN documentos d ON h.documento_id = d.id
          JOIN usuarios u ON d.subido_por = u.id
          LEFT JOIN departamentos dep ON d.departamento_id = dep.id
          LEFT JOIN usuarios u_resp ON h.usuario_responsable_id = u_resp.id
          ORDER BY h.fecha DESC
          LIMIT $1
        `;
      } else {
        query = `
          SELECT 
            'usuario' as tipo_entidad,
            h.id,
            h.usuario_id as entidad_id,
            h.accion,
            h.detalles,
            h.cambios,
            h.usuario_responsable_id,
            h.ip_address,
            h.fecha,
            u.correo as entidad_nombre,
            u.nombre_completo as usuario_nombre,
            u.correo as usuario_email,
            COALESCE(u_resp.nombre_completo, 'Sistema') as responsable_nombre,
            u_resp.correo as responsable_email,
            NULL as departamento_nombre,
            NULL as documento_nombre
          FROM historial_usuarios h
          JOIN usuarios u ON h.usuario_id = u.id
          LEFT JOIN usuarios u_resp ON h.usuario_responsable_id = u_resp.id
          
          UNION ALL
          
          SELECT 
            'departamento' as tipo_entidad,
            h.id,
            h.departamento_id as entidad_id,
            h.accion,
            h.detalles,
            h.cambios,
            h.usuario_responsable_id,
            h.ip_address,
            h.fecha,
            d.nombre as entidad_nombre,
            'Sistema' as usuario_nombre,
            'sistema@localhost' as usuario_email,
            COALESCE(u_resp.nombre_completo, 'Sistema') as responsable_nombre,
            u_resp.correo as responsable_email,
            d.nombre as departamento_nombre,
            NULL as documento_nombre
          FROM historial_departamentos h
          JOIN departamentos d ON h.departamento_id = d.id
          LEFT JOIN usuarios u_resp ON h.usuario_responsable_id = u_resp.id
          
          UNION ALL
          
          SELECT 
            'documento' as tipo_entidad,
            h.id,
            h.documento_id as entidad_id,
            h.accion,
            h.detalles,
            h.cambios,
            h.usuario_responsable_id,
            h.ip_address,
            h.fecha,
            d.titulo as entidad_nombre,
            u.nombre_completo as usuario_nombre,
            u.correo as usuario_email,
            COALESCE(u_resp.nombre_completo, u.nombre_completo) as responsable_nombre,
            COALESCE(u_resp.correo, u.correo) as responsable_email,
            dep.nombre as departamento_nombre,
            d.titulo as documento_nombre
          FROM historial_documentos h
          JOIN documentos d ON h.documento_id = d.id
          JOIN usuarios u ON d.subido_por = u.id
          LEFT JOIN departamentos dep ON d.departamento_id = dep.id
          LEFT JOIN usuarios u_resp ON h.usuario_responsable_id = u_resp.id
          
          ORDER BY fecha DESC
          LIMIT $1
        `;
      }

      const result = await pool.query(query, params);
      
      console.log(`✅ Logs obtenidos exitosamente: ${result.rows.length} registros`);
      
      res.json({
        success: true,
        data: result.rows,
        total: result.rows.length,
        tipo: tipo,
        limite: parseInt(limit)
      });

    } catch (error) {
      console.error('❌ Error en getActivityLogs:', error.message);
      
      res.json({
        success: true,
        data: [],
        message: 'No hay registros de actividad disponibles',
        error_details: error.message
      });
    }
  }

  // ==================== ESTADÍSTICAS ====================
  
  async getEstadisticas(req, res) {
    try {
      const [
        usuariosStats,
        departamentosStats,
        documentosStats,
        espacioStats,
        actividadReciente
      ] = await Promise.all([
        pool.query(`
          SELECT 
            COUNT(*) as total,
            COUNT(*) FILTER (WHERE activo = true) as activos,
            COUNT(*) FILTER (WHERE activo = false) as inactivos,
            COUNT(*) FILTER (WHERE rol = 'administrador') as administradores,
            COUNT(*) FILTER (WHERE rol = 'jefe') as jefes,
            COUNT(*) FILTER (WHERE rol = 'usuario') as usuarios,
            COUNT(*) FILTER (WHERE fecha_registro >= CURRENT_DATE - INTERVAL '30 days') as nuevos_30_dias
          FROM usuarios
        `),
        
        pool.query(`
          SELECT 
            COUNT(*) as total,
            COUNT(*) FILTER (WHERE activo = true) as activos,
            COUNT(*) FILTER (WHERE activo = false) as inactivos
          FROM departamentos
        `),
        
        pool.query(`
          SELECT 
            COUNT(*) as total,
            COUNT(*) FILTER (WHERE eliminado = false) as activos,
            COUNT(*) FILTER (WHERE eliminado = true) as eliminados,
            COUNT(*) FILTER (WHERE fecha_creacion >= CURRENT_DATE - INTERVAL '7 days') as nuevos_7_dias,
            COALESCE(SUM(tamaño_archivo), 0) as espacio_total_bytes,
            COALESCE(AVG(tamaño_archivo), 0) as tamaño_promedio_bytes
          FROM documentos
        `),
        
        pool.query(`
          SELECT 
            COALESCE(SUM(usado_bytes), 0) as espacio_usado_total,
            COALESCE(SUM(limite_bytes), 0) as espacio_limite_total,
            COUNT(*) as departamentos_con_espacio
          FROM espacio_almacenamiento
        `),
        
        pool.query(`
          SELECT 
            'documento_subido' as tipo,
            COUNT(*) as cantidad,
            MAX(fecha_creacion) as ultima_actividad
          FROM documentos 
          WHERE fecha_creacion >= CURRENT_DATE - INTERVAL '7 days'
          UNION ALL
          SELECT 
            'transferencia' as tipo,
            COUNT(*) as cantidad,
            MAX(fecha_transferencia) as ultima_actividad
          FROM transferencias_departamento 
          WHERE fecha_transferencia >= CURRENT_DATE - INTERVAL '7 days'
          UNION ALL
          SELECT 
            'usuario_registrado' as tipo,
            COUNT(*) as cantidad,
            MAX(fecha_registro) as ultima_actividad
          FROM usuarios 
          WHERE fecha_registro >= CURRENT_DATE - INTERVAL '7 days'
          ORDER BY ultima_actividad DESC
        `)
      ]);
      
      const espacioUsadoTotal = parseInt(espacioStats.rows[0].espacio_usado_total);
      const espacioLimiteTotal = parseInt(espacioStats.rows[0].espacio_limite_total);
      const porcentajeUsoTotal = espacioLimiteTotal > 0 ? (espacioUsadoTotal / espacioLimiteTotal * 100) : 0;
      
      res.json({
        usuarios: usuariosStats.rows[0],
        departamentos: departamentosStats.rows[0],
        documentos: documentosStats.rows[0],
        espacio: {
          usado_total_bytes: espacioUsadoTotal,
          limite_total_bytes: espacioLimiteTotal,
          porcentaje_uso_total: parseFloat(porcentajeUsoTotal.toFixed(2)),
          departamentos_con_espacio: parseInt(espacioStats.rows[0].departamentos_con_espacio)
        },
        actividad_reciente: actividadReciente.rows,
        ultima_actualizacion: new Date().toISOString()
      });
      
    } catch (error) {
      console.error('Error obteniendo estadísticas:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  }
  
  async transferenciaMasiva(req, res) {
    try {
      const { desde_departamento_id, hacia_departamento_id, motivo, usuario_id } = req.body;
      const usuarioResponsableId = req.user?.id;
      
      if (!desde_departamento_id || !hacia_departamento_id) {
        return res.status(400).json({ error: 'Departamento origen y destino son requeridos' });
      }
      
      if (parseInt(desde_departamento_id) === parseInt(hacia_departamento_id)) {
        return res.status(400).json({ error: 'No se puede transferir al mismo departamento' });
      }
      
      // Verificar departamentos
      const [deptOrigen, deptDestino] = await Promise.all([
        pool.query('SELECT id, nombre FROM departamentos WHERE id = $1 AND activo = true', [desde_departamento_id]),
        pool.query('SELECT id, nombre FROM departamentos WHERE id = $1 AND activo = true', [hacia_departamento_id])
      ]);
      
      if (deptOrigen.rows.length === 0) {
        return res.status(404).json({ error: 'Departamento origen no encontrado o inactivo' });
      }
      
      if (deptDestino.rows.length === 0) {
        return res.status(404).json({ error: 'Departamento destino no encontrado o inactivo' });
      }
      
      // Contar documentos a transferir
      const countResult = await pool.query(
        'SELECT COUNT(*) FROM documentos WHERE departamento_id = $1 AND eliminado = false AND archivado = false',
        [desde_departamento_id]
      );
      
      const totalDocumentos = parseInt(countResult.rows[0].count);
      
      if (totalDocumentos === 0) {
        return res.status(400).json({ error: 'No hay documentos para transferir en el departamento origen' });
      }
      
      // Registrar en historial
      await pool.query(
        `INSERT INTO historial_documentos (
          documento_id, accion, detalles, cambios, usuario_responsable_id, ip_address
        ) VALUES (NULL, $1, $2, $3, $4, $5)`,
        [
          'transfer_mass',
          `Transferencia masiva iniciada: ${deptOrigen.rows[0].nombre} → ${deptDestino.rows[0].nombre}`,
          JSON.stringify({
            desde_departamento_id: desde_departamento_id,
            hacia_departamento_id: hacia_departamento_id,
            total_documentos: totalDocumentos,
            responsable_id: usuarioResponsableId,
            motivo: motivo
          }),
          usuarioResponsableId,
          req.ip
        ]
      );
      
      // Ejecutar función de transferencia masiva
      const transferResult = await pool.query(
        'SELECT transferir_documentos_masivos($1, $2, $3, $4) as resultado',
        [
          desde_departamento_id,
          hacia_departamento_id,
          usuario_id || req.user.id,
          motivo?.trim() || 'Reorganización administrativa'
        ]
      );
      
      const resultado = JSON.parse(transferResult.rows[0].resultado);
      
      if (!resultado.exitoso) {
        return res.status(500).json({ error: resultado.error || 'Error en la transferencia masiva' });
      }
      
      res.json({
        message: 'Transferencia masiva completada exitosamente',
        ...resultado,
        departamento_origen: deptOrigen.rows[0].nombre,
        departamento_destino: deptDestino.rows[0].nombre
      });
      
    } catch (error) {
      console.error('Error en transferencia masiva:', error);
      res.status(500).json({ error: 'Error realizando transferencia masiva' });
    }
  }
}

module.exports = new AdminController();
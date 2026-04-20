const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Document = sequelize.define('Document', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    nombre_original: {
        type: DataTypes.STRING,
        allowNull: false
    },
    nombre_archivo: {
        type: DataTypes.STRING,
        allowNull: false
    },
    ruta_ftp: {
        type: DataTypes.STRING,
        allowNull: false
    },
    tipo: {
        type: DataTypes.STRING(10),
        allowNull: false
    },
    tamaño: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    departamento_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
            model: 'departamentos',
            key: 'id'
        }
    },
    usuario_subida_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
            model: 'users',
            key: 'id'
        }
    },
    fecha_subida: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    },
    descripcion: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    estado: {
        type: DataTypes.ENUM('activo', 'eliminado'),
        defaultValue: 'activo'
    }
}, {
    tableName: 'documents',
    timestamps: false
});

module.exports = Document;
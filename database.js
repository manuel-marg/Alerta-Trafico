const knex = require('knex');

const dbConfig = {
    client: 'sqlite3',
    connection: {
        filename: './trafico.sqlite' // Nombre del archivo de la base de datos SQLite
    },
    useNullAsDefault: true, // Necesario para SQLite
};

const db = knex(dbConfig);

async function initializeDatabase() {
    try {
        // Verificar si la tabla 'mapas' existe
        const hasMapsTable = await db.schema.hasTable('mapas');

        if (!hasMapsTable) {
            // Crear la tabla 'mapas' si no existe
            await db.schema.createTable('mapas', (table) => {
                table.increments('id').primary(); // ID autoincremental
                table.string('nombre').notNullable(); // Nombre del mapa
                table.string('url').notNullable(); // URL de Google Maps
                table.string('ruta_captura').notNullable(); // Ruta de la imagen de captura
                table.integer('original_width'); // Ancho original de la imagen
                table.integer('original_height'); // Alto original de la imagen
                table.timestamp('fecha_creacion').defaultTo(db.fn.now()); // Fecha de creación
            });
            console.log('Tabla "mapas" creada exitosamente.');
        } else {
            // Verificar si las columnas de dimensiones ya existen, si no, agregarlas
            const hasWidthColumn = await db.schema.hasColumn('mapas', 'original_width');
            const hasHeightColumn = await db.schema.hasColumn('mapas', 'original_height');

            if (!hasWidthColumn) {
                await db.schema.table('mapas', (table) => {
                    table.integer('original_width'); // Ancho original de la imagen
                });
                console.log('Columna "original_width" agregada a la tabla "mapas".');
            }

            if (!hasHeightColumn) {
                await db.schema.table('mapas', (table) => {
                    table.integer('original_height'); // Alto original de la imagen
                });
                console.log('Columna "original_height" agregada a la tabla "mapas".');
            }

            console.log('La tabla "mapas" ya existe.');
        }

        // Verificar si la tabla 'rutas' existe
        const hasRoutesTable = await db.schema.hasTable('rutas');

        if (!hasRoutesTable) {
            // Crear la tabla 'rutas' si no existe
            await db.schema.createTable('rutas', (table) => {
                table.increments('id').primary(); // ID autoincremental
                table.string('nombre').notNullable(); // Nombre de la ruta
                table.integer('mapa_id').unsigned().notNullable(); // Relación con tabla mapas
                table.string('sentido').notNullable(); // Sentido/dirección de la ruta
                table.timestamp('fecha_creacion').defaultTo(db.fn.now()); // Fecha de creación

                // Llave foránea
                table.foreign('mapa_id').references('id').inTable('mapas').onDelete('CASCADE');
            });
            console.log('Tabla "rutas" creada exitosamente.');
        } else {
            console.log('La tabla "rutas" ya existe.');
        }

        // Verificar si la tabla 'zonas' existe
        const hasZonesTable = await db.schema.hasTable('zonas');

        if (!hasZonesTable) {
            // Crear la tabla 'zonas' si no existe
            await db.schema.createTable('zonas', (table) => {
                table.increments('id').primary(); // ID autoincremental
                table.integer('ruta_id').unsigned().notNullable(); // Relación con tabla rutas
                table.string('nombre').notNullable(); // Nombre de la zona
                table.integer('x').notNullable(); // Coordenada X en la imagen
                table.integer('y').notNullable(); // Coordenada Y en la imagen
                table.integer('orden').notNullable(); // Orden secuencial de la zona
                table.timestamp('fecha_creacion').defaultTo(db.fn.now()); // Fecha de creación

                // Llave foránea
                table.foreign('ruta_id').references('id').inTable('rutas').onDelete('CASCADE');
            });
            console.log('Tabla "zonas" creada exitosamente.');
        } else {
            console.log('La tabla "zonas" ya existe.');
        }
    } catch (error) {
        console.error('Error al inicializar la base de datos:', error);
        process.exit(1); // Salir si hay un error crítico
    }
}

module.exports = { db, initializeDatabase };

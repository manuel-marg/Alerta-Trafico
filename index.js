const express = require('express');
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const probe = require('probe-image-size');
const { db, initializeDatabase } = require('./database'); // Importar db y initializeDatabase

const app = express();
const port = 3000;

// Configurar EJS como motor de plantillas
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware para parsear datos de formularios y servir archivos estáticos
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Middleware para manejar PUT y DELETE desde formularios HTML
app.use((req, res, next) => {
    if (req.body && req.body._method) {
        req.method = req.body._method.toUpperCase();
        delete req.body._method;
    }
    next();
});

// Ruta principal para mostrar el formulario y la lista de mapas
app.get('/', async (req, res) => {
    try {
        const maps = await db('mapas').select('*'); // Obtener todos los mapas
        res.render('index', { screenshot: null, error: null, maps, view: 'home' }); // Pasar los mapas a la vista
    } catch (error) {
        console.error('Error al obtener los mapas:', error);
        res.render('index', { screenshot: null, error: 'Error al cargar los mapas.', maps: [], view: 'home' });
    }
});

// Ruta para mostrar la página de gestión de mapas
app.get('/maps', async (req, res) => {
    try {
        const maps = await db('mapas').select('*');
        res.render('index', { screenshot: null, error: null, maps, view: 'maps' });
    } catch (error) {
        console.error('Error al obtener los mapas:', error);
        res.render('index', { screenshot: null, error: 'Error al cargar los mapas.', maps: [], view: 'maps' });
    }
});

// Ruta para crear un nuevo mapa
app.post('/maps', async (req, res) => {
    const { name, url } = req.body;

    if (!name || name.trim() === '') {
        try {
            const maps = await db('mapas').select('*');
            return res.render('index', {
                screenshot: null,
                error: 'Por favor, introduce un nombre para el mapa.',
                maps,
                view: 'maps'
            });
        } catch (dbError) {
            console.error('Error al obtener los mapas para el error de nombre:', dbError);
            return res.render('index', {
                screenshot: null,
                error: 'Por favor, introduce un nombre para el mapa. (Error al cargar mapas)',
                maps: [],
                view: 'maps'
            });
        }
    }

    if (!url || !url.startsWith('https://www.google.com/maps')) {
        try {
            const maps = await db('mapas').select('*');
            return res.render('index', {
                screenshot: null,
                error: 'Por favor, introduce una URL válida de Google Maps.',
                maps,
                view: 'maps'
            });
        } catch (dbError) {
            console.error('Error al obtener los mapas para el error de URL:', dbError);
            return res.render('index', {
                screenshot: null,
                error: 'Por favor, introduce una URL válida de Google Maps. (Error al cargar mapas)',
                maps: [],
                view: 'maps'
            });
        }
    }

    try {
        // Solo guardar en la base de datos, no capturar pantalla
        await db('mapas').insert({
            nombre: name,
            url: url,
            ruta_captura: null, // No hay captura aún
            original_width: null, // No hay dimensiones aún
            original_height: null // No hay dimensiones aún
        });
        console.log('Mapa guardado en la base de datos.');

        res.redirect('/maps');
    } catch (error) {
        console.error('Error al guardar el mapa en DB:', error);
        try {
            const maps = await db('mapas').select('*');
            res.render('index', {
                screenshot: null,
                error: 'Ocurrió un error al guardar el mapa. Inténtalo de nuevo.',
                maps,
                view: 'maps'
            });
        } catch (dbError) {
            console.error('Error al obtener los mapas después de un error de captura:', dbError);
            res.render('index', {
                screenshot: null,
                error: 'Ocurrió un error al guardar el mapa. (Error al cargar mapas)',
                maps: [],
                view: 'maps'
            });
        }
    }
});

// Ruta para editar un mapa
app.get('/maps/:id/edit', async (req, res) => {
    try {
        const mapId = parseInt(req.params.id);
        const map = await db('mapas').where('id', mapId).first();
        const maps = await db('mapas').select('*');

        if (!map) {
            return res.status(404).render('index', {
                screenshot: null,
                error: 'Mapa no encontrado.',
                maps: maps,
                view: 'maps'
            });
        }

        res.render('index', { screenshot: null, error: null, map, maps, view: 'edit-map' });
    } catch (error) {
        console.error('Error al obtener el mapa para edición:', error);
        const maps = await db('mapas').select('*');
        res.render('index', { screenshot: null, error: 'Error al cargar el mapa para edición.', maps: [], view: 'maps' });
    }
});

// Ruta para actualizar un mapa
app.put('/maps/:id', async (req, res) => {
    const mapId = parseInt(req.params.id);
    const { name, url } = req.body;

    if (!name || name.trim() === '') {
        try {
            const existingMap = await db('mapas').where('id', mapId).first();
            const maps = await db('mapas').select('*');
            return res.render('index', {
                screenshot: null,
                error: 'Por favor, introduce un nombre para el mapa.',
                map: existingMap,
                maps,
                view: 'edit-map'
            });
        } catch (dbError) {
            console.error('Error al obtener los mapas para el error de nombre:', dbError);
            return res.render('index', {
                screenshot: null,
                error: 'Por favor, introduce un nombre para el mapa. (Error al cargar mapas)',
                map: null,
                maps: [],
                view: 'maps'
            });
        }
    }

    if (!url || !url.startsWith('https://www.google.com/maps')) {
        try {
            const existingMap = await db('mapas').where('id', mapId).first();
            const maps = await db('mapas').select('*');
            return res.render('index', {
                screenshot: null,
                error: 'Por favor, introduce una URL válida de Google Maps.',
                map: existingMap,
                maps,
                view: 'edit-map'
            });
        } catch (dbError) {
            console.error('Error al obtener los mapas para el error de URL:', dbError);
            return res.render('index', {
                screenshot: null,
                error: 'Por favor, introduce una URL válida de Google Maps. (Error al cargar mapas)',
                map: null,
                maps: [],
                view: 'maps'
            });
        }
    }

    try {
        await db('mapas')
            .where('id', mapId)
            .update({
                nombre: name,
                url: url
            });

        res.redirect('/maps');
    } catch (error) {
        console.error('Error al actualizar el mapa:', error);
        try {
            const existingMap = await db('mapas').where('id', mapId).first();
            const maps = await db('mapas').select('*');
            res.render('index', {
                screenshot: null,
                error: 'Ocurrió un error al actualizar el mapa. Inténtalo de nuevo.',
                map: existingMap,
                maps,
                view: 'edit-map'
            });
        } catch (dbError) {
            console.error('Error al obtener los mapas después de un error de actualización:', dbError);
            res.render('index', {
                screenshot: null,
                error: 'Ocurrió un error al actualizar el mapa. (Error al cargar mapas)',
                map: null,
                maps: [],
                view: 'maps'
            });
        }
    }
});

// Ruta para eliminar un mapa
app.delete('/maps/:id', async (req, res) => {
    try {
        const mapId = parseInt(req.params.id);

        // Primero verificamos si hay rutas asociadas a este mapa
        const associatedRoutes = await db('rutas').where('mapa_id', mapId);

        if (associatedRoutes.length > 0) {
            // Si hay rutas asociadas, también se eliminarán debido al CASCADE en la base de datos
            console.log(`Eliminando mapa con ID ${mapId} y sus rutas asociadas...`);
        }

        await db('mapas').where('id', mapId).del();

        res.redirect('/maps');
    } catch (error) {
        console.error('Error al eliminar el mapa:', error);
        const maps = await db('mapas').select('*');
        res.render('index', { screenshot: null, error: 'Error al eliminar el mapa.', maps: [], view: 'maps' });
    }
});

// Ruta para mostrar la página de gestión de rutas
app.get('/routes', async (req, res) => {
    try {
        const maps = await db('mapas').select('*');
        const routes = await db('rutas')
            .select('rutas.*', 'mapas.nombre as mapa_nombre')
            .join('mapas', 'rutas.mapa_id', 'mapas.id');

        res.render('index', { screenshot: null, error: null, maps, routes, view: 'routes' });
    } catch (error) {
        console.error('Error al obtener las rutas:', error);
        const maps = await db('mapas').select('*');
        res.render('index', { screenshot: null, error: 'Error al cargar las rutas.', maps: [], routes: [], view: 'routes' });
    }
});

// Ruta para mostrar el formulario de selección de mapa para crear ruta
app.get('/routes/create', async (req, res) => {
    try {
        const mapId = parseInt(req.query.mapId);
        const selectedMap = await db('mapas').where('id', mapId).first();
        const maps = await db('mapas').select('*');

        if (!selectedMap) {
            return res.status(404).render('index', {
                screenshot: null,
                error: 'Mapa no encontrado.',
                maps,
                view: 'routes'
            });
        }

        res.render('index', { screenshot: null, error: null, selectedMap, maps, view: 'create-route' });
    } catch (error) {
        console.error('Error al obtener el mapa para crear ruta:', error);
        const maps = await db('mapas').select('*');
        res.render('index', { screenshot: null, error: 'Error al cargar el mapa para crear ruta.', maps: [], view: 'routes' });
    }
});

// Ruta para crear una nueva ruta
app.post('/routes', async (req, res) => {
    const { nombre, sentido, mapa_id } = req.body;

    if (!nombre || nombre.trim() === '') {
        try {
            const selectedMap = await db('mapas').where('id', mapa_id).first();
            const maps = await db('mapas').select('*');
            return res.render('index', {
                screenshot: null,
                error: 'Por favor, introduce un nombre para la ruta.',
                selectedMap,
                maps,
                view: 'create-route'
            });
        } catch (dbError) {
            console.error('Error al obtener los mapas para el error de nombre de ruta:', dbError);
            return res.render('index', {
                screenshot: null,
                error: 'Por favor, introduce un nombre para la ruta. (Error al cargar mapas)',
                selectedMap: null,
                maps: [],
                view: 'routes'
            });
        }
    }

    if (!sentido || sentido.trim() === '') {
        try {
            const selectedMap = await db('mapas').where('id', mapa_id).first();
            const maps = await db('mapas').select('*');
            return res.render('index', {
                screenshot: null,
                error: 'Por favor, introduce el sentido de la ruta.',
                selectedMap,
                maps,
                view: 'create-route'
            });
        } catch (dbError) {
            console.error('Error al obtener los mapas para el error de sentido de ruta:', dbError);
            return res.render('index', {
                screenshot: null,
                error: 'Por favor, introduce el sentido de la ruta. (Error al cargar mapas)',
                selectedMap: null,
                maps: [],
                view: 'routes'
            });
        }
    }

    try {
        // Crear la nueva ruta
        const [routeId] = await db('rutas').insert({
            nombre: nombre,
            sentido: sentido,
            mapa_id: parseInt(mapa_id)
        });

        // Redirigir a la página de definición de zonas para esta ruta
        res.redirect(`/routes/${routeId}/zones`);
    } catch (error) {
        console.error('Error al crear la ruta:', error);
        try {
            const selectedMap = await db('mapas').where('id', mapa_id).first();
            const maps = await db('mapas').select('*');
            res.render('index', {
                screenshot: null,
                error: 'Ocurrió un error al crear la ruta. Inténtalo de nuevo.',
                selectedMap,
                maps,
                view: 'create-route'
            });
        } catch (dbError) {
            console.error('Error al obtener los mapas después de un error de creación de ruta:', dbError);
            res.render('index', {
                screenshot: null,
                error: 'Ocurrió un error al crear la ruta. (Error al cargar mapas)',
                selectedMap: null,
                maps: [],
                view: 'routes'
            });
        }
    }
});

// Ruta para mostrar la página de definición de zonas para una ruta específica
app.get('/routes/:id/zones', async (req, res) => {
    try {
        const routeId = parseInt(req.params.id);
        const currentRoute = await db('rutas').where('id', routeId).first();

        if (!currentRoute) {
            const maps = await db('mapas').select('*');
            return res.status(404).render('index', {
                screenshot: null,
                error: 'Ruta no encontrada.',
                maps,
                view: 'routes'
            });
        }

        const mapWithRoute = await db('mapas').where('id', currentRoute.mapa_id).first();
        const zones = await db('zonas').where('ruta_id', routeId).orderBy('orden');
        const maps = await db('mapas').select('*');

        res.render('index', {
            screenshot: null,
            error: null,
            currentRoute,
            mapWithRoute,
            zones,
            maps,
            view: 'define-zones'
        });
    } catch (error) {
        console.error('Error al obtener la ruta y sus zonas:', error);
        const maps = await db('mapas').select('*');
        res.render('index', {
            screenshot: null,
            error: 'Error al cargar la ruta y sus zonas.',
            maps: [],
            view: 'routes'
        });
    }
});

// Ruta para agregar una zona a una ruta
app.post('/zones', express.json(), async (req, res) => {
    const { ruta_id, x, y, nombre, orden } = req.body;

    try {
        await db('zonas').insert({
            ruta_id: parseInt(ruta_id),
            nombre: nombre,
            x: parseInt(x),
            y: parseInt(y),
            orden: parseInt(orden)
        });

        res.status(200).json({ success: true });
    } catch (error) {
        console.error('Error al agregar la zona:', error);
        res.status(500).json({ success: false, error: 'Error al agregar la zona' });
    }
});

// Ruta para eliminar una zona
app.delete('/zones/:id', async (req, res) => {
    try {
        const zoneId = parseInt(req.params.id);
        await db('zonas').where('id', zoneId).del();
        res.status(200).json({ success: true });
    } catch (error) {
        console.error('Error al eliminar la zona:', error);
        res.status(500).json({ success: false, error: 'Error al eliminar la zona' });
    }
});

// Ruta para mostrar el formulario de edición de ruta
app.get('/routes/:id/edit', async (req, res) => {
    try {
        const routeId = parseInt(req.params.id);
        const route = await db('rutas').where('id', routeId).first();

        if (!route) {
            const maps = await db('mapas').select('*');
            const allRoutes = await db('rutas')
                .select('rutas.*', 'mapas.nombre as mapa_nombre')
                .join('mapas', 'rutas.mapa_id', 'mapas.id');

            return res.status(404).render('index', {
                screenshot: null,
                error: 'Ruta no encontrada.',
                maps,
                routes: allRoutes,
                view: 'routes'
            });
        }

        const maps = await db('mapas').select('*');

        res.render('index', {
            screenshot: null,
            error: null,
            route,
            maps,
            view: 'edit-route'
        });
    } catch (error) {
        console.error('Error al obtener la ruta para edición:', error);
        const maps = await db('mapas').select('*');
        const allRoutes = await db('rutas')
            .select('rutas.*', 'mapas.nombre as mapa_nombre')
            .join('mapas', 'rutas.mapa_id', 'mapas.id');

        res.render('index', {
            screenshot: null,
            error: 'Error al cargar la ruta para edición.',
            maps,
            routes: allRoutes,
            view: 'routes'
        });
    }
});

// Ruta para actualizar una ruta
app.put('/routes/:id', async (req, res) => {
    const routeId = parseInt(req.params.id);
    const { nombre, sentido, mapa_id } = req.body;

    if (!nombre || nombre.trim() === '') {
        try {
            const route = await db('rutas').where('id', routeId).first();
            const maps = await db('mapas').select('*');
            const allRoutes = await db('rutas')
                .select('rutas.*', 'mapas.nombre as mapa_nombre')
                .join('mapas', 'rutas.mapa_id', 'mapas.id');

            return res.render('index', {
                screenshot: null,
                error: 'Por favor, introduce un nombre para la ruta.',
                route,
                maps,
                routes: allRoutes,
                view: 'edit-route'
            });
        } catch (dbError) {
            console.error('Error al obtener los datos para el error de edición de ruta:', dbError);
            const maps = await db('mapas').select('*');
            const allRoutes = await db('rutas')
                .select('rutas.*', 'mapas.nombre as mapa_nombre')
                .join('mapas', 'rutas.mapa_id', 'mapas.id');

            return res.render('index', {
                screenshot: null,
                error: 'Por favor, introduce un nombre para la ruta. (Error al cargar datos)',
                maps,
                routes: allRoutes,
                view: 'routes'
            });
        }
    }

    if (!sentido || sentido.trim() === '') {
        try {
            const route = await db('rutas').where('id', routeId).first();
            const maps = await db('mapas').select('*');
            const allRoutes = await db('rutas')
                .select('rutas.*', 'mapas.nombre as mapa_nombre')
                .join('mapas', 'rutas.mapa_id', 'mapas.id');

            return res.render('index', {
                screenshot: null,
                error: 'Por favor, introduce el sentido de la ruta.',
                route,
                maps,
                routes: allRoutes,
                view: 'edit-route'
            });
        } catch (dbError) {
            console.error('Error al obtener los datos para el error de edición de ruta:', dbError);
            const maps = await db('mapas').select('*');
            const allRoutes = await db('rutas')
                .select('rutas.*', 'mapas.nombre as mapa_nombre')
                .join('mapas', 'rutas.mapa_id', 'mapas.id');

            return res.render('index', {
                screenshot: null,
                error: 'Por favor, introduce el sentido de la ruta. (Error al cargar datos)',
                maps,
                routes: allRoutes,
                view: 'routes'
            });
        }
    }

    try {
        await db('rutas')
            .where('id', routeId)
            .update({
                nombre: nombre,
                sentido: sentido,
                mapa_id: parseInt(mapa_id)
            });

        res.redirect('/routes');
    } catch (error) {
        console.error('Error al actualizar la ruta:', error);
        try {
            const route = await db('rutas').where('id', routeId).first();
            const maps = await db('mapas').select('*');
            const allRoutes = await db('rutas')
                .select('rutas.*', 'mapas.nombre as mapa_nombre')
                .join('mapas', 'rutas.mapa_id', 'mapas.id');

            res.render('index', {
                screenshot: null,
                error: 'Ocurrió un error al actualizar la ruta. Inténtalo de nuevo.',
                route,
                maps,
                routes: allRoutes,
                view: 'edit-route'
            });
        } catch (dbError) {
            console.error('Error al obtener los datos después de un error de actualización de ruta:', dbError);
            const maps = await db('mapas').select('*');
            const allRoutes = await db('rutas')
                .select('rutas.*', 'mapas.nombre as mapa_nombre')
                .join('mapas', 'rutas.mapa_id', 'mapas.id');

            res.render('index', {
                screenshot: null,
                error: 'Ocurrió un error al actualizar la ruta. (Error al cargar datos)',
                maps,
                routes: allRoutes,
                view: 'routes'
            });
        }
    }
});

// Ruta para eliminar una ruta
app.delete('/routes/:id', async (req, res) => {
    try {
        const routeId = parseInt(req.params.id);
        await db('rutas').where('id', routeId).del();

        res.redirect('/routes');
    } catch (error) {
        console.error('Error al eliminar la ruta:', error);
        const maps = await db('mapas').select('*');
        const allRoutes = await db('rutas')
            .select('rutas.*', 'mapas.nombre as mapa_nombre')
            .join('mapas', 'rutas.mapa_id', 'mapas.id');

        res.render('index', {
            screenshot: null,
            error: 'Error al eliminar la ruta.',
            maps,
            routes: allRoutes,
            view: 'routes'
        });
    }
});

// Ruta para manejar la captura de pantalla
app.post('/capture', async (req, res) => {
    const { name, url } = req.body; // Obtener también el nombre

    if (!name || name.trim() === '') {
        try {
            const maps = await db('mapas').select('*');
            return res.render('index', {
                screenshot: null,
                error: 'Por favor, introduce un nombre para el mapa.',
                maps,
                view: 'home'
            });
        } catch (dbError) {
            console.error('Error al obtener los mapas para el error de nombre:', dbError);
            return res.render('index', {
                screenshot: null,
                error: 'Por favor, introduce un nombre para el mapa. (Error al cargar mapas)',
                maps: [],
                view: 'home'
            });
        }
    }

    if (!url || !url.startsWith('https://www.google.com/maps')) {
        try {
            const maps = await db('mapas').select('*');
            return res.render('index', {
                screenshot: null,
                error: 'Por favor, introduce una URL válida de Google Maps.',
                maps,
                view: 'home'
            });
        } catch (dbError) {
            console.error('Error al obtener los mapas para el error de URL:', dbError);
            return res.render('index', {
                screenshot: null,
                error: 'Por favor, introduce una URL válida de Google Maps. (Error al cargar mapas)',
                maps: [],
                view: 'home'
            });
        }
    }

    try {
        const browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const page = await browser.newPage();

        await page.setViewport({ width: 1280, height: 800 });

        console.log(`Navegando a: ${url}`);
        await page.goto(url, { waitUntil: 'networkidle2' });

        await new Promise(resolve => setTimeout(resolve, 2000));

        const screenshotsDir = path.join(__dirname, 'public', 'screenshots');
        if (!fs.existsSync(screenshotsDir)) {
            fs.mkdirSync(screenshotsDir, { recursive: true });
        }

        const screenshotFileName = `capture-${Date.now()}.png`;
        const screenshotPath = path.join('screenshots', screenshotFileName);
        const fullScreenshotPath = path.join(__dirname, 'public', screenshotPath);

        console.log(`Guardando captura en: ${fullScreenshotPath}`);
        await page.screenshot({ path: fullScreenshotPath });

        await browser.close();

        // Obtener dimensiones de la imagen capturada
        const imagePath = path.join(__dirname, 'public', screenshotPath);
        const imageDimensions = await probe(fs.readFileSync(imagePath));

        // Verificar si ya existe un mapa con este nombre y URL
        const existingMap = await db('mapas').where({ nombre: name, url: url }).first();

        if (existingMap) {
            // Actualizar el mapa existente
            await db('mapas')
                .where({ nombre: name, url: url })
                .update({
                    ruta_captura: screenshotPath,
                    original_width: imageDimensions.width,
                    original_height: imageDimensions.height
                });
            console.log('Mapa actualizado en la base de datos con dimensiones:', imageDimensions.width, 'x', imageDimensions.height);
        } else {
            // Insertar nuevo mapa
            await db('mapas').insert({
                nombre: name,
                url: url,
                ruta_captura: screenshotPath,
                original_width: imageDimensions.width,
                original_height: imageDimensions.height
            });
            console.log('Mapa guardado en la base de datos con dimensiones:', imageDimensions.width, 'x', imageDimensions.height);
        }

        res.redirect('/'); // Redirigir a la página principal después de guardar

    } catch (error) {
        console.error('Error al capturar la pantalla o guardar en DB:', error);
        try {
            const maps = await db('mapas').select('*');
            res.render('index', {
                screenshot: null,
                error: 'Ocurrió un error al procesar la URL o guardar el mapa. Inténtalo de nuevo.',
                maps,
                view: 'home'
            });
        } catch (dbError) {
            console.error('Error al obtener los mapas después de un error de captura:', dbError);
            res.render('index', {
                screenshot: null,
                error: 'Ocurrió un error al procesar la URL o guardar el mapa. (Error al cargar mapas)',
                maps: [],
                view: 'home'
            });
        }
    }
});

// Inicializar la base de datos y luego iniciar el servidor
initializeDatabase().then(() => {
    app.listen(port, () => {
        console.log(`Servidor escuchando en http://localhost:${port}`);
    });
}).catch((err) => {
    console.error('Fallo al iniciar la aplicación debido a un error de DB:', err);
});

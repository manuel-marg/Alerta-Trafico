const express = require('express');
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const probe = require('probe-image-size');
const { db, initializeDatabase } = require('./database'); // Importar db y initializeDatabase

const app = express();
const port = 3000;

// Función auxiliar para manejar errores y renderizar la vista
async function handleErrorAndRender(res, error, message, view, data = {}) {
    console.error(message, error);
    try {
        // Intentar obtener los mapas de nuevo si no se proporcionaron, ya que muchas vistas los necesitan
        if (!data.maps) {
            data.maps = await db('mapas').select('*');
        }
    } catch (dbError) {
        console.error('Error adicional al obtener mapas en el manejador de errores:', dbError);
        data.maps = []; // Asegurar que maps sea un array vacío si falla
    }
    res.render('index', {
        screenshot: null,
        error: message,
        view: view,
        ...data // Incluir cualquier otro dato necesario para la vista
    });
}

// Funciones de utilidad para validación
function validateMapData(name, url) {
    if (!name || name.trim() === '') {
        return 'Por favor, introduce un nombre para el mapa.';
    }
    if (!url || !url.startsWith('https://www.google.com/maps')) {
        return 'Por favor, introduce una URL válida de Google Maps.';
    }
    return null; // No hay errores
}

function validateRouteData(nombre, sentido) {
    if (!nombre || nombre.trim() === '') {
        return 'Por favor, introduce un nombre para la ruta.';
    }
    if (!sentido || sentido.trim() === '') {
        return 'Por favor, introduce el sentido de la ruta.';
    }
    return null; // No hay errores
}

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
        await handleErrorAndRender(res, error, 'Error al cargar los mapas.', 'home');
    }
});

// Ruta para mostrar la página de gestión de mapas
app.get('/maps', async (req, res) => {
    try {
        const maps = await db('mapas').select('*');
        res.render('index', { screenshot: null, error: null, maps, view: 'maps' });
    } catch (error) {
        await handleErrorAndRender(res, error, 'Error al cargar los mapas.', 'maps');
    }
});

// Ruta para crear un nuevo mapa
app.post('/maps', async (req, res) => {
    const { name, url } = req.body;

    const validationError = validateMapData(name, url);
    if (validationError) {
        return await handleErrorAndRender(res, null, validationError, 'maps');
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
        await handleErrorAndRender(res, error, 'Ocurrió un error al guardar el mapa. Inténtalo de nuevo.', 'maps');
    }
});

// Ruta para editar un mapa
app.get('/maps/:id/edit', async (req, res) => {
    try {
        const mapId = parseInt(req.params.id);
        const map = await db('mapas').where('id', mapId).first();

        if (!map) {
            return await handleErrorAndRender(res, null, 'Mapa no encontrado.', 'maps', { status: 404 });
        }

        res.render('index', { screenshot: null, error: null, map, maps, view: 'edit-map' });
    } catch (error) {
        await handleErrorAndRender(res, error, 'Error al cargar el mapa para edición.', 'maps');
    }
});

// Ruta para actualizar un mapa
app.put('/maps/:id', async (req, res) => {
    const mapId = parseInt(req.params.id);
    const { name, url } = req.body;

    let existingMap;
    try {
        existingMap = await db('mapas').where('id', mapId).first();
        if (!existingMap) {
            return await handleErrorAndRender(res, null, 'Mapa no encontrado para actualizar.', 'maps', { status: 404 });
        }
    } catch (error) {
        return await handleErrorAndRender(res, error, 'Error al obtener el mapa para actualización.', 'maps');
    }

    const validationError = validateMapData(name, url);
    if (validationError) {
        return await handleErrorAndRender(res, null, validationError, 'edit-map', { map: existingMap });
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
        await handleErrorAndRender(res, error, 'Ocurrió un error al actualizar el mapa. Inténtalo de nuevo.', 'edit-map', { map: existingMap });
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
        await handleErrorAndRender(res, error, 'Error al eliminar el mapa.', 'maps');
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
        await handleErrorAndRender(res, error, 'Error al cargar las rutas.', 'routes', { routes: [] });
    }
});

// Ruta para mostrar el formulario de selección de mapa para crear ruta
app.get('/routes/create', async (req, res) => {
    try {
        const mapId = parseInt(req.query.mapId);
        const selectedMap = await db('mapas').where('id', mapId).first();

        if (!selectedMap) {
            return await handleErrorAndRender(res, null, 'Mapa no encontrado.', 'routes', { status: 404 });
        }

        res.render('index', { screenshot: null, error: null, selectedMap, view: 'create-route' });
    } catch (error) {
        await handleErrorAndRender(res, error, 'Error al cargar el mapa para crear ruta.', 'routes');
    }
});

// Ruta para crear una nueva ruta
app.post('/routes', async (req, res) => {
    const { nombre, sentido, mapa_id } = req.body;

    let selectedMap;
    try {
        selectedMap = await db('mapas').where('id', parseInt(mapa_id)).first();
        if (!selectedMap) {
            return await handleErrorAndRender(res, null, 'Mapa seleccionado no encontrado.', 'routes', { status: 404 });
        }
    } catch (error) {
        return await handleErrorAndRender(res, error, 'Error al obtener el mapa seleccionado.', 'routes');
    }

    const validationError = validateRouteData(nombre, sentido);
    if (validationError) {
        return await handleErrorAndRender(res, null, validationError, 'create-route', { selectedMap });
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
        await handleErrorAndRender(res, error, 'Ocurrió un error al crear la ruta. Inténtalo de nuevo.', 'create-route', { selectedMap });
    }
});

// Ruta para mostrar la página de definición de zonas para una ruta específica
app.get('/routes/:id/zones', async (req, res) => {
    try {
        const routeId = parseInt(req.params.id);
        const currentRoute = await db('rutas').where('id', routeId).first();

        if (!currentRoute) {
            return await handleErrorAndRender(res, null, 'Ruta no encontrada.', 'routes', { status: 404 });
        }

        const mapWithRoute = await db('mapas').where('id', currentRoute.mapa_id).first();
        const zones = await db('zonas').where('ruta_id', routeId).orderBy('orden');
        // maps es gestionado por handleErrorAndRender si no existe en data

        res.render('index', {
            screenshot: null,
            error: null,
            currentRoute,
            mapWithRoute,
            zones,
            view: 'define-zones'
        });
    } catch (error) {
        await handleErrorAndRender(res, error, 'Error al cargar la ruta y sus zonas.', 'routes');
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
            return await handleErrorAndRender(res, null, 'Ruta no encontrada.', 'routes', { status: 404 });
        }

        const maps = await db('mapas').select('*'); // maps is needed for the dropdown in the edit form

        res.render('index', {
            screenshot: null,
            error: null,
            route,
            maps,
            view: 'edit-route'
        });
    } catch (error) {
        await handleErrorAndRender(res, error, 'Error al cargar la ruta para edición.', 'routes');
    }
});

// Ruta para actualizar una ruta
app.put('/routes/:id', async (req, res) => {
    const routeId = parseInt(req.params.id);
    const { nombre, sentido, mapa_id } = req.body;

    let route;
    try {
        route = await db('rutas').where('id', routeId).first();
        if (!route) {
            return await handleErrorAndRender(res, null, 'Ruta no encontrada para actualizar.', 'routes', { status: 404 });
        }
    } catch (error) {
        return await handleErrorAndRender(res, error, 'Error al obtener la ruta para actualización.', 'routes');
    }

    const validationError = validateRouteData(nombre, sentido);
    if (validationError) {
        return await handleErrorAndRender(res, null, validationError, 'edit-route', { route });
    }

    // Opcional: Verificar que el mapa_id sea válido si es crítico para la integridad
    let selectedMap;
    try {
        selectedMap = await db('mapas').where('id', parseInt(mapa_id)).first();
        if (!selectedMap) {
            return await handleErrorAndRender(res, null, 'El mapa seleccionado no es válido.', 'edit-route', { route });
        }
    } catch (error) {
        return await handleErrorAndRender(res, error, 'Error al verificar el mapa asociado.', 'edit-route', { route });
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
        await handleErrorAndRender(res, error, 'Ocurrió un error al actualizar la ruta. Inténtalo de nuevo.', 'edit-route', { route });
    }
});

// Ruta para eliminar una ruta
app.delete('/routes/:id', async (req, res) => {
    try {
        const routeId = parseInt(req.params.id);
        await db('rutas').where('id', routeId).del();

        res.redirect('/routes');
    } catch (error) {
        await handleErrorAndRender(res, error, 'Error al eliminar la ruta.', 'routes');
    }
});

// Ruta para manejar la captura de pantalla
app.post('/capture', async (req, res) => {
    const { name, url } = req.body; // Obtener también el nombre

    const validationError = validateMapData(name, url);
    if (validationError) {
        return await handleErrorAndRender(res, null, validationError, 'home');
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
        await handleErrorAndRender(res, error, 'Ocurrió un error al procesar la URL o guardar el mapa. Inténtalo de nuevo.', 'home');
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

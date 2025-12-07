const puppeteer = require('puppeteer');
const { db } = require('./database');
const path = require('path');
const fs = require('fs');

const sharp = require('sharp');

// Almacén para los workers de cada mapa
const workers = new Map();

/**
 * Define si un color de píxel representa tráfico.
 * @param {object} color - Objeto con { r, g, b }.
 * @returns {boolean} - True si es color de tráfico, false si no.
 */
function esColorDeTrafico(color) {
    // Umbral simple: rojo dominante, poco verde y azul.
    // Esto detecta rojos y vinotintos oscuros.
    return color.r > 150 && color.g < 100 && color.b < 100;
}

/**
 * Analiza los píxeles de una imagen según las zonas definidas.
 * @param {string} screenshotPath - Ruta a la imagen.
 * @param {Array<object>} zonas - Array de objetos de zona con x, y.
 * @returns {Promise<Array<object>>} - Una promesa que resuelve a un array de zonas con tráfico.
 */
async function analizarImagen(screenshotPath, zonas) {
    const zonasConTrafico = [];
    try {
        const image = sharp(screenshotPath);
        for (const zona of zonas) {
            const pixel = await image.extract({ left: zona.x, top: zona.y, width: 1, height: 1 }).raw().toBuffer();
            const color = { r: pixel[0], g: pixel[1], b: pixel[2] };

            if (esColorDeTrafico(color)) {
                zonasConTrafico.push(zona);
                console.log(`[Análisis] Tráfico detectado en la zona "${zona.nombre}" (R:${color.r}, G:${color.g}, B:${color.b})`);
            }
        }
    } catch (error) {
        console.error('Error al analizar la imagen:', error);
    }
    return zonasConTrafico;
}

/**
 * Detecta secuencias de zonas consecutivas con tráfico (colas).
 * @param {Array<object>} zonasConTrafico - Array de zonas con tráfico.
 * @param {object} ruta - La ruta a la que pertenecen las zonas.
 */
async function detectarColas(zonasConTrafico, ruta) {
    if (zonasConTrafico.length < 3) {
        return; // No puede haber una cola de 3 o más si hay menos de 3 zonas con tráfico.
    }

    // Ordenar por el campo 'orden' para asegurar la secuencia
    zonasConTrafico.sort((a, b) => a.orden - b.orden);

    let colaActual = [zonasConTrafico[0]];

    for (let i = 1; i < zonasConTrafico.length; i++) {
        // Verificar si la zona actual es consecutiva a la anterior
        if (zonasConTrafico[i].orden === colaActual[colaActual.length - 1].orden + 1) {
            colaActual.push(zonasConTrafico[i]);
        } else {
            // La secuencia se rompió, verificar si la cola anterior era suficientemente larga
            if (colaActual.length >= 3) {
                await registrarAlerta(colaActual, ruta);
            }
            // Iniciar una nueva secuencia de cola
            colaActual = [zonasConTrafico[i]];
        }
    }

    // Verificar la última cola después de salir del bucle
    if (colaActual.length >= 3) {
        await registrarAlerta(colaActual, ruta);
    }
}

/**
 * Guarda una alerta de tráfico en la base de datos.
 * @param {Array<object>} cola - Array de zonas que forman la cola.
 * @param {object} ruta - La ruta a la que pertenece la cola.
 */
async function registrarAlerta(cola, ruta) {
    const zonaInicio = cola[0];
    const zonaFin = cola[cola.length - 1];
    const mensaje = `Cola detectada en la ruta "${ruta.nombre}" desde ${zonaInicio.nombre} hasta ${zonaFin.nombre} (Sentido: ${ruta.sentido}).`;

    try {
        await db('alertas_trafico').insert({
            ruta_id: ruta.id,
            mensaje: mensaje,
            zona_inicio_nombre: zonaInicio.nombre,
            zona_fin_nombre: zonaFin.nombre
        });
        console.log(`[ALERTA] ${mensaje}`);
    } catch (error) {
        console.error('Error al registrar la alerta en la base de datos:', error);
    }
}

/**
 * Inicia un worker de monitoreo para un mapa específico.
 * @param {object} mapa - El objeto del mapa de la base de datos.
 */
async function startMapWorker(mapa) {
    if (!mapa || !mapa.id || !mapa.url) {
        console.error('Intento de iniciar worker con datos de mapa inválidos:', mapa);
        return;
    }

    console.log(`Iniciando worker para el mapa: "${mapa.nombre}" (ID: ${mapa.id})`);

    try {
        const browser = await puppeteer.launch({
            headless: true, // Cambiar a false para depuración visual
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 800 });

        console.log(`Navegando a la URL del mapa "${mapa.nombre}": ${mapa.url}`);
        await page.goto(mapa.url, { waitUntil: 'networkidle2' });

        const worker = {
            mapa_id: mapa.id,
            mapa_nombre: mapa.nombre,
            browser: browser,
            page: page,
            intervalId: null
        };

        // Iniciar el ciclo de captura cada 1 minuto
        worker.intervalId = setInterval(() => {
            captureAndAnalyze(worker);
        }, 60000); // 60,000 ms = 1 minuto

        workers.set(mapa.id, worker);
        console.log(`Worker para el mapa "${mapa.nombre}" iniciado y programado.`);

    } catch (error) {
        console.error(`Error al iniciar el worker para el mapa "${mapa.nombre}":`, error);
    }
}

/**
 * Realiza la captura de pantalla y dispara el análisis.
 * @param {object} worker - El objeto del worker.
 */
async function captureAndAnalyze(worker) {
    console.log(`[Worker ${worker.mapa_nombre}] Realizando captura de pantalla...`);

    try {
        const screenshotsDir = path.join(__dirname, 'public', 'screenshots', 'live');
        if (!fs.existsSync(screenshotsDir)) {
            fs.mkdirSync(screenshotsDir, { recursive: true });
        }

        // Usamos un nombre de archivo predecible para que la vista en vivo pueda encontrarlo
        const screenshotFileName = `map_${worker.mapa_id}_latest.png`;
        const screenshotPath = path.join(screenshotsDir, screenshotFileName);

        await worker.page.screenshot({ path: screenshotPath });

        console.log(`[Worker ${worker.mapa_nombre}] Captura guardada en: ${screenshotPath}`);

        // 1. Obtener todas las rutas asociadas a este mapa
        const rutas = await db('rutas').where('mapa_id', worker.mapa_id);
        if (rutas.length === 0) {
            console.log(`[Worker ${worker.mapa_nombre}] No hay rutas definidas para este mapa. Saltando análisis.`);
            return;
        }

        for (const ruta of rutas) {
            // 2. Para cada ruta, obtener sus zonas (píxeles)
            const zonas = await db('zonas').where('ruta_id', ruta.id).orderBy('orden');
            if (zonas.length === 0) {
                console.log(`[Worker ${worker.mapa_nombre}] La ruta "${ruta.nombre}" no tiene zonas definidas. Saltando.`);
                continue;
            }

            console.log(`[Worker ${worker.mapa_nombre}] Analizando ${zonas.length} zonas para la ruta "${ruta.nombre}"...`);

            // 3. Llamar a la función de análisis de imagen
            const zonasConTrafico = await analizarImagen(screenshotPath, zonas);

            // 4. Con el resultado, llamar a la lógica de detección de colas
            await detectarColas(zonasConTrafico, ruta);
        }

    } catch (error) {
        console.error(`[Worker ${worker.mapa_nombre}] Error durante la captura y análisis:`, error);
    }
}

/**
 * Función principal para iniciar todo el sistema de monitoreo.
 */
async function startTrafficMonitor() {
    console.log('Iniciando el monitor de tráfico...');
    try {
        const mapas = await db('mapas').select('*');
        if (mapas.length === 0) {
            console.warn('No hay mapas en la base de datos. El monitor no se iniciará.');
            return;
        }

        for (const mapa of mapas) {
            await startMapWorker(mapa);
        }
    } catch (error) {
        console.error('Error fatal al iniciar el monitor de tráfico:', error);
        process.exit(1);
    }
}

module.exports = { startTrafficMonitor };

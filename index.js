const express = require('express');
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const app = express();
const port = 3000;

// Configurar EJS como motor de plantillas
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware para parsear datos de formularios y servir archivos estáticos
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Ruta principal para mostrar el formulario
app.get('/', (req, res) => {
    res.render('index', { screenshot: null, error: null });
});

// Ruta para manejar la captura de pantalla
app.post('/capture', async (req, res) => {
    const { url } = req.body;

    if (!url || !url.startsWith('https://www.google.com/maps')) {
        return res.render('index', { 
            screenshot: null, 
            error: 'Por favor, introduce una URL válida de Google Maps.' 
        });
    }

    try {
        const browser = await puppeteer.launch({
            headless: true, // Ejecutar en modo headless
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const page = await browser.newPage();
        
        // Ajustar el tamaño de la ventana para una captura más completa
        await page.setViewport({ width: 1280, height: 800 });

        console.log(`Navegando a: ${url}`);
        await page.goto(url, { waitUntil: 'networkidle2' });

        // Esperar un poco más por si hay elementos que tardan en cargar en el mapa
        await new Promise(resolve => setTimeout(resolve, 2000));

        const screenshotsDir = path.join(__dirname, 'public', 'screenshots');
        if (!fs.existsSync(screenshotsDir)) {
            fs.mkdirSync(screenshotsDir, { recursive: true });
        }

        const screenshotPath = path.join('screenshots', `capture-${Date.now()}.png`);
        const fullScreenshotPath = path.join(__dirname, 'public', screenshotPath);
        
        console.log(`Guardando captura en: ${fullScreenshotPath}`);
        await page.screenshot({ path: fullScreenshotPath });

        await browser.close();

        res.render('index', { screenshot: screenshotPath, error: null });

    } catch (error) {
        console.error('Error al capturar la pantalla:', error);
        res.render('index', { 
            screenshot: null, 
            error: 'Ocurrió un error al procesar la URL. Inténtalo de nuevo.' 
        });
    }
});

app.listen(port, () => {
    console.log(`Servidor escuchando en http://localhost:${port}`);
});

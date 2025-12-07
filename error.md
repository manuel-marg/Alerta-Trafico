LENOVO@DESKTOP-RUH493R MINGW64 /c/Node.js/Alerta-Trafico (main)
$ node index.js
La tabla "mapas" ya existe.
La tabla "rutas" ya existe.
La tabla "zonas" ya existe.
Servidor escuchando en http://localhost:3000
ReferenceError: C:\Node.js\Alerta-Trafico\views\index.ejs:467
    465|
    466|             // Obtener dimensiones reales de la imagen
 >> 467|             const originalWidth = <%= mapWithRoute.original_width || 0 %>;
    468|             const originalHeight = <%= mapWithRoute.original_height || 0 %>;
    469|
    470|             // Si no tenemos dimensiones reales, usar las dimensiones naturales de la imagen

mapWithRoute is not defined
    at eval ("C:\\Node.js\\Alerta-Trafico\\views\\index.ejs":268:26)
    at index (C:\Node.js\Alerta-Trafico\node_modules\ejs\lib\ejs.js:703:17)
    at tryHandleCache (C:\Node.js\Alerta-Trafico\node_modules\ejs\lib\ejs.js:274:36)
    at exports.renderFile [as engine] (C:\Node.js\Alerta-Trafico\node_modules\ejs\lib\ejs.js:491:10)
    at View.render (C:\Node.js\Alerta-Trafico\node_modules\express\lib\view.js:139:8)
    at tryRender (C:\Node.js\Alerta-Trafico\node_modules\express\lib\application.js:627:10)
    at Function.render (C:\Node.js\Alerta-Trafico\node_modules\express\lib\application.js:574:3)
    at ServerResponse.render (C:\Node.js\Alerta-Trafico\node_modules\express\lib\response.js:909:7)
    at C:\Node.js\Alerta-Trafico\index.js:43:13
ReferenceError: C:\Node.js\Alerta-Trafico\views\index.ejs:467
    465|
    466|             // Obtener dimensiones reales de la imagen
 >> 467|             const originalWidth = <%= mapWithRoute.original_width || 0 %>;
    468|             const originalHeight = <%= mapWithRoute.original_height || 0 %>;
    469|
    470|             // Si no tenemos dimensiones reales, usar las dimensiones naturales de la imagen

mapWithRoute is not defined
    at eval ("C:\\Node.js\\Alerta-Trafico\\views\\index.ejs":268:26)
    at index (C:\Node.js\Alerta-Trafico\node_modules\ejs\lib\ejs.js:703:17)
    at tryHandleCache (C:\Node.js\Alerta-Trafico\node_modules\ejs\lib\ejs.js:274:36)
    at exports.renderFile [as engine] (C:\Node.js\Alerta-Trafico\node_modules\ejs\lib\ejs.js:491:10)
    at View.render (C:\Node.js\Alerta-Trafico\node_modules\express\lib\view.js:139:8)
    at tryRender (C:\Node.js\Alerta-Trafico\node_modules\express\lib\application.js:627:10)
    at Function.render (C:\Node.js\Alerta-Trafico\node_modules\express\lib\application.js:574:3)
    at ServerResponse.render (C:\Node.js\Alerta-Trafico\node_modules\express\lib\response.js:909:7)
    at C:\Node.js\Alerta-Trafico\index.js:32:13
ReferenceError: C:\Node.js\Alerta-Trafico\views\index.ejs:467
    465|
    466|             // Obtener dimensiones reales de la imagen
 >> 467|             const originalWidth = <%= mapWithRoute.original_width || 0 %>;
    468|             const originalHeight = <%= mapWithRoute.original_height || 0 %>;
    469|
    470|             // Si no tenemos dimensiones reales, usar las dimensiones naturales de la imagen

mapWithRoute is not defined
    at eval ("C:\\Node.js\\Alerta-Trafico\\views\\index.ejs":268:26)
    at index (C:\Node.js\Alerta-Trafico\node_modules\ejs\lib\ejs.js:703:17)
    at tryHandleCache (C:\Node.js\Alerta-Trafico\node_modules\ejs\lib\ejs.js:274:36)
    at exports.renderFile [as engine] (C:\Node.js\Alerta-Trafico\node_modules\ejs\lib\ejs.js:491:10)
    at View.render (C:\Node.js\Alerta-Trafico\node_modules\express\lib\view.js:139:8)
    at tryRender (C:\Node.js\Alerta-Trafico\node_modules\express\lib\application.js:627:10)
    at Function.render (C:\Node.js\Alerta-Trafico\node_modules\express\lib\application.js:574:3)
    at ServerResponse.render (C:\Node.js\Alerta-Trafico\node_modules\express\lib\response.js:909:7)
    at C:\Node.js\Alerta-Trafico\index.js:32:13

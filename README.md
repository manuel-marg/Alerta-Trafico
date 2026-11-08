# 🚗 Alerta de Tráfico Matutino (PWA)

Una aplicación web progresiva (PWA) diseñada para avisarte de forma dinámica y automática en la mañana el momento exacto en que debes salir de casa para llegar a tiempo al trabajo, adaptándose al tráfico en tiempo real.

---

## 🌟 Características Principales

- **Cálculo dinámico de salida:**
  $$\text{Hora de salida} = \text{Hora meta de llegada} - (\text{Tiempo de tráfico en vivo} + \text{Margen extra})$$
- **Notificaciones Web Push nativas:** Recibe alertas en tu navegador / teléfono móvil incluso con la pestaña cerrada.
- **PWA instalable:** Puedes instalarla como aplicación nativa en Windows, Mac, Android o iOS (Añadir a pantalla de inicio).
- **Integración con Google Maps:** Usa la Distance Matrix API de Google Maps para calcular el tráfico en vivo.
- **Modo Simulación Inteligente:** Funciona de inmediato sin necesidad de ingresar tarjeta de crédito o API Key al inicio.
- **Monitoreo matutino automático:** Revisa periódicamente las condiciones viales dentro de tu ventana de tiempo.

---

## 🚀 Inicio Rápido

### 1. Iniciar el servidor
```bash
npm install
npm start
```

### 2. Abrir en el navegador
Visita en tu navegador:
```
http://localhost:3000
```

1. Haz clic en **"Activar Notificaciones"** y concede el permiso en el navegador.
2. Presiona **"Probar Notificación Ahora"** para verificar que recibes la alerta de inmediato con sonido.
3. Configura tu dirección de casa, tu trabajo y tu hora de llegada habitual.
4. Cuando tengas tu clave de Google Maps, pégala en el campo correspondiente.

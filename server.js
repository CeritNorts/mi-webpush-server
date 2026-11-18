require('dotenv').config();
const express = require('express');
const webpush = require('web-push');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

webpush.setVapidDetails(
    process.env.VAPID_MAILTO,
    process.env.PUBLIC_VAPID_KEY,
    process.env.PRIVATE_VAPID_KEY
);

const DB_FILE = path.join(__dirname, 'subscriptions.json');

function getSubscriptions() {
    if (!fs.existsSync(DB_FILE)) return [];
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

function saveSubscriptions(subs) {
    fs.writeFileSync(DB_FILE, JSON.stringify(subs, null, 2));
}

// ==========================================
// PANEL VISUAL EN LA RAÍZ (/)
// ==========================================
app.get('/', (req, res) => {
    const subs = getSubscriptions();
    const rows = subs.map((s, i) => `
    <tr>
      <td>${i + 1}</td>
      <td><code>${s.endpoint.slice(0, 55)}...</code></td>
      <td>${s.endpoint.includes('fcm.googleapis.com') ? 'Chrome / Edge / Android' : s.endpoint.includes('mozilla') ? 'Firefox' : 'Otro navegador'}</td>
    </tr>
  `).join('');

    res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <title>Servidor WebPush - Monitor</title>
      <style>
        body { font-family: system-ui, sans-serif; background: #0f172a; color: #f8fafc; max-width: 900px; margin: 2rem auto; padding: 0 1rem; }
        .card { background: #1e293b; padding: 1.5rem; border-radius: 10px; margin-bottom: 1.5rem; border: 1px solid #334155; }
        h1 { margin-top: 0; color: #38bdf8; }
        table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
        th, td { text-align: left; padding: 0.75rem; border-bottom: 1px solid #334155; font-size: 0.9rem; }
        th { color: #94a3b8; }
        button { background: #0284c7; color: white; border: none; padding: 0.6rem 1.2rem; border-radius: 6px; cursor: pointer; font-weight: bold; }
        button:hover { background: #0369a1; }
        .badge { background: #22c55e; color: #052e16; padding: 0.25rem 0.6rem; border-radius: 999px; font-weight: bold; }
      </style>
    </head>
    <body>
      <div class="card">
        <h1>Servidor WebPush Activo</h1>
        <p><strong>Llave Pública VAPID:</strong><br><code style="word-break: break-all; color: #a5b4fc;">${process.env.PUBLIC_VAPID_KEY}</code></p>
        <p><strong>Dispositivos Suscritos:</strong> <span class="badge">${subs.length}</span></p>
        <button onclick="location.reload()">Actualizar lista</button>
      </div>

      <div class="card">
        <h2>Suscripciones Registradas</h2>
        <table>
          <thead>
            <tr><th>#</th><th>Endpoint</th><th>Navegador / Proveedor</th></tr>
          </thead>
          <tbody>
            ${rows || '<tr><td colspan="3" style="text-align:center; color:#94a3b8;">Aún no hay dispositivos suscritos.</td></tr>'}
          </tbody>
        </table>
      </div>
    </body>
    </html>
  `);
});

// Ruta base API
app.get('/api', (req, res) => {
    res.json({ status: 'ok', publicKey: process.env.PUBLIC_VAPID_KEY });
});

// 1. Suscribir navegador (POST /api/subscribe)
app.post('/api/subscribe', (req, res) => {
    const sub = req.body;
    if (!sub || !sub.endpoint) {
        return res.status(400).json({ error: 'Suscripción inválida' });
    }

    const subs = getSubscriptions();
    if (!subs.some(s => s.endpoint === sub.endpoint)) {
        subs.push(sub);
        saveSubscriptions(subs);
    }

    console.log(`Nueva suscripción. Total conectados: ${subs.length}`);
    res.status(201).json({ message: 'Suscrito', total: subs.length });
});

// 2. Desuscribir navegador (POST /api/unsubscribe)
app.post('/api/unsubscribe', (req, res) => {
    const { endpoint } = req.body;
    let subs = getSubscriptions();
    subs = subs.filter(s => s.endpoint !== endpoint);
    saveSubscriptions(subs);
    console.log(`Suscripción eliminada. Total conectados: ${subs.length}`);
    res.json({ message: 'Desuscrito', total: subs.length });
});

// 3. Enviar notificación a todos (soporta /api/push, /api/notify y /api/send)
async function handleNotify(req, res) {
    const { title, body, message, icon } = req.body;

    // Estructura obligatoria para que @angular/service-worker (SwPush) muestre la notificación
    const payload = JSON.stringify({
        notification: {
            title: title || 'Notificación PWA',
            body: body || message || 'Acción realizada en la aplicación',
            icon: icon || 'icons/icon-192x192.png',
            vibrate: [200, 100, 200],
            data: { dateOfArrival: Date.now() }
        }
    });

    const subs = getSubscriptions();
    const activeSubs = [];

    await Promise.all(
        subs.map(async (sub) => {
            try {
                await webpush.sendNotification(sub, payload);
                activeSubs.push(sub);
            } catch (err) {
                if (err.statusCode !== 410 && err.statusCode !== 404) {
                    activeSubs.push(sub);
                }
            }
        })
    );

    saveSubscriptions(activeSubs);
    console.log(`Notificación enviada a ${activeSubs.length} dispositivo(s)`);
    res.json({ ok: true, sent: activeSubs.length });
}

app.post('/api/push', handleNotify);
app.post('/api/notify', handleNotify);
app.post('/api/send', handleNotify);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor Push corriendo en http://localhost:${PORT}/api`);
});
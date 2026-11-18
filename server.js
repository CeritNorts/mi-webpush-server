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

// Ruta base para comprobar que el servidor vive
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

// 2. Enviar notificación a todos (soporta /api/notify y /api/send)
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

app.post('/api/notify', handleNotify);
app.post('/api/send', handleNotify);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor Push corriendo en http://localhost:${PORT}/api`);
});
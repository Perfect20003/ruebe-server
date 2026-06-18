const admin = require('firebase-admin');

// Service Account aus Umgebungsvariable laden
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
const messaging = admin.messaging();

// Timer-Konstanten (ms)
const GROW_INTERVAL  = 48 * 60 * 60 * 1000;
const WATER_INTERVAL = 12 * 60 * 60 * 1000;
const ROT_INTERVAL   = 4  * 24 * 60 * 60 * 1000;
const FERT_INTERVAL  = 4  * 60 * 60 * 1000;

// Speichert welche Notifications schon geschickt wurden
const sent = new Set();

function now() { return Date.now(); }

async function getFCMTokens() {
  const snap = await db.collection('fcmTokens').get();
  return snap.docs.map(d => d.data().token).filter(Boolean);
}

async function sendPush(tokens, title, body) {
  if (!tokens.length) return;
  try {
    await messaging.sendEachForMulticast({
      tokens,
      notification: { title, body },
      apns: {
        payload: { aps: { sound: 'default' } }
      }
    });
    console.log(`[Push] "${title}" → ${tokens.length} Gerät(e)`);
  } catch (e) {
    console.error('[Push] Fehler:', e.message);
  }
}

async function checkTimers() {
  const tokens = await getFCMTokens();
  if (!tokens.length) return;

  const beetSnap = await db.collection('beete').get();
  const t = now();

  beetSnap.forEach(d => {
    const b = { id: d.id, ...d.data() };
    const name = b.name || 'Unbekannt';

    // 1. Rübe reif
    const ripeLeft = Math.max(0, (b.plantedAt || t) + GROW_INTERVAL - t);
    if (ripeLeft === 0 && !sent.has(b.id + '_reif')) {
      sent.add(b.id + '_reif');
      sendPush(tokens, '🟫 Rübe reif!', `${name} ist jetzt reif!`);
    }
    if (ripeLeft > 60000) sent.delete(b.id + '_reif');

    // 2. Wasser 15 Min
    const waterLeft = Math.max(0, (b.waterUntil || 0) - t);
    if (waterLeft > 0 && waterLeft <= 15*60000 && waterLeft > 14*60000 && !sent.has(b.id + '_w15')) {
      sent.add(b.id + '_w15');
      sendPush(tokens, '💧 Wasser fast leer', `${name}: Wasser läuft in ~15 Min aus!`);
    }
    if (waterLeft > 15*60000) sent.delete(b.id + '_w15');

    // 3. Wasser abgelaufen
    if (waterLeft === 0 && (b.waterUntil || 0) > 0 && !sent.has(b.id + '_w0')) {
      sent.add(b.id + '_w0');
      sendPush(tokens, '🚱 Wasser leer!', `${name}: Kein Wasser – Verdorrung läuft!`);
    }
    if (waterLeft > 60000) sent.delete(b.id + '_w0');

    // 4. Verdorrung 1h, 30min, 10min
    if (waterLeft === 0) {
      const rotLeft = Math.max(0, (b.waterUntil || 0) + ROT_INTERVAL - t);
      [[60,'_r60'],[30,'_r30'],[10,'_r10']].forEach(([mins, key]) => {
        if (rotLeft <= mins*60000 && rotLeft > (mins-1)*60000 && !sent.has(b.id+key)) {
          sent.add(b.id + key);
          sendPush(tokens, '⚠️ Verdorrung!', `${name}: Verdirbt in ~${mins} Min!`);
        }
        if (rotLeft > mins*60000) sent.delete(b.id + key);
      });
    }

    // 5. Dünger 30min, 15min
    const fertLeft = Math.max(0, (b.fertAt || 0) + FERT_INTERVAL - t);
    [[30,'_f30'],[15,'_f15']].forEach(([mins, key]) => {
      if (fertLeft > 0 && fertLeft <= mins*60000 && fertLeft > (mins-1)*60000 && !sent.has(b.id+key)) {
        sent.add(b.id + key);
        sendPush(tokens, '🌿 Dünger läuft ab', `${name}: Dünger endet in ~${mins} Min!`);
      }
      if (fertLeft > mins*60000) sent.delete(b.id + key);
    });
  });
}

// Alle 30 Sekunden prüfen
console.log('[Rübe] Push-Server gestartet.');
checkTimers();
setInterval(checkTimers, 30000);

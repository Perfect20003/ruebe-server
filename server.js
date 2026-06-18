const admin = require('firebase-admin');

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
const messaging = admin.messaging();

const GROW_INTERVAL = 48 * 60 * 60 * 1000;
const ROT_INTERVAL  = 4  * 24 * 60 * 60 * 1000;
const FERT_INTERVAL = 4  * 60 * 60 * 1000;

const sent = new Set();

function now() { return Date.now(); }

async function getFCMTokens() {
  const snap = await db.collection('fcmTokens').get();
  const tokenMap = new Map();
  snap.docs.forEach(d => {
    const { token, updatedAt } = d.data();
    if (!token) return;
    if (!tokenMap.has(token) || updatedAt > (tokenMap.get(token)?.updatedAt || 0)) {
      tokenMap.set(token, { token, updatedAt });
    }
  });
  return [...tokenMap.keys()];
}

async function sendPush(tokens, title, body) {
  if (!tokens.length) return;
  try {
    await messaging.sendEachForMulticast({
      tokens,
      notification: { title, body },
      apns: { payload: { aps: { sound: 'default' } } }
    });
    console.log(`[Push] "${title}" → ${tokens.length} Gerät(e)`);
  } catch (e) {
    console.error('[Push] Fehler:', e.message);
  }
}

// Schickt nur wenn noch nicht in dieser "Minute" gesendet
function triggerKey(id, key, mins) {
  // Key enthält die aktuelle Minute damit er sich nach 2 Minuten selbst zurücksetzt
  const minuteKey = `${id}${key}_${Math.floor(now() / 60000)}`;
  if (sent.has(minuteKey)) return false;
  // Alle anderen minuten-Keys für diesen id+key löschen
  for (const k of sent) {
    if (k.startsWith(id + key + '_')) sent.delete(k);
  }
  sent.add(minuteKey);
  return true;
}

async function checkTimers() {
  const tokens = await getFCMTokens();
  if (!tokens.length) return;

  const beetSnap = await db.collection('beete').get();
  const t = now();

  beetSnap.forEach(d => {
    const b = { id: d.id, ...d.data() };
    const name = b.name || 'Unbekannt';

    // Rübe reif
    const ripeLeft = Math.max(0, (b.plantedAt || t) + GROW_INTERVAL - t);
    if (ripeLeft === 0 && triggerKey(b.id, '_reif', 0)) {
      sendPush(tokens, '🟫 Rübe reif!', `${name} ist jetzt reif!`);
    }
    if (ripeLeft > 60000) sent.forEach(k => k.startsWith(b.id + '_reif') && sent.delete(k));

    // Wasser 15 Min
    const waterLeft = Math.max(0, (b.waterUntil || 0) - t);
    if (waterLeft > 0 && waterLeft <= 15*60000 && waterLeft > 14*60000 && triggerKey(b.id, '_w15', 15)) {
      sendPush(tokens, '💧 Wasser fast leer', `${name}: Wasser läuft in ~15 Min aus!`);
    }

    // Wasser abgelaufen
    if (waterLeft === 0 && (b.waterUntil || 0) > 0 && triggerKey(b.id, '_w0', 0)) {
      sendPush(tokens, '🚱 Wasser leer!', `${name}: Kein Wasser – Verdorrung läuft!`);
    }

    // Verdorrung 1h, 30min, 10min
    if (waterLeft === 0) {
      const rotLeft = Math.max(0, (b.waterUntil || 0) + ROT_INTERVAL - t);
      [[60,'_r60'],[30,'_r30'],[10,'_r10']].forEach(([mins, key]) => {
        if (rotLeft <= mins*60000 && rotLeft > (mins-1)*60000 && triggerKey(b.id, key, mins)) {
          sendPush(tokens, '⚠️ Verdorrung!', `${name}: Verdirbt in ~${mins} Min!`);
        }
      });
    }

    // Dünger 30min, 15min
    const fertLeft = Math.max(0, (b.fertAt || 0) + FERT_INTERVAL - t);
    [[30,'_f30'],[15,'_f15']].forEach(([mins, key]) => {
      if (fertLeft > 0 && fertLeft <= mins*60000 && fertLeft > (mins-1)*60000 && triggerKey(b.id, key, mins)) {
        sendPush(tokens, '🌿 Dünger läuft ab', `${name}: Dünger endet in ~${mins} Min!`);
      }
    });
  });
}

console.log('[Rübe] Push-Server gestartet.');
checkTimers();
setInterval(checkTimers, 10000);

const admin = require('firebase-admin');

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
const messaging = admin.messaging();

const GROW_INTERVAL  = 48 * 60 * 60 * 1000;
const WATER_INTERVAL = 12 * 60 * 60 * 1000;
const ROT_INTERVAL   = 4  * 24 * 60 * 60 * 1000;
const FERT_INTERVAL  = 4  * 60 * 60 * 1000;

const sent = new Set();

function now() { return Date.now(); }

async function getFCMTokens() {
  const snap = await db.collection('fcmTokens').get();
  // Nur einzigartige Tokens - neuesten pro Token behalten
  const tokenMap = new Map();
  snap.docs.forEach(d => {
    const { token, updatedAt } = d.data();
    if (!token) return;
    if (!tokenMap.has(token) || (updatedAt > (tokenMap.get(token)?.updatedAt || 0))) {
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

function check(id, key, condition, resetCondition, onSend) {
  if (resetCondition) { sent.delete(id + key); return; }
  if (condition && !sent.has(id + key)) {
    sent.add(id + key);
    onSend();
  }
  if (!condition && !resetCondition) sent.delete(id + key);
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
    check(b.id, '_reif',
      ripeLeft === 0,
      ripeLeft > 60000,
      () => sendPush(tokens, '🟫 Rübe reif!', `${name} ist jetzt reif!`)
    );

    // Wasser 15 Min
    const waterLeft = Math.max(0, (b.waterUntil || 0) - t);
    check(b.id, '_w15',
      waterLeft > 0 && waterLeft <= 15*60000 && waterLeft > 14*60000,
      waterLeft > 15*60000,
      () => sendPush(tokens, '💧 Wasser fast leer', `${name}: Wasser läuft in ~15 Min aus!`)
    );

    // Wasser abgelaufen
    check(b.id, '_w0',
      waterLeft === 0 && (b.waterUntil || 0) > 0,
      waterLeft > 60000,
      () => sendPush(tokens, '🚱 Wasser leer!', `${name}: Kein Wasser – Verdorrung läuft!`)
    );

    // Verdorrung 1h, 30min, 10min
    if (waterLeft === 0) {
      const rotLeft = Math.max(0, (b.waterUntil || 0) + ROT_INTERVAL - t);
      [[60,'_r60'],[30,'_r30'],[10,'_r10']].forEach(([mins, key]) => {
        check(b.id, key,
          rotLeft <= mins*60000 && rotLeft > (mins-1)*60000,
          rotLeft > mins*60000,
          () => sendPush(tokens, '⚠️ Verdorrung!', `${name}: Verdirbt in ~${mins} Min!`)
        );
      });
    } else {
      // Wasser wieder da – Verdorrungs-Flags zurücksetzen
      ['_r60','_r30','_r10'].forEach(k => sent.delete(b.id + k));
    }

    // Dünger 30min, 15min
    const fertLeft = Math.max(0, (b.fertAt || 0) + FERT_INTERVAL - t);
    [[30,'_f30'],[15,'_f15']].forEach(([mins, key]) => {
      check(b.id, key,
        fertLeft > 0 && fertLeft <= mins*60000 && fertLeft > (mins-1)*60000,
        fertLeft > mins*60000,
        () => sendPush(tokens, '🌿 Dünger läuft ab', `${name}: Dünger endet in ~${mins} Min!`)
      );
    });
  });
}

console.log('[Rübe] Push-Server gestartet.');
checkTimers();
setInterval(checkTimers, 10000);

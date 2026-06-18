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

const pushCacheRef = db.doc('settings/pushCache');
let cache = {};
let isFirstRun = true; // Beim ersten Durchlauf nur Cache aufbauen, nicht senden

async function loadCache() {
  try {
    const snap = await pushCacheRef.get();
    if (snap.exists) cache = snap.data() || {};
    console.log('[Push] Cache geladen:', Object.keys(cache).length, 'Einträge');
  } catch(e) {
    console.warn('[Push] Cache laden fehlgeschlagen:', e.message);
  }
}

async function saveCache() {
  try { await pushCacheRef.set(cache); } catch(e) {}
}

function tryTrigger(key) {
  if (cache[key]) return false;
  cache[key] = Date.now();
  saveCache();
  return true;
}

function clearTrigger(key) {
  if (cache[key]) {
    delete cache[key];
    saveCache();
  }
}

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
  if (!tokens.length || isFirstRun) return;
  try {
    await messaging.sendEachForMulticast({
      tokens,
      notification: { title, body },
      apns: { payload: { aps: { sound: 'default' } } }
    });
    console.log(`[Push] "${title}" → ${tokens.length} Gerät(e)`);
  } catch(e) {
    console.error('[Push] Fehler:', e.message);
  }
}

async function checkTimers() {
  const tokens = await getFCMTokens();
  const beetSnap = await db.collection('beete').get();
  const t = now();

  beetSnap.forEach(d => {
    const b = { id: d.id, ...d.data() };
    const name = b.name || 'Unbekannt';

    // Rübe reif
    const ripeLeft = Math.max(0, (b.plantedAt || t) + GROW_INTERVAL - t);
    if (ripeLeft === 0) {
      if (tryTrigger(b.id + '_reif')) sendPush(tokens, '🟫 Rübe reif!', `${name} ist jetzt reif!`);
    } else if (ripeLeft > 5 * 60000) clearTrigger(b.id + '_reif');

    // Wasser 15 Min
    const waterLeft = Math.max(0, (b.waterUntil || 0) - t);
    if (waterLeft > 0 && waterLeft <= 15 * 60000) {
      if (tryTrigger(b.id + '_w15')) sendPush(tokens, '💧 Wasser fast leer', `${name}: Wasser läuft in ~15 Min aus!`);
    } else if (waterLeft > 20 * 60000) clearTrigger(b.id + '_w15');

    // Wasser abgelaufen – nur wenn waterUntil in den letzten 10 Min abgelaufen ist
    const waterUntil = b.waterUntil || 0;
    if (waterLeft === 0 && waterUntil > 0 && (t - waterUntil) < 10 * 60000) {
      if (tryTrigger(b.id + '_w0')) sendPush(tokens, '🚱 Wasser leer!', `${name}: Kein Wasser – Verdorrung läuft!`);
    } else if (waterLeft > 60000) clearTrigger(b.id + '_w0');

    // Verdorrung
    if (waterLeft === 0 && waterUntil > 0) {
      const rotLeft = Math.max(0, waterUntil + ROT_INTERVAL - t);
      [[60,'_r60'],[30,'_r30'],[10,'_r10']].forEach(([mins, key]) => {
        if (rotLeft <= mins * 60000) {
          if (tryTrigger(b.id + key)) sendPush(tokens, '⚠️ Verdorrung!', `${name}: Verdirbt in ~${mins} Min!`);
        } else if (rotLeft > (mins + 5) * 60000) clearTrigger(b.id + key);
      });
    } else if (waterLeft > 0) {
      ['_r60','_r30','_r10'].forEach(k => clearTrigger(b.id + k));
    }

    // Dünger
    const fertLeft = Math.max(0, (b.fertAt || 0) + FERT_INTERVAL - t);
    [[30,'_f30'],[15,'_f15']].forEach(([mins, key]) => {
      if (fertLeft > 0 && fertLeft <= mins * 60000) {
        if (tryTrigger(b.id + key)) sendPush(tokens, '🌿 Dünger läuft ab', `${name}: Dünger endet in ~${mins} Min!`);
      } else if (fertLeft > (mins + 5) * 60000) clearTrigger(b.id + key);
    });
  });

  // Nach dem ersten Durchlauf: Senden freischalten
  if (isFirstRun) {
    isFirstRun = false;
    console.log('[Push] Initialer Scan abgeschlossen. Sende ab jetzt Benachrichtigungen.');
  }
}

async function main() {
  await loadCache();
  console.log('[Rübe] Push-Server gestartet.');
  await checkTimers(); // Erster Durchlauf: nur Cache aufbauen
  setInterval(checkTimers, 10000);
}

main();

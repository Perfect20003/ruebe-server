# Rübe Push-Server

Ein Node.js Server der Timer-Ereignisse aus dem Rübentimer überwacht und Push-Benachrichtigungen ans Handy schickt – auch wenn die App geschlossen ist.

---

## Funktion

Der Server prüft alle 10 Sekunden die Firestore-Daten und schickt bei folgenden Ereignissen eine Push-Notification:

| Ereignis | Benachrichtigung |
|---|---|
| Rübe reif | Sofort |
| Wasser | 15 Min vor Ablauf + wenn abgelaufen |
| Verdorrung | 60 Min, 30 Min und 10 Min vor Ablauf |
| Dünger | 30 Min und 15 Min vor Ablauf |

---

## Setup

### Voraussetzungen
- Node.js 18+
- Firebase Projekt mit Firestore und Cloud Messaging
- Railway Account (kostenlos)

### Deployment auf Railway

**1.** Dieses Repo auf GitHub hochladen

**2.** Railway → New Project → GitHub Repository → dieses Repo auswählen

**3.** In Railway unter **Variables** folgende Umgebungsvariable setzen:

| Name | Wert |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | Inhalt der Service Account JSON-Datei (als eine Zeile) |

Den Service Account Key bekommst du unter:
Firebase Console → Projekteinstellungen → Dienstkonten → Neuen privaten Schlüssel generieren

**4.** Railway startet den Server automatisch – bei grünem Status läuft er.

---

## Lokales Testen

```
npm install
FIREBASE_SERVICE_ACCOUNT='{"type":"service_account",...}' node server.js
```

---

## Technischer Stack

| Technologie | Verwendung |
|---|---|
| Node.js | Laufzeitumgebung |
| firebase-admin | Firestore-Zugriff + FCM Push |
| Railway | Hosting (kostenlos) |

---

*Teil des Rübentimer-Projekts – Made by Perfect2003*

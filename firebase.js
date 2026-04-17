// ============================================================
// firebase.js
// Firebase Admin SDK connection — shared across all services.
// ============================================================

const admin = require("firebase-admin");

let db = null;

function initFirebase() {
  if (db) return db; // already initialized

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(process.env.FIREBASE_KEY);
  } catch (e) {
    console.error("❌ [Firebase] FIREBASE_KEY env var is missing or invalid JSON");
    process.exit(1);
  }

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });

  db = admin.firestore();
  console.log("✅ [Firebase] Connected to Firestore");
  return db;
}

function getDb() {
  if (!db) return initFirebase();
  return db;
}

module.exports = { initFirebase, getDb };

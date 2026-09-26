// =====================================================================
//  Firebase configuration
// =====================================================================
const firebaseConfig = {
  apiKey: "AIzaSyA1K1rWljK-O4GBcyCrKBRlN4dgz-_UNsQ",
  authDomain: "cusco-voting-2026.firebaseapp.com",
  projectId: "cusco-voting-2026",
  storageBucket: "cusco-voting-2026.firebasestorage.app",
  messagingSenderId: "1031032096676",
  appId: "1:1031032096676:web:b26e40a69f78bab075e331"
};

// Keep app.functions() region in sync with the Cloud Function region
// (functions/index.js pins everything to africa-south1).
const FIREBASE_FUNCTIONS_REGION = "africa-south1";

// ---------------------------------------------------------------------
//  Firebase App Check (optional but strongly recommended).
//
//  Put your ReCaptcha Enterprise site key here. Get it at:
//    Firebase Console → App Check → Apps → (your web app) →
//    Create/reuse a ReCaptcha Enterprise key
//
//  Leave FIREBASE_APPCHECK_RECAPTCHA_SITE_KEY = null while the key is
//  not set up: the app works exactly as before (no App Check tokens),
//  and the Cloud Functions stay lenient (they only log/observe). Once
//  the key is set and the site is deployed, flip CUSCO_APPCHECK_ENFORCE=1
//  on the functions to start rejecting untrusted clients.
//
//  For local testing set FIREBASE_APPCHECK_DEBUG = true (or append
//  ?appcheck.debug=... to the URL). See README §App Check.
// ---------------------------------------------------------------------
const FIREBASE_APPCHECK_RECAPTCHA_SITE_KEY = null; // TODO: paste site key here
const FIREBASE_APPCHECK_DEBUG = false; // prod: debug tokens off (set true only for local testing)
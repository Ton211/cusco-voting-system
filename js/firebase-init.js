// =====================================================================
//  Firebase initialization (compat SDK via CDN script tags in each page)
//
//  Paste your Firebase web app config into js/firebase-config.js:
//  the site uses it automatically.
//
//  When you want to test against the local emulator suite, either:
//   • open the page with   ?emulator=1   in the URL, or
//   • set window.LOCAL_EMULATOR = true   in the console, or
//   • uncomment the USE_EMULATORS block below and point it at the
//     ports your emulator is running on.
// =====================================================================

firebase.initializeApp(firebaseConfig);

const AUTH = firebase.auth();
const DB = firebase.firestore();
const FB_STORAGE = firebase.storage();
const FB_FUNCTIONS = firebase.app().functions(FIREBASE_FUNCTIONS_REGION);

// ----------------------------------------------------------------
//  Firestore offline persistence (multi-tab safe).
//  Repeat visits paint instantly from the local cache while the SDK
//  syncs in the background — the single biggest perceived-speed win
//  on slow connections. Read-only pages keep working offline.
//  Failures (old browsers, private mode) fall back to memory cache.
// ----------------------------------------------------------------
try {
  DB.enablePersistence({ synchronizeTabs: true }).catch(function () {});
} catch (e) {}

// ----------------------------------------------------------------
//  Firebase App Check
//  Only active once FIREBASE_APPCHECK_RECAPTCHA_SITE_KEY is set.
//  In debug mode (FIREBASE_APPCHECK_DEBUG = true / ?appcheck.debug=)
//  a debug token is emitted to the console and auto-enabled.
// ----------------------------------------------------------------
if (typeof firebase.appCheck !== 'undefined' && firebase.appCheck && FIREBASE_APPCHECK_RECAPTCHA_SITE_KEY) {
  firebase.appCheck().setTokenAutoRefreshEnabled(true);
  const provider = new firebase.appCheck.ReCaptchaV3Provider(FIREBASE_APPCHECK_RECAPTCHA_SITE_KEY);
  firebase.initializeAppCheck(firebase.app(), { provider: provider, isTokenAutoRefreshEnabled: true });
  if (FIREBASE_APPCHECK_DEBUG || /[?&]appcheck\.debug=/.test(window.location.search)) {
    // Logs the device debug token that must be registered as a debug
    // app in Firebase Console → App Check before enforcement is enabled.
    firebase.appCheck().getToken().catch(function () {});
  }
}

// ----------------------------------------------------------------
//  Emulator support (uncomment + set ports when testing locally)
// ----------------------------------------------------------------
// const USE_EMULATORS = window.LOCAL_EMULATOR === true || /[?&]emulator=1/.test(window.location.search);
// if (USE_EMULATORS) {
//   AUTH.useEmulator('http://127.0.0.1:9099');
//   DB.useEmulator({ host: '127.0.0.1', port: 8081 });
//   FB_STORAGE.useEmulator('127.0.0.1', 9199);
//   FB_FUNCTIONS.useEmulator('http://127.0.0.1:5001');
// }
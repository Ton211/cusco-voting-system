// Inspect deterrent (obscurity only — real security is server-side:
// Firestore/Storage rules + Cloud Functions auth/role checks + App Check).
// Blocks right-click menu, F12, Ctrl+Shift+I/J/C, Ctrl+U. Print (Ctrl+P) left alone.
(function () {
  'use strict';
  document.addEventListener('contextmenu', function (e) { e.preventDefault(); }, { capture: true });
  document.addEventListener('dragstart', function (e) {
    if (e.target && e.target.tagName === 'IMG') e.preventDefault();
  }, { capture: true });
  document.addEventListener('keydown', function (e) {
    var k = String(e.key || '').toUpperCase();
    var kc = e.keyCode || e.which;
    if (kc === 123) { e.preventDefault(); e.stopPropagation(); return false; } // F12
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (k === 'I' || k === 'J' || k === 'C' || k === 'E' || k === 'K')) {
      e.preventDefault(); e.stopPropagation(); return false;
    }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && k === 'U') {
      e.preventDefault(); e.stopPropagation(); return false; // view-source
    }
    return undefined;
  }, { capture: true });
  try {
    console.warn('%cStop! This console is for developers only.', 'font-weight:bold');
  } catch (_) { /* noop */ }
})();

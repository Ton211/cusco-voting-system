// =====================================================================
//  Keyboard avoidance: nudge the login area up SLIGHTLY when the
//  on-screen keyboard appears, so the user sees what they type.
//
//  Resting state: the login panel stays vertically centered.
//  On focus: the card lifts just a little (CSS translate + a minimal
//  scroll, only if the focused field would otherwise sit under the
//  keyboard). Nothing jumps to the top or center of the screen.
// =====================================================================
(function () {
  var SCROLL_DELAY = 120;
  var VIEWPORT_DELAY = 60;
  var EDGE_GAP = 16;
  var scrollTimer = null;
  var viewportTimer = null;

  function activeField() {
    var el = document.activeElement;
    if (!el) return null;
    var tag = (el.tagName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return el;
    return null;
  }

  // Scroll the SMALLEST distance needed to keep the focused field
  // visible above the keyboard. If it is already visible, do nothing
  // (the CSS translate alone gives the slight lift).
  function nudgeFieldIntoView(field) {
    var target = field || activeField();
    if (!target) return;
    try {
      var rect = target.getBoundingClientRect();
      var vv = window.visualViewport;
      var visibleTop = (vv ? vv.offsetTop : 0) + 8;
      var visibleBottom = (vv ? vv.offsetTop + vv.height : window.innerHeight) - EDGE_GAP;
      var delta = 0;
      if (rect.bottom > visibleBottom) {
        delta = rect.bottom - visibleBottom;
      } else if (rect.top < visibleTop) {
        delta = rect.top - visibleTop;
      }
      if (!delta) return;
      // Prefer the inner scroller (.auth-page) when present so the
      // page behind stays put; otherwise nudge the window.
      var scroller = target.closest && target.closest('.auth-page');
      if (scroller && Math.abs(scroller.scrollHeight - scroller.clientHeight) > 2) {
        scroller.scrollBy({ top: delta, behavior: 'smooth' });
      } else if (vv && vv.offsetTop > 0) {
        // Pinch-zoom/keyboard case: visualViewport scrolls separately.
        try { vv.scrollBy ? vv.scrollBy(0, delta) : window.scrollBy({ top: delta, behavior: 'smooth' }); } catch (e) {
          window.scrollBy(0, delta);
        }
      } else {
        window.scrollBy({ top: delta, behavior: 'smooth' });
      }
    } catch (e) {}
  }

  function scheduleScroll() {
    if (scrollTimer) clearTimeout(scrollTimer);
    // Wait for the keyboard slide-up animation before measuring.
    scrollTimer = setTimeout(function () { nudgeFieldIntoView(null); }, 300);
  }

  function updateKeyboardHeight() {
    try {
      var vv = window.visualViewport;
      if (!vv) return;
      var kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      // Ignore tiny deltas (URL bar collapse, rounding noise).
      if (kb < 80) kb = 0;
      document.documentElement.style.setProperty('--kb-height', kb + 'px');
      if (kb > 0) {
        document.body.classList.add('keyboard-open');
      } else if (!activeField()) {
        document.body.classList.remove('keyboard-open');
      }
    } catch (e) {}
  }

  function scheduleViewportUpdate() {
    if (viewportTimer) clearTimeout(viewportTimer);
    viewportTimer = setTimeout(function () {
      updateKeyboardHeight();
      // Re-nudge only if the field ended up under the keyboard.
      nudgeFieldIntoView(null);
    }, VIEWPORT_DELAY);
  }

  document.addEventListener('focusin', function (e) {
    var t = e.target;
    var tag = t && t.tagName ? t.tagName.toUpperCase() : '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      document.body.classList.add('keyboard-open');
      updateKeyboardHeight();
      scheduleScroll();
    }
  });

  document.addEventListener('focusout', function () {
    // Delay: focus moves between fields (e.g. adm -> password) without
    // the keyboard ever closing, so only clear when nothing is focused.
    setTimeout(function () {
      if (!activeField()) {
        document.body.classList.remove('keyboard-open');
        document.documentElement.style.setProperty('--kb-height', '0px');
      } else {
        scheduleScroll();
      }
    }, SCROLL_DELAY);
  });

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', scheduleViewportUpdate);
    window.visualViewport.addEventListener('scroll', scheduleViewportUpdate);
  }
  window.addEventListener('resize', scheduleViewportUpdate);
  window.addEventListener('orientationchange', function () {
    setTimeout(function () {
      updateKeyboardHeight();
      nudgeFieldIntoView(null);
    }, 350);
  });

  updateKeyboardHeight();
})();

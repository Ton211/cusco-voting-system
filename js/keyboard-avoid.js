// =====================================================================
//  Keyboard avoidance: lift the login area above the on-screen keyboard
//  so the user never has to scroll manually to see what they type.
//
//  How it works:
//  - On focusin of any input/textarea/select, adds body.keyboard-open
//    and scrolls the focused field (and its card) into view above the
//    keyboard after a short delay for the keyboard animation.
//  - Tracks window.visualViewport resize to measure the keyboard height
//    and exposes it as --kb-height (used as bottom padding on .auth-page).
//  - On focusout / keyboard dismiss, clears the offset.
//  No dependencies. Safe to include on any page.
// =====================================================================
(function () {
  var SCROLL_DELAY = 120;
  var VIEWPORT_DELAY = 60;
  var scrollTimer = null;
  var viewportTimer = null;

  function activeField() {
    var el = document.activeElement;
    if (!el) return null;
    var tag = (el.tagName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return el;
    return null;
  }

  function scrollFieldIntoView(field) {
    var target = field || activeField();
    if (!target) return;
    try {
      // Center the field in the visible area; block:'center' keeps it
      // clear of both the top bar and the keyboard.
      target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    } catch (e) {
      try { target.scrollIntoView(); } catch (e2) {}
    }
    // Extra nudge for wrappers that scroll (.auth-page): ensure the
    // whole card/form row is visible, not just the input edge.
    var scroller = target.closest && target.closest('.auth-page');
    if (scroller) {
      setTimeout(function () {
        try {
          var r = target.getBoundingClientRect();
          var sr = scroller.getBoundingClientRect();
          var overflow = r.bottom - sr.bottom + 16;
          if (overflow > 0) scroller.scrollTop += overflow;
        } catch (e) {}
      }, SCROLL_DELAY + 120);
    }
  }

  function scheduleScroll() {
    if (scrollTimer) clearTimeout(scrollTimer);
    // Wait for the keyboard slide-up animation before measuring.
    scrollTimer = setTimeout(function () { scrollFieldIntoView(null); }, 300);
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
      // Re-center the field after the viewport settled.
      scrollFieldIntoView(null);
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
      scrollFieldIntoView(null);
    }, 350);
  });

  updateKeyboardHeight();
})();

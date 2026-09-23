// =====================================================================
//  Staff portal page extras: friendly notice when a staff account tried
//  the public voter login first.
// =====================================================================
(function () {
  var noticeBox = document.getElementById('noticeBox');
  if (!noticeBox) return;
  if (/[?&]staff=1/.test(window.location.search)) {
    noticeBox.textContent = 'Staff accounts sign in here through the staff portal.';
    noticeBox.classList.remove('hidden');
  }
})();
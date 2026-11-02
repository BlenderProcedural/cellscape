// Embed helpers for when the page is shown inside an iframe (e.g. a store's product description).
// Links to other pages open in a new tab instead of inside the frame. The frame never scrolls (the host page does,
// and the frame has no scrollbar): in-page anchors do nothing and any scroll goes back to the top.
// The page height is posted to the parent so a host that listens can size the frame.
(function () {
  if (window.self === window.top) return;
  document.documentElement.classList.add('framed');
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a');
    if (!a) return;
    if ((a.getAttribute('href') || '').charAt(0) === '#') {
      e.preventDefault();
      return;
    }
    a.target = '_blank';
    a.rel = 'noopener';
  });
  window.addEventListener('scroll', function () {
    if (window.scrollX || window.scrollY) window.scrollTo(0, 0);
  });
  function post() {
    try { parent.postMessage({ type: 'cellscape-height', height: document.documentElement.scrollHeight }, '*'); } catch (err) { /* ignore */ }
  }
  window.addEventListener('load', post);
  if (window.ResizeObserver) new ResizeObserver(post).observe(document.body);
})();

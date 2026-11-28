// Web version of the resume PDF reader (the phone app uses src/lib/pdf-text-html.ts in a WebView).
// The app opens this page in a sandboxed frame, so it has no access to the Jobbo site or its saved
// data, and sends it the PDF. It answers with { ok, text } or { ok: false, error }.
// Line rebuilding matches pdf-text-html.ts so "City, NY" and job titles stay on their own lines.
(function () {
  var busy = false;
  function reply(msg) {
    parent.postMessage({ __pdfText: JSON.stringify(msg) }, '*');
  }
  async function read(base64) {
    var raw = atob(base64);
    var bytes = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    // The worker code is already loaded above (checked by its fingerprint), so pdf.js runs it here
    // instead of downloading it again unchecked.
    var pdf = await pdfjsLib.getDocument({ data: bytes, isEvalSupported: false, disableFontFace: true }).promise;
    var pages = [];
    for (var p = 1; p <= pdf.numPages; p++) {
      var content = await (await pdf.getPage(p)).getTextContent();
      var lines = [], lastY = null, line = '';
      content.items.forEach(function (it) {
        var y = Math.round(it.transform[5]);
        if (lastY !== null && Math.abs(y - lastY) > 2) { lines.push(line); line = ''; }
        line += (line && !line.endsWith(' ') && !it.str.startsWith(' ') ? ' ' : '') + it.str;
        lastY = y;
      });
      lines.push(line);
      pages.push(lines.join('\n'));
    }
    return pages.join('\n\n');
  }
  window.addEventListener('message', function (e) {
    if (e.source !== parent || busy) return;
    var d = e.data;
    if (!d || typeof d.__pdf !== 'string') return;
    busy = true;
    if (typeof pdfjsLib === 'undefined' || typeof pdfjsWorker === 'undefined') {
      reply({ ok: false, error: 'The PDF reader could not load' });
      return;
    }
    read(d.__pdf).then(
      function (text) { reply({ ok: true, text: text }); },
      function (err) { reply({ ok: false, error: String((err && err.message) || err) }); },
    );
  });
  parent.postMessage({ __pdfReady: true }, '*');
})();

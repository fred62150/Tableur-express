/* Tableur Express — exécution isolée du code proposé par l'IA.
 * Le code tourne dans un Worker, lui-même dans une iframe « sandbox » (origine opaque)
 * dont la politique CSP interdit tout accès réseau. Il ne voit ni la page, ni les cookies,
 * ni les clés d'API, et il est arrêté au bout de quelques secondes.
 */
const Sandbox = (() => {
  const WORKER_SRC = `
self.onmessage = (e) => {
  try {
    const { code, table } = e.data;
    const fn = new Function('table', code + '\\n;return (typeof transform === "function") ? transform(table) : undefined;');
    const out = fn({ headers: table.headers.slice(), rows: table.rows.map((r) => r.slice()) });
    if (!out || !Array.isArray(out.headers) || !Array.isArray(out.rows)) throw new Error('La fonction doit renvoyer { headers, rows }.');
    const cell = (v) => (v instanceof Date || typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') ? v : (v == null ? '' : String(v));
    const rows = out.rows.map((r) => { if (!Array.isArray(r)) throw new Error('Chaque ligne doit être un tableau.'); return r.map(cell); });
    postMessage({ ok: true, table: { headers: out.headers.map(String), rows } });
  } catch (err) { postMessage({ ok: false, error: String((err && err.message) || err) }); }
};`;

  const FRAME_HTML = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\' \'unsafe-eval\' blob:; worker-src blob:">'
    + '<script>'
    + 'const w=new Worker(URL.createObjectURL(new Blob([' + JSON.stringify(WORKER_SRC) + '],{type:"text/javascript"})));'
    + 'w.onmessage=function(e){parent.postMessage(e.data,"*")};'
    + 'w.onerror=function(e){parent.postMessage({ok:false,error:e.message||"Erreur dans le code."},"*")};'
    + 'addEventListener("message",function(e){w.postMessage(e.data)});'
    + 'parent.postMessage({ready:true},"*");'
    + '<\/script>';

  function run(code, table, timeout = 8000) {
    return new Promise((resolve, reject) => {
      const frame = document.createElement('iframe');
      frame.setAttribute('sandbox', 'allow-scripts');
      frame.style.display = 'none';
      let done = false;
      const finish = (fn, v) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        window.removeEventListener('message', onMsg);
        frame.remove();
        fn(v);
      };
      const timer = setTimeout(() => finish(reject, new Error(`Le code a mis trop de temps (plus de ${timeout / 1000} s).`)), timeout);
      const onMsg = (e) => {
        if (e.source !== frame.contentWindow) return;
        const d = e.data || {};
        if (d.ready) frame.contentWindow.postMessage({ code, table: { headers: table.headers, rows: table.rows } }, '*');
        else if (d.ok === true) finish(resolve, d.table);
        else if (d.ok === false) finish(reject, new Error(d.error || 'Erreur dans le code.'));
      };
      window.addEventListener('message', onMsg);
      frame.srcdoc = FRAME_HTML;
      document.body.appendChild(frame);
    });
  }
  return { run };
})();

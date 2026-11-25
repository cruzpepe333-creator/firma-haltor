(function () {
  "use strict";
  var API = "https://khkzwhsbhfydcshzggos.supabase.co/functions/v1/firma";
  var $ = function (id) { return document.getElementById(id); };
  var token = "", pase = "", datos = null, totalHojas = 0;
  var fotos = { ine_frente: false, ine_reverso: false, rostro: false };
  var modoDescarga = false, fallos = { ine_frente: 0, ine_reverso: 0, rostro: 0 };

  var PASOS = { s2: 1, s3: 2, s4: 3, s4c: 3, s5: 4, s6: 5 };
  function show(id) {
    document.querySelectorAll(".screen").forEach(function (s) { s.hidden = s.id !== id; });
    var n = PASOS[id];
    $("top").hidden = !n; $("gbar").hidden = !n;
    if (n) { $("stepno").textContent = "PASO " + n + " DE 5"; $("gbarI").style.width = (n / 5 * 100) + "%"; }
    window.scrollTo(0, 0);
  }
  function fin(titulo, mensaje) {
    $("s0spin").hidden = true; $("s0t").textContent = titulo; $("s0m").textContent = mensaje; show("s0");
  }
  function error(id, texto) { var e = $(id); e.textContent = texto || ""; e.hidden = !texto; }

  async function api(cuerpo) {
    cuerpo.token = token; if (pase) cuerpo.pase = pase;
    var r;
    try {
      r = await fetch(API, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo), cache: "no-store", referrerPolicy: "no-referrer" });
    } catch (e) {
      throw { codigo: "red", mensaje: "No hay conexión. Revise su internet e intente de nuevo." };
    }
    var j = {};
    try { j = await r.json(); } catch (e) { /* respuesta vacía */ }
    if (!r.ok) throw { codigo: j.error || "interno", mensaje: j.mensaje || "Ocurrió un error. Intente de nuevo en un momento.", estado: r.status };
    return j;
  }
  // Errores que terminan el proceso sin importar el paso.
  function fatal(e) {
    var t = { enlace: "Enlace no válido", anulado: "Enlace sustituido", bloqueado: "Enlace bloqueado", vencido: "Enlace vencido", no_disponible: "Contrato no disponible", firmado: "Contrato ya firmado", en_revision: "Firma recibida" }[e.codigo];
    if (!t) return false;
    try { sessionStorage.removeItem("pase:" + token); } catch (x) { /* sin almacenamiento */ }
    fin(t, e.mensaje); return true;
  }
  function sesionVencida(e) {
    if (e.codigo !== "sesion") return false;
    pase = ""; try { sessionStorage.removeItem("pase:" + token); } catch (x) { /* sin almacenamiento */ }
    error("codeErr", "Su sesión venció. Escriba de nuevo su código."); $("code").value = ""; show("s2");
    return true;
  }

  var fmt = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", hour12: false });

  function continuar(p) {
    fotos.ine_frente = p.ine_frente; fotos.ine_reverso = p.ine_reverso; fotos.rostro = p.rostro; leidoAntes = !!p.lectura;
    marcar("dropF", p.ine_frente); marcar("dropR", p.ine_reverso); marcar("dropS", p.rostro); revisarFotos();
    if (!p.aviso) return show("s3");
    if (!(p.ine_frente && p.ine_reverso && p.rostro)) { show("s4"); cargarDetector(); return; }
    if (p.lectura) { show("s6"); prepararFirma(); return; }
    show("s5"); cargarContrato();
  }

  // Arranque
  async function iniciar() {
    var m = /^#?([0-9a-f]{64})$/.exec(location.hash || "");
    if (!m) return fin("Enlace incompleto", "Abra el enlace tal como llegó en su correo. Si lo copió, verifique que esté completo.");
    token = m[1];
    try { pase = sessionStorage.getItem("pase:" + token) || ""; } catch (x) { pase = ""; }
    try {
      datos = await api({ accion: "abrir" });
    } catch (e) {
      if (fatal(e)) return;
      return fin("No se pudo abrir", e.mensaje);
    }
    if (datos.en_revision) return fin("Firma recibida", "El despacho está revisando su identificación y su firma. Le avisaremos por correo cuando su contrato quede aceptado.");
    $("dCorreo").textContent = datos.correo;
    if (datos.firmado) {
      modoDescarga = true;
      $("codeLead").textContent = "Su contrato ya fue aceptado por el despacho. Escriba el código de 6 dígitos de su correo para descargar su copia.";
      $("go2").textContent = "Verificar y descargar";
      show("s2"); $("top").hidden = true; $("gbar").hidden = true; return;
    }
    if (datos.repetir) {
      var nombres = { ine_frente: "el frente de su identificación", ine_reverso: "el reverso de su identificación", rostro: "la fotografía de su rostro", firma: "su firma" };
      var lista = (datos.repetir.campos || []).map(function (k) { return nombres[k] || k; }).join(", ");
      $("repetirTxt").textContent = datos.repetir.motivo + (lista ? " Debe repetir: " + lista + "." : "");
      $("repetir").hidden = false; $("plan").hidden = true;
    }
    $("saludo").textContent = "Estimado(a) " + String(datos.nombre).split(" ")[0] + ":";
    $("dNumero").textContent = datos.numero; $("dAsunto").textContent = datos.asunto;
    $("dVence").textContent = fmt.format(new Date(datos.expira)) + " h";
    $("quien").textContent = String(datos.nombre).toUpperCase(); $("rNumero").textContent = datos.numero;
    if (datos.empresa) { $("dAsunto").textContent = datos.asunto + " · Usted firma por " + datos.empresa + (datos.cargo ? ", como " + datos.cargo : "") + "."; var rol = document.querySelector("#pad .who span"); if (rol) rol.textContent = (datos.cargo ? datos.cargo + ", " : "") + "por " + datos.empresa; }
    show("s1");
  }
  $("go1").addEventListener("click", function () { show("s2"); $("code").focus(); });

  // 2: código
  $("code").addEventListener("input", function (e) {
    e.target.value = e.target.value.replace(/\D/g, "").slice(0, 6);
    error("codeErr", ""); e.target.classList.remove("bad");
  });
  async function verificar() {
    var c = $("code").value;
    if (c.length !== 6) { error("codeErr", "Escriba los 6 dígitos del código."); return; }
    $("go2").disabled = true;
    try {
      var r = await api({ accion: "verificar", codigo: c });
      pase = r.pase; try { sessionStorage.setItem("pase:" + token, pase); } catch (x) { /* sin almacenamiento */ }
      if (modoDescarga || r.progreso.firmado) {
        var d = await api({ accion: "descargar" });
        $("huella").textContent = d.sha256; $("descarga").href = d.url;
        $("descNota").textContent = "El enlace de descarga dura 10 minutos. Si vence, vuelva a abrir el enlace de su correo.";
        show("s8"); return;
      }
      continuar(r.progreso);
    } catch (e) {
      if (!fatal(e)) { error("codeErr", e.mensaje); $("code").classList.add("bad"); $("code").focus(); }
    } finally { $("go2").disabled = false; }
  }
  $("go2").addEventListener("click", verificar);
  $("code").addEventListener("keydown", function (e) { if (e.key === "Enter") verificar(); });

  // 3: aviso
  function radio(n) { var r = document.querySelector('input[name="' + n + '"]:checked'); return r ? r.value : null; }
  function revisarAviso() { $("go3").disabled = !($("pv1").checked && $("pv2").checked && radio("sens") && radio("transf")); }
  ["pv1", "pv2"].forEach(function (id) { $(id).addEventListener("change", revisarAviso); });
  document.querySelectorAll('input[name="sens"],input[name="transf"]').forEach(function (r) { r.addEventListener("change", revisarAviso); });
  $("go3").addEventListener("click", async function () {
    $("go3").disabled = true; error("avisoErr", "");
    try {
      await api({ accion: "aviso", acepta: $("pv1").checked, patrimoniales: $("pv2").checked, datos_sensibles: radio("sens") === "si", transferencias: radio("transf") === "si" });
      show("s4"); cargarDetector();
    } catch (e) {
      if (!fatal(e) && !sesionVencida(e)) error("avisoErr", e.mensaje);
    } finally { revisarAviso(); }
  });

  // 4: identificación
  function marcar(id, lista, url) {
    var d = $(id); d.classList.toggle("lista", !!lista);
    var viejo = d.querySelector("img"); if (viejo) viejo.remove();
    var ok = d.querySelector(".ok"); if (ok) ok.remove();
    if (lista) {
      if (url) { var im = document.createElement("img"); im.alt = ""; im.src = url; d.appendChild(im); }
      var s = document.createElement("i"); s.className = "ok"; s.textContent = "Recibida"; d.appendChild(s);
    }
  }
  function revisarFotos() { $("go4").disabled = !(fotos.ine_frente && fotos.ine_reverso && fotos.rostro); }
  function reducir(fuente, ancho, alto, max) {
    var e = Math.min(1, max / Math.max(ancho, alto));
    var c = document.createElement("canvas"); c.width = Math.round(ancho * e); c.height = Math.round(alto * e);
    c.getContext("2d").drawImage(fuente, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.86);
  }
  function leerArchivo(archivo) {
    return new Promise(function (ok, mal) {
      var url = URL.createObjectURL(archivo); var im = new Image();
      im.onload = function () { try { ok(reducir(im, im.naturalWidth, im.naturalHeight, 1600)); } catch (e) { mal(e); } URL.revokeObjectURL(url); };
      im.onerror = function () { URL.revokeObjectURL(url); mal(new Error("imagen")); };
      im.src = url;
    });
  }
  // Filtros automáticos: luz, nitidez y presencia de un rostro. Ayudan al cliente y a quien revisa; no sustituyen la revisión.
  var detector = null, detectorListo = false;
  function cargarDetector() {
    if (detector) return; detector = true;
    var s = document.createElement("script"); s.src = "rostro.js";
    s.onload = async function () {
      try {
        await window.faceapi.nets.tinyFaceDetector.loadFromUri("modelo");
        var c = document.createElement("canvas"); c.width = 160; c.height = 160;
        await window.faceapi.detectAllFaces(c, new window.faceapi.TinyFaceDetectorOptions({ inputSize: 160 }));
        detectorListo = true;
      } catch (e) { detectorListo = false; }
    };
    document.head.appendChild(s);
  }
  function imagenDe(dataUrl) { return new Promise(function (ok, mal) { var im = new Image(); im.onload = function () { ok(im); }; im.onerror = mal; im.src = dataUrl; }); }
  async function analizar(dataUrl, buscarRostro) {
    var r = { luz: null, nitidez: null, rostros: null };
    try {
      var im = await imagenDe(dataUrl), w = 400, h = Math.max(8, Math.round(im.naturalHeight * w / im.naturalWidth));
      var c = document.createElement("canvas"); c.width = w; c.height = h;
      var g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(im, 0, 0, w, h);
      var px = g.getImageData(0, 0, w, h).data, y = new Float32Array(w * h), suma = 0;
      for (var i = 0; i < w * h; i++) { y[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]; suma += y[i]; }
      r.luz = suma / (w * h);
      var n = 0, s1 = 0, s2 = 0;
      for (var f = 1; f < h - 1; f++) for (var k = 1; k < w - 1; k++) {
        var p = f * w + k, l = 4 * y[p] - y[p - w] - y[p + w] - y[p - 1] - y[p + 1];
        s1 += l; s2 += l * l; n++;
      }
      r.nitidez = s2 / n - (s1 / n) * (s1 / n);
      if (buscarRostro && detectorListo) {
        var det = await Promise.race([
          window.faceapi.detectAllFaces(im, new window.faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.45 })),
          new Promise(function (ok) { setTimeout(function () { ok(null); }, 12000); })
        ]);
        if (det) {
          var minimo = (buscarRostro === "grande" ? 0.18 : 0.04) * Math.min(im.naturalWidth, im.naturalHeight);
          r.rostros = det.filter(function (x) { return x.box.width >= minimo; }).length;
        }
      }
    } catch (e) { /* sin análisis: decide la revisión del despacho */ }
    return r;
  }
  function problema(tipo, a) {
    if (a.luz !== null && a.luz < 40) return "La fotografía salió muy oscura. Busque más luz y tómela de nuevo.";
    if (a.luz !== null && a.luz > 238) return "La fotografía salió quemada por exceso de luz. Evite el reflejo y tómela de nuevo.";
    if (a.nitidez !== null && a.nitidez < 30) return "La fotografía salió borrosa. Mantenga firme el teléfono y tómela de nuevo.";
    if (tipo === "rostro" && a.rostros === 0) return "No se distingue su rostro. Mire de frente a la cámara, sin lentes oscuros ni gorra, y tómela de nuevo.";
    if (tipo === "rostro" && a.rostros > 1) return "Aparece más de una persona. En la fotografía debe salir solo usted.";
    if (tipo === "ine_frente" && a.rostros === 0) return "No se distingue la fotografía de su identificación. Verifique que sea el frente de su credencial, completa y bien enfocada.";
    return "";
  }
  async function enviarFoto(tipo, dropId, dataUrl, origen) {
    var d = $(dropId); d.classList.add("subiendo"); error("idErr", "");
    try {
      var a = await analizar(dataUrl, tipo === "rostro" ? "grande" : tipo === "ine_frente" ? "chico" : null);
      var falla = problema(tipo, a), forzada = false;
      if (falla) {
        fallos[tipo]++;
        if (fallos[tipo] < 3) { error("idErr", falla); return; }
        forzada = true;
      }
      await api({ accion: "subir", tipo: tipo, imagen: dataUrl, auto: { luz: a.luz, nitidez: a.nitidez, rostros: a.rostros, origen: origen || "archivo", forzada: forzada } });
      if (forzada) error("idErr", "Guardamos esta fotografía, pero el despacho la revisará y puede pedirle que la repita.");
      fotos[tipo] = true; marcar(dropId, true, dataUrl);
    } catch (e) {
      if (!fatal(e) && !sesionVencida(e)) error("idErr", e.mensaje);
    } finally { d.classList.remove("subiendo"); revisarFotos(); }
  }
  function alElegir(inputId, tipo, dropId) {
    $(inputId).addEventListener("change", async function (ev) {
      var f = ev.target.files && ev.target.files[0]; ev.target.value = "";
      if (!f) return;
      try { await enviarFoto(tipo, dropId, await leerArchivo(f)); }
      catch (e) { error("idErr", "No se pudo leer esa imagen. Tome la fotografía de nuevo."); }
    });
  }
  alElegir("ineF", "ine_frente", "dropF"); alElegir("ineR", "ine_reverso", "dropR"); alElegir("selfieArchivo", "rostro", "dropS");

  var flujo = null;
  function apagar() { if (flujo) { flujo.getTracks().forEach(function (t) { t.stop(); }); flujo = null; } $("video").srcObject = null; }
  $("dropS").addEventListener("click", async function () {
    error("idErr", "");
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { $("selfieArchivo").click(); return; }
    try {
      flujo = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false });
      $("video").srcObject = flujo; show("s4c");
    } catch (e) {
      // Sin permiso de cámara: se usa la cámara del sistema.
      $("selfieArchivo").click();
    }
  });
  $("cancelarCam").addEventListener("click", function () { apagar(); show("s4"); });
  $("tomar").addEventListener("click", async function () {
    var v = $("video");
    if (!v.videoWidth) return;
    var url = reducir(v, v.videoWidth, v.videoHeight, 1400);
    apagar(); show("s4");
    await enviarFoto("rostro", "dropS", url, "camara");
  });
  window.addEventListener("pagehide", apagar);
  $("go4").addEventListener("click", function () { if (datos && datos.repetir && cargado === false && leidoAntes) { show("s6"); prepararFirma(); return; } show("s5"); cargarContrato(); });

  // 5: lectura
  var cargado = false, llegoAlFinal = false, leidoAntes = false;
  async function sha256(bytes) {
    var h = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(h)).map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
  }
  async function cargarContrato() {
    if (cargado) return; cargado = true;
    var visor = $("viewer");
    try {
      var d = await api({ accion: "documento" });
      var r = await fetch(d.url, { cache: "no-store", referrerPolicy: "no-referrer" });
      if (!r.ok) throw { mensaje: "No se pudo descargar el contrato." };
      var bytes = new Uint8Array(await r.arrayBuffer());
      if ((await sha256(bytes)) !== d.sha256) throw { mensaje: "El contrato recibido no coincide con el registrado. Avise al despacho." };
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = "pdf.worker.min.js";
      var doc = await window.pdfjsLib.getDocument({ data: bytes, isEvalSupported: false }).promise;
      totalHojas = doc.numPages;
      $("dHojas").textContent = totalHojas === 1 ? "Es 1 hoja." : "Son " + totalHojas + " hojas.";
      $("vload").remove();
      var ancho = visor.clientWidth - 28, dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      for (var n = 1; n <= totalHojas; n++) {
        var pagina = await doc.getPage(n);
        var vp1 = pagina.getViewport({ scale: 1 });
        var vp = pagina.getViewport({ scale: (ancho * dpr) / vp1.width });
        var c = document.createElement("canvas"); c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
        visor.appendChild(c);
        await pagina.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
      }
      alDeslizar();
    } catch (e) {
      cargado = false;
      if (e && e.codigo && (fatal(e) || sesionVencida(e))) return;
      var v = $("vload"); if (!v) { v = document.createElement("div"); v.className = "loading"; v.id = "vload"; visor.textContent = ""; visor.appendChild(v); }
      v.textContent = (e && e.mensaje) || "No se pudo mostrar el contrato. Recargue la página para intentarlo de nuevo.";
    }
  }
  function alDeslizar() {
    var v = $("viewer"), max = v.scrollHeight - v.clientHeight;
    var listo = totalHojas > 0 && v.querySelectorAll("canvas").length >= totalHojas;
    var pct = !listo ? 0 : max > 4 ? Math.min(100, Math.round(v.scrollTop / max * 100)) : 100;
    $("bar").style.width = pct + "%"; $("pct").textContent = "Leído " + pct + "%";
    if (listo && pct >= 97 && !llegoAlFinal) { llegoAlFinal = true; $("c1").disabled = false; $("c1w").classList.remove("off"); }
  }
  $("viewer").addEventListener("scroll", alDeslizar, { passive: true });
  $("c1").addEventListener("change", function () { $("go5").disabled = !$("c1").checked; });
  $("go5").addEventListener("click", async function () {
    $("go5").disabled = true; error("leerErr", "");
    try { await api({ accion: "leido" }); show("s6"); prepararFirma(); }
    catch (e) { if (!fatal(e) && !sesionVencida(e)) error("leerErr", e.mensaje); }
    finally { $("go5").disabled = !$("c1").checked; }
  });

  // 6: firma
  var ctx = null, listoPad = false, dibujando = false, ultimo = null, conTinta = false;
  function revisarFirma() { $("go6").disabled = !(conTinta && $("c3").checked && $("nombre").value.trim().length >= 5); }
  function prepararFirma() {
    var c = $("sig"), caja = $("pad").getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    if (!listoPad || c.width !== Math.round(caja.width * dpr)) {
      c.width = Math.round(caja.width * dpr); c.height = Math.round(caja.height * dpr);
      ctx = c.getContext("2d"); ctx.scale(dpr, dpr);
      ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#1F2F9E"; ctx.fillStyle = "#1F2F9E"; ctx.lineWidth = 2.6;
      conTinta = false; $("padPh").hidden = false; revisarFirma();
    }
    if (listoPad) return; listoPad = true;
    var pos = function (e) { var r = c.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    c.addEventListener("pointerdown", function (e) {
      e.preventDefault(); dibujando = true; ultimo = pos(e);
      try { c.setPointerCapture(e.pointerId); } catch (x) { /* sin captura */ }
      ctx.beginPath(); ctx.arc(ultimo.x, ultimo.y, 1.2, 0, Math.PI * 2); ctx.fill();
    });
    c.addEventListener("pointermove", function (e) {
      if (!dibujando) return; var p = pos(e);
      ctx.beginPath(); ctx.moveTo(ultimo.x, ultimo.y); ctx.lineTo(p.x, p.y); ctx.stroke(); ultimo = p;
      if (!conTinta) { conTinta = true; $("padPh").hidden = true; revisarFirma(); }
    });
    var soltar = function () { dibujando = false; };
    c.addEventListener("pointerup", soltar); c.addEventListener("pointercancel", soltar); c.addEventListener("pointerleave", soltar);
  }
  $("clear").addEventListener("click", function () {
    var c = $("sig"); if (!ctx) return;
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, c.width, c.height); ctx.restore();
    conTinta = false; $("padPh").hidden = false; revisarFirma();
  });
  $("c3").addEventListener("change", revisarFirma); $("nombre").addEventListener("input", revisarFirma);
  function firmaRecortada() {
    var c = $("sig"), g = c.getContext("2d"), d = g.getImageData(0, 0, c.width, c.height).data;
    var x0 = c.width, y0 = c.height, x1 = 0, y1 = 0;
    for (var y = 0; y < c.height; y++) for (var x = 0; x < c.width; x++) {
      if (d[(y * c.width + x) * 4 + 3] > 10) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    if (x1 <= x0 || y1 <= y0) return null;
    var m = 8; x0 = Math.max(0, x0 - m); y0 = Math.max(0, y0 - m); x1 = Math.min(c.width - 1, x1 + m); y1 = Math.min(c.height - 1, y1 + m);
    var e = Math.min(1, 900 / (x1 - x0 + 1));
    var o = document.createElement("canvas"); o.width = Math.round((x1 - x0 + 1) * e); o.height = Math.round((y1 - y0 + 1) * e);
    o.getContext("2d").drawImage(c, x0, y0, x1 - x0 + 1, y1 - y0 + 1, 0, 0, o.width, o.height);
    return o.toDataURL("image/png");
  }
  $("go6").addEventListener("click", async function () {
    var f = firmaRecortada();
    if (!f) { error("firmaErr", "Trace su firma antes de continuar."); return; }
    error("firmaErr", ""); show("s7");
    try {
      await api({ accion: "firmar", acepta: true, nombre: $("nombre").value.trim(), firma: f });
      try { sessionStorage.removeItem("pase:" + token); } catch (x) { /* sin almacenamiento */ }
      show("s9");
    } catch (e) {
      if (fatal(e) || sesionVencida(e)) return;
      show("s6"); prepararFirma(); error("firmaErr", e.mensaje);
    }
  });

  iniciar();
})();

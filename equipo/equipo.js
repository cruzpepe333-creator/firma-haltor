(function () {
  "use strict";
  var URL_SB = "https://khkzwhsbhfydcshzggos.supabase.co";
  var LLAVE = "sb_publishable_SasQR2QRp00MfP9oohOAAw_vqalxegT"; // llave pública: solo sirve junto con una sesión del equipo
  var API = URL_SB + "/functions/v1/firma", DESPACHO = URL_SB + "/functions/v1/despacho";
  var desp = { firmante: "", soy_firmante: false, mi_firma: null };
  var sb = window.supabase.createClient(URL_SB, LLAVE, { auth: { persistSession: true, storage: window.sessionStorage, autoRefreshToken: true, detectSessionInUrl: true } });
  var $ = function (id) { return document.getElementById(id); };
  var factor = null, contratos = [], llegoPorEnlace = /access_token=/.test(location.hash || "");

  function el(tag, cls, texto) { var n = document.createElement(tag); if (cls) n.className = cls; if (texto !== undefined && texto !== null) n.textContent = String(texto); return n; }
  function error(id, t) { var e = $(id); e.textContent = t || ""; e.hidden = !t; }
  function ver(id) { ["vAcceso", "vDos", "vClave", "vPanel"].forEach(function (v) { $(v).hidden = v !== id; }); }
  var fmt = new Intl.DateTimeFormat("es-MX", { timeZone: "America/Mexico_City", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
  function fecha(v) { if (!v) return ""; var d = new Date(v); return isNaN(d) ? "" : fmt.format(d) + " h"; }
  function humano(t) { var s = String(t || "").replace(/_/g, " "); return s.charAt(0).toUpperCase() + s.slice(1); }

  var ESTADOS = {
    borrador: { t: "En preparación", c: "idle" }, enviado: { t: "Enviado al cliente", c: "warn" },
    firmado_cliente: { t: "Firmó el cliente, falta su revisión", c: "warn" }, firmado: { t: "Firmado y aceptado", c: "ok" }, cancelado: { t: "Cancelado", c: "err" }
  };

  async function api(cuerpo, destino) {
    var s = (await sb.auth.getSession()).data.session;
    if (!s) { ver("vAcceso"); throw { mensaje: "Su sesión venció. Entre de nuevo." }; }
    var r;
    try { r = await fetch(destino || API, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + s.access_token }, body: JSON.stringify(cuerpo), cache: "no-store" }); }
    catch (e) { throw { mensaje: "No hay conexión. Revise su internet." }; }
    var j = {}; try { j = await r.json(); } catch (e) { /* vacío */ }
    if (!r.ok) {
      if (j.error === "acceso") { await sb.auth.signOut(); ver("vAcceso"); }
      if (j.error === "dos_pasos") { ver("vDos"); }
      throw { codigo: j.error, mensaje: j.mensaje || "Ocurrió un error. Intente de nuevo." };
    }
    return j;
  }

  // ---------- Acceso
  $("entrar").addEventListener("click", entrar);
  $("clave").addEventListener("keydown", function (e) { if (e.key === "Enter") entrar(); });
  async function entrar() {
    error("accesoErr", ""); $("entrar").disabled = true;
    try {
      var r = await sb.auth.signInWithPassword({ email: $("correo").value.trim().toLowerCase(), password: $("clave").value });
      $("clave").value = "";
      if (r.error) { error("accesoErr", "Correo o contraseña incorrectos."); return; }
      await segundoPaso();
    } finally { $("entrar").disabled = false; }
  }

  // Acceso sin contraseña: enlace de un solo uso al correo. El segundo paso con el celular se exige igual.
  $("enlace").addEventListener("click", async function () {
    error("accesoErr", ""); $("accesoOk").hidden = true;
    var correo = $("correo").value.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)) { error("accesoErr", "Escriba primero su correo."); return; }
    $("enlace").disabled = true;
    try {
      var r = await sb.auth.signInWithOtp({ email: correo, options: { shouldCreateUser: false, emailRedirectTo: location.origin + location.pathname } });
      if (r.error) {
        var m = String(r.error.message || "");
        error("accesoErr", /rate|limit|seconds/i.test(m) ? "Ya se envió un enlace hace poco. Espere unos minutos antes de pedir otro." : /not authorized/i.test(m) ? "El servicio de correo aún no puede escribir a esta dirección. Avise al administrador." : "No se pudo enviar el enlace. Verifique el correo e intente más tarde.");
        return;
      }
      $("accesoOk").textContent = "Si el correo pertenece al equipo, en un momento llegará un enlace de acceso. Ábralo en este mismo dispositivo. Revise también la carpeta de correo no deseado.";
      $("accesoOk").hidden = false;
    } finally { setTimeout(function () { $("enlace").disabled = false; }, 8000); }
  });

  async function segundoPaso() {
    error("dosErr", ""); $("totp").value = "";
    var miembro = await sb.rpc("es_equipo");
    if (!miembro.error && miembro.data === true) return abrirPanel();
    var nivel = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
    if (nivel.data && nivel.data.currentLevel === "aal2") { await sb.auth.signOut(); error("accesoErr", "Su cuenta no pertenece al equipo autorizado."); return ver("vAcceso"); }
    var lista = await sb.auth.mfa.listFactors();
    if (lista.error) { error("accesoErr", "No se pudo consultar la verificación en dos pasos."); return ver("vAcceso"); }
    var verificados = (lista.data.totp || []).filter(function (f) { return f.status === "verified"; });
    if (verificados.length) {
      factor = verificados[0].id; $("alta").hidden = true;
      $("dosNota").textContent = "Escriba el código de 6 dígitos que muestra su app de autenticación.";
    } else {
      var viejos = (lista.data.all || []).filter(function (f) { return f.status !== "verified"; });
      for (var i = 0; i < viejos.length; i++) await sb.auth.mfa.unenroll({ factorId: viejos[i].id });
      var alta = await sb.auth.mfa.enroll({ factorType: "totp", friendlyName: "HALTOR Firma " + Date.now() });
      if (alta.error) { error("accesoErr", "No se pudo iniciar la verificación en dos pasos: " + alta.error.message); return ver("vAcceso"); }
      factor = alta.data.id; $("qr").src = alta.data.totp.qr_code; $("secreto").textContent = alta.data.totp.secret; $("alta").hidden = false;
      $("dosNota").textContent = "Después de agregar la cuenta, escriba aquí el código de 6 dígitos que muestra la app.";
    }
    ver("vDos"); $("totp").focus();
  }
  $("verificar").addEventListener("click", verificar);
  $("totp").addEventListener("keydown", function (e) { if (e.key === "Enter") verificar(); });
  $("totp").addEventListener("input", function (e) { e.target.value = e.target.value.replace(/\D/g, "").slice(0, 6); });
  async function verificar() {
    var c = $("totp").value; if (c.length !== 6) { error("dosErr", "Escriba los 6 dígitos."); return; }
    $("verificar").disabled = true; error("dosErr", "");
    try {
      var r = await sb.auth.mfa.challengeAndVerify({ factorId: factor, code: c });
      if (r.error) { error("dosErr", "El código no coincide. Espere a que la app muestre uno nuevo e intente otra vez."); return; }
      $("qr").removeAttribute("src"); $("secreto").textContent = "";
      await segundoPaso();
    } finally { $("verificar").disabled = false; }
  }
  $("salir").addEventListener("click", async function () { await sb.auth.signOut(); $("quien").hidden = true; ver("vAcceso"); });

  // ---------- Contraseña propia, al llegar por enlace
  var REGLAS = [["Al menos 12 caracteres", function (v) { return v.length >= 12; }], ["Una letra mayúscula", function (v) { return /[A-Z]/.test(v); }], ["Una letra minúscula", function (v) { return /[a-z]/.test(v); }], ["Un número", function (v) { return /\d/.test(v); }], ["Un símbolo, por ejemplo . , ! # $ % * -", function (v) { return /[^A-Za-z0-9]/.test(v); }]];
  function listaReglas(ul, v1, v2) {
    ul.textContent = ""; var todo = true;
    REGLAS.concat([["Las dos contraseñas son iguales", function () { return v1.length > 0 && v1 === v2; }]]).forEach(function (r) { var ok = r[1](v1); if (!ok) todo = false; ul.appendChild(el("li", ok ? "si" : "no", (ok ? "Listo: " : "Falta: ") + r[0])); });
    return todo;
  }
  (function () {
    var c1 = $("pc1"), c2 = $("pc2"), ul = $("pcReglas"), b = $("pcGuardar");
    var pinta = function () { b.disabled = !listaReglas(ul, c1.value, c2.value); };
    c1.addEventListener("input", pinta); c2.addEventListener("input", pinta); pinta();
    $("pcVer").addEventListener("change", function () { c1.type = c2.type = $("pcVer").checked ? "text" : "password"; });
    b.addEventListener("click", async function () {
      error("pcErr", ""); b.disabled = true; b.textContent = "Guardando";
      try { await api({ accion: "cuenta_clave", clave: c1.value }); c1.value = ""; c2.value = ""; await abrirPanel(); $("eqOk").textContent = "Su contraseña quedó guardada. La próxima vez entre con su correo y esa contraseña."; $("eqOk").hidden = false; }
      catch (x) { error("pcErr", x.mensaje || "No se pudo guardar. Intente de nuevo."); }
      finally { b.textContent = "Guardar y entrar"; pinta(); }
    });
    $("pcOmitir").addEventListener("click", function () { abrirPanel(); });
  })();

  async function abrirPanel() {
    if (llegoPorEnlace) { llegoPorEnlace = false; ver("vClave"); return; }
    var u = (await sb.auth.getUser()).data.user;
    $("quienCorreo").textContent = u ? u.email : ""; $("quien").hidden = false;
    ver("vPanel");
    try { desp = await api({ accion: "estado" }, DESPACHO); } catch (e) { desp = { firmante: "", soy_firmante: false, mi_firma: null }; }
    await cargar(); cargarEquipo(); pintarFirma();
  }

  // ---------- Equipo, correo y contraseña
  async function cargarEquipo() {
    try {
      var r = await api({ accion: "equipo_miembros" });
      $("correoEstado").textContent = r.correo_listo ? "El correo del despacho está conectado: al aprobar un contrato se envía solo al cliente, con copia al equipo." : "El correo del despacho aún no está conectado. Mientras tanto, los avisos se envían desde su propio correo con el botón que aparece en cada paso.";
      var M = $("miembros"); M.textContent = "";
      (r.miembros || []).forEach(function (m) {
        var it = el("div", "item"); var t = el("div", "t");
        t.appendChild(el("b", null, m.nombre || m.correo)); t.appendChild(el("span", null, m.correo + " · " + (m.rol === "titular" ? "Titular" : "Colaborador")));
        it.appendChild(t);
        var a = el("div", "acc");
        a.appendChild(el("span", "pill " + (m.ultimo_acceso ? "ok" : m.cuenta ? "warn" : "idle"), m.ultimo_acceso ? "Ya entró, " + fecha(m.ultimo_acceso) : m.cuenta ? "Cuenta creada, aún no entra" : "Sin cuenta"));
        var b = el("button", "btn claro", "Generar enlace de acceso"); b.type = "button";
        b.addEventListener("click", function () { invitar(m, b); }); a.appendChild(b);
        it.appendChild(a); M.appendChild(it);
      });
    } catch (e) { $("correoEstado").textContent = e.mensaje || "No se pudo consultar el equipo."; }
  }
  async function invitar(m, b) {
    b.disabled = true; error("eqErr", "");
    try {
      var r = await api({ accion: "equipo_invitar", correo: m.correo });
      var D = abrir("Acceso para " + (m.nombre || m.correo));
      D.appendChild(el("p", "nota", "Este enlace es de un solo uso y vence en una hora. Mándelo solo a " + m.correo + ". Al abrirlo, la app le pedirá definir su propia contraseña. Nadie más la conocerá."));
      var caja = el("div", "env"); caja.appendChild(el("code", null, r.enlace)); D.appendChild(caja);
      var texto = "Hola:\n\nEste es tu acceso a la app de firma digital de HALTOR. Ábrelo antes de una hora, es de un solo uso:\n" + r.enlace + "\n\nAl entrar te pedirá definir tu contraseña. Después entras en " + location.origin + location.pathname + " con tu correo y esa contraseña.";
      var acc = el("div", "acc");
      var a = el("a", "btn", "Abrir mi correo con el mensaje listo"); a.href = correoA({ cliente_correo: m.correo }, "Tu acceso a la app de firma de HALTOR", texto); acc.appendChild(a);
      var cp = el("button", "btn claro", "Copiar mensaje"); cp.type = "button"; cp.addEventListener("click", function () { copiar(texto, cp); }); acc.appendChild(cp);
      D.appendChild(acc); cargarEquipo();
    } catch (e) { error("eqErr", e.mensaje); }
    finally { b.disabled = false; }
  }
  $("probarCorreo").addEventListener("click", async function () {
    var b = $("probarCorreo"); b.disabled = true; error("eqErr", ""); $("eqOk").hidden = true;
    try { await api({ accion: "equipo_probar_correo" }); $("eqOk").textContent = "Correo de prueba enviado. Revise su bandeja y la carpeta de no deseado."; $("eqOk").hidden = false; }
    catch (e) { error("eqErr", "No se pudo enviar: " + e.mensaje); }
    finally { b.disabled = false; }
  });
  $("cambiarClave").addEventListener("click", function () { ventanaClave(false); });
  function ventanaClave(primera) {
    var D = abrir(primera ? "Defina su contraseña" : "Cambiar mi contraseña");
    D.appendChild(el("p", "nota", (primera ? "Bienvenido. Para entrar las próximas veces necesita una contraseña propia. " : "") + "Mínimo 12 caracteres, con mayúsculas, minúsculas, números y un símbolo. No use una que ya tenga en otro sitio."));
    var l1 = el("label", null, "Contraseña nueva"); l1.htmlFor = "cl1"; D.appendChild(l1);
    var c1 = el("input"); c1.type = "password"; c1.id = "cl1"; c1.autocomplete = "new-password"; D.appendChild(c1);
    var l2 = el("label", null, "Repítala"); l2.htmlFor = "cl2"; D.appendChild(l2);
    var c2 = el("input"); c2.type = "password"; c2.id = "cl2"; c2.autocomplete = "new-password"; D.appendChild(c2);
    var ul = el("ul", "reglas"); D.appendChild(ul);
    var e = el("p", "err"); e.hidden = true; D.appendChild(e);
    var b = el("button", "btn", "Guardar contraseña"); b.type = "button"; D.appendChild(b);
    var pinta = function () { b.disabled = !listaReglas(ul, c1.value, c2.value); }; c1.addEventListener("input", pinta); c2.addEventListener("input", pinta); pinta();
    b.addEventListener("click", async function () {
      e.hidden = true;
      if (c1.value !== c2.value) { e.textContent = "Las dos contraseñas no coinciden."; e.hidden = false; return; }
      b.disabled = true;
      try {
        await api({ accion: "cuenta_clave", clave: c1.value }); c1.value = ""; c2.value = "";
        var D2 = abrir("Contraseña guardada"); D2.appendChild(el("p", "okmsg", "Listo. La próxima vez entre con su correo y esta contraseña."));
      } catch (x) { e.textContent = x.mensaje; e.hidden = false; }
      finally { pinta(); }
    });
  }

  // ---------- Lista
  $("recargar").addEventListener("click", cargar);
  async function cargar() {
    error("lErr", "");
    var r = await sb.from("contratos").select("id,numero,asunto,cliente_nombre,cliente_correo,estado,pdf_sha256,firmado_sha256,autorizado_por,autorizado_en,firmantes,creado_en,enviado_en,firmado_en,actualizado_en").order("creado_en", { ascending: false }).limit(200);
    if (r.error) { error("lErr", "No se pudo leer la lista. Si acaba de entrar, cierre sesión y vuelva a entrar."); return; }
    contratos = r.data || []; pintar();
  }
  function varios(c) { return Array.isArray(c.firmantes) && c.firmantes.length > 0; }
  function pintar() {
    var L = $("lista"); L.textContent = "";
    if (!contratos.length) { L.appendChild(el("p", "nota", "Todavía no hay contratos. Registre el primero con el formulario de arriba.")); return; }
    contratos.forEach(function (c) {
      var e = ESTADOS[c.estado] || { t: c.estado, c: "idle" };
      var it = el("div", "item" + (c.estado === "firmado_cliente" ? " atencion" : ""));
      var t = el("div", "t"); t.appendChild(el("b", null, c.asunto)); t.appendChild(el("span", null, c.numero + " · " + c.cliente_nombre + " · " + (varios(c) ? "Firman: " + c.firmantes.map(function (f) { return f.nombre; }).join(" y ") : c.cliente_correo)));
      it.appendChild(t);
      var a = el("div", "acc"); a.appendChild(el("span", "pill " + e.c, e.t));
      var boton = function (txt, cls, fn) { var b = el("button", "btn " + cls, txt); b.type = "button"; b.addEventListener("click", function () { fn(c, b); }); a.appendChild(b); };
      var falta = c.estado === "borrador" && desp.firmante && !c.autorizado_en;
      if (falta) { a.firstChild.textContent = "Falta la autorización de quien firma por el despacho"; a.firstChild.className = "pill warn"; if (desp.soy_firmante) boton("Autorizar y firmar", "", autorizar); }
      else if (c.estado === "borrador") { if (c.autorizado_en) a.firstChild.textContent = "Autorizado, listo para enviar"; boton("Enviar al cliente", "", enviar); }
      if (c.estado === "enviado") { if (varios(c)) boton("Ver avance de firmas", "sec", revisar); boton(varios(c) ? "Enlaces nuevos para quien falta" : "Generar enlace nuevo", "claro", enviar); }
      if (c.estado === "firmado_cliente") boton("Revisar", "sec", revisar);
      if (c.estado === "firmado") { boton("Expediente completo, con evidencias", "", function (c, b) { bajar(c, "firmado", b); }); boton("Copia que recibió el cliente", "claro", function (c, b) { bajar(c, "copia", b); }); }
      boton("Detalle", "claro", detalle);
      it.appendChild(a); L.appendChild(it);
    });
  }

  // ---------- Autorización y firma del despacho
  function hex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (x) { return ("0" + x.toString(16)).slice(-2); }).join(""); }
  function pintarFirma() {
    var z = $("miFirma"); z.textContent = "";
    if (!desp.firmante) return;
    if (!desp.soy_firmante) { z.appendChild(el("p", "nota", "Firma por el despacho: " + desp.firmante + ". Ningún contrato puede enviarse al cliente sin que esa cuenta lo autorice.")); return; }
    z.appendChild(el("p", "nota", "Usted firma por el despacho. Su firma solo se estampa cuando usted autoriza un contrato desde esta cuenta."));
    if (desp.mi_firma) { var i = el("img", "mifirma"); i.alt = "Su firma registrada"; i.src = desp.mi_firma; z.appendChild(i); }
    var l = el("label", null, "Cambiar mi firma (imagen PNG de fondo transparente)"); var f = el("input"); f.type = "file"; f.accept = "image/png"; l.htmlFor = "nuevaFirma"; f.id = "nuevaFirma"; z.appendChild(l); z.appendChild(f);
    f.addEventListener("change", async function () {
      if (!f.files[0]) return; error("eqErr", "");
      try { await api({ accion: "mi_firma_cambiar", png: await aBase64(f.files[0]) }, DESPACHO); desp = await api({ accion: "estado" }, DESPACHO); pintarFirma(); }
      catch (e) { error("eqErr", e.mensaje || "No se pudo guardar la firma."); }
    });
  }
  function sinAcentos(t) { return String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim(); }
  // Busca el nombre en el PDF, de la última hoja hacia atrás, y devuelve dónde está su renglón más bajo (el del bloque de firmas).
  async function ubicarNombre(doc, nombre) {
    var meta = sinAcentos(nombre); if (meta.length < 5) return null;
    for (var n = doc.numPages; n >= 1; n--) {
      var pg = await doc.getPage(n), vp = pg.getViewport({ scale: 1 }), tc = await pg.getTextContent(), lineas = {}, mejor = null;
      tc.items.forEach(function (it) { if (!it.str || !it.str.trim()) return; var q = vp.convertToViewportPoint(it.transform[4], it.transform[5]); var k = Math.round(q[1] / 3); (lineas[k] = lineas[k] || []).push({ x: q[0], w: it.width || 0, y: q[1], s: sinAcentos(it.str) }); });
      Object.keys(lineas).forEach(function (k) {
        var L = lineas[k].filter(function (e) { return e.s; }).sort(function (a, b) { return a.x - b.x; }), texto = "", ini = [];
        L.forEach(function (e) { ini.push(texto.length ? texto.length + 1 : 0); texto += (texto.length ? " " : "") + e.s; });
        var en = texto.indexOf(meta); if (en < 0) return;
        var dentro = L.filter(function (e, m) { return ini[m] < en + meta.length && ini[m] + e.s.length > en; }); if (!dentro.length) return;
        var x0 = dentro[0].x, x1 = dentro[dentro.length - 1].x + dentro[dentro.length - 1].w, y = dentro[0].y;
        if (!mejor || y > mejor.y) mejor = { x: (x0 + x1) / 2, y: y };
      });
      if (mejor) return { pagina: n, x: mejor.x, y: mejor.y, W: vp.width, H: vp.height };
    }
    return null;
  }
  async function autorizar(c, b) {
    b.disabled = true;
    try {
      if (!desp.mi_firma) throw { mensaje: "Su firma todavía no está registrada. Súbala en la sección Equipo y correo." };
      var r = await api({ accion: "equipo_enlace", contrato_id: c.id, cual: "original" });
      var resp = await fetch(r.url, { cache: "no-store" }); if (!resp.ok) throw { mensaje: "No se pudo abrir el PDF." };
      var bytes = new Uint8Array(await resp.arrayBuffer());
      var huella = hex(await crypto.subtle.digest("SHA-256", bytes));
      if (huella !== c.pdf_sha256) throw { mensaje: "El PDF no coincide con el registrado. Actualice la lista e intente de nuevo." };
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = "../pdf.worker.min.js";
      var doc = await window.pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
      var sello = el("img", "sello"); sello.alt = ""; sello.hidden = true;
      await new Promise(function (ok) { sello.onload = ok; sello.onerror = ok; sello.src = desp.mi_firma; });
      var prop = sello.naturalWidth && sello.naturalHeight ? sello.naturalWidth / sello.naturalHeight : 1;
      var hallado = null; try { hallado = await ubicarNombre(doc, desp.mi_nombre); } catch (x) { hallado = null; }
      // Colocación automática: encima de su nombre, con una altura cercana al 8.5% de la hoja.
      var auto = null;
      if (hallado) { var alto = 0.085 * hallado.H, anchoPt = alto * prop; auto = { pagina: hallado.pagina, cx: Math.min(0.95, Math.max(0.05, hallado.x / hallado.W)), cy: Math.min(0.97, Math.max(0.03, (hallado.y - 14 - alto * 0.45) / hallado.H)), ancho: Math.min(0.45, Math.max(0.05, anchoPt / hallado.W)) }; }
      var D = abrir("Autorizar " + c.numero);
      var aviso = el("p", auto ? "okmsg" : "nota", auto ? "Su firma ya está colocada sobre su nombre, en la hoja " + auto.pagina + ". Revise y presione Autorizar y firmar. Si prefiere otro lugar, toque la hoja donde deba ir." : "No encontramos su nombre en el PDF. Elija la hoja de firmas y toque el lugar donde va su firma.");
      D.appendChild(el("p", "nota", c.asunto + " · " + c.cliente_nombre)); D.appendChild(aviso);
      var arriba = el("div", "acc");
      var bf = el("button", "btn", "Autorizar y firmar"); bf.type = "button"; bf.disabled = true; arriba.appendChild(bf);
      var bo = el("button", "btn claro", "Leer el PDF completo"); bo.type = "button"; bo.addEventListener("click", function () { window.open(r.url, "_blank", "noopener"); }); arriba.appendChild(bo);
      D.appendChild(arriba);
      var lr = el("label", "casilla"); var rub = el("input"); rub.type = "checkbox"; rub.checked = doc.numPages > 1; lr.appendChild(rub); lr.appendChild(document.createTextNode(" Rubricar además al margen de las otras hojas (" + Math.max(0, doc.numPages - 1) + ")")); if (doc.numPages > 1) D.appendChild(lr);
      var er = el("p", "err"); er.hidden = true; D.appendChild(er);
      var ctl = el("div", "rej");
      var d1 = el("div"); var l1 = el("label", null, "Hoja donde va la firma"); var sel = el("select"); sel.id = "auHoja"; l1.htmlFor = "auHoja";
      for (var n = 1; n <= doc.numPages; n++) { var o = el("option", null, "Hoja " + n + " de " + doc.numPages); o.value = n; sel.appendChild(o); }
      sel.value = auto ? auto.pagina : doc.numPages; d1.appendChild(l1); d1.appendChild(sel); ctl.appendChild(d1);
      var d2 = el("div"); var l2 = el("label", null, "Tamaño de la firma"); var tam = el("input"); tam.type = "range"; tam.min = "5"; tam.max = "45"; tam.step = "0.5"; tam.value = auto ? String(Math.round(auto.ancho * 200) / 2) : "12"; tam.id = "auTam"; l2.htmlFor = "auTam"; d2.appendChild(l2); d2.appendChild(tam); ctl.appendChild(d2);
      D.appendChild(ctl);
      var marco = el("div", "pliego"); var lienzo = el("canvas"); marco.appendChild(lienzo); marco.appendChild(sello); D.appendChild(marco);
      var pos = null, movida = false, turno = 0;
      function colocar() { bf.disabled = !pos; if (!pos) { sello.hidden = true; return; } sello.hidden = false; sello.style.left = (pos.cx * 100) + "%"; sello.style.top = (pos.cy * 100) + "%"; sello.style.width = tam.value + "%"; }
      async function hoja() {
        var mio = ++turno; pos = auto && !movida && Number(sel.value) === auto.pagina ? { cx: auto.cx, cy: auto.cy } : null; colocar(); bf.disabled = true;
        var pg = await doc.getPage(Number(sel.value)); if (mio !== turno) return;
        var base = pg.getViewport({ scale: 1 }), vp = pg.getViewport({ scale: Math.min(2, 1100 / base.width) });
        lienzo.width = vp.width; lienzo.height = vp.height;
        await pg.render({ canvasContext: lienzo.getContext("2d"), viewport: vp }).promise;
        if (mio === turno) colocar();
      }
      marco.addEventListener("click", function (ev) {
        var q = lienzo.getBoundingClientRect(); if (!q.width) return;
        pos = { cx: Math.min(0.98, Math.max(0.02, (ev.clientX - q.left) / q.width)), cy: Math.min(0.98, Math.max(0.02, (ev.clientY - q.top) / q.height)) }; movida = true;
        aviso.className = "nota"; aviso.textContent = "Firma colocada donde usted tocó. Puede tocar otra vez para moverla."; colocar();
      });
      tam.addEventListener("input", function () { movida = movida || !auto || Math.abs(Number(tam.value) / 100 - auto.ancho) > 0.004; colocar(); }); sel.addEventListener("change", hoja);
      bf.addEventListener("click", async function () {
        bf.disabled = true; er.hidden = true; bf.textContent = "Firmando";
        try {
          var ra = await api({ accion: "autorizar", contrato_id: c.id, pagina: Number(sel.value), cx: pos.cx, cy: pos.cy, ancho: Number(tam.value) / 100, rubricar: rub.checked && doc.numPages > 1, automatica: !!auto && !movida, sha256_visto: huella }, DESPACHO);
          await cargar();
          var D2 = abrir(c.numero + " autorizado");
          D2.appendChild(el("p", "okmsg", "Su firma quedó estampada" + (ra.rubricas ? " y se rubricaron " + ra.rubricas + " hojas más" : "") + ". El contrato está listo para enviarse al cliente. La versión sin firma se conserva en el expediente."));
          var bv = el("button", "btn claro", "Ver el PDF ya firmado por el despacho"); bv.type = "button"; bv.addEventListener("click", function () { bajar(c, "original", bv); }); D2.appendChild(bv);
        } catch (e) { er.textContent = e.mensaje || "No se pudo autorizar."; er.hidden = false; bf.textContent = "Autorizar y firmar"; bf.disabled = !pos; }
      });
      await hoja();
    } catch (e) { error("lErr", e.mensaje || "No se pudo abrir el contrato."); }
    finally { b.disabled = false; }
  }

  // ---------- Nuevo contrato
  function aBase64(archivo) { return new Promise(function (ok, mal) { var f = new FileReader(); f.onload = function () { ok(String(f.result).split(",")[1]); }; f.onerror = mal; f.readAsDataURL(archivo); }); }
  $("nCrear").addEventListener("click", async function () {
    error("nErr", ""); var pdf = $("nPdf").files && $("nPdf").files[0];
    if (!pdf) { error("nErr", "Elija el PDF del contrato."); return; }
    if (pdf.size > 15 * 1024 * 1024) { error("nErr", "El PDF pesa más de 15 MB. Redúzcalo e intente de nuevo."); return; }
    $("nCrear").disabled = true; $("nCrear").textContent = "Registrando";
    try {
      var cuerpo = { accion: "equipo_crear", asunto: $("nAsunto").value, cliente_nombre: $("nNombre").value, cliente_correo: $("nCorreo").value, pdf: await aBase64(pdf) };
      if ($("nVarios").checked) {
        cuerpo.firmantes = Array.prototype.map.call($("nFirmantes").querySelectorAll(".firmante"), function (f) { var i = f.querySelectorAll("input"); return { nombre: i[0].value.trim(), cargo: i[1].value.trim(), correo: i[2].value.trim() }; }).filter(function (f) { return f.nombre || f.correo; });
        if (cuerpo.firmantes.length < 2) throw { mensaje: "Capture al menos dos firmantes, cada uno con su nombre completo y su correo personal." };
      }
      var r = await api(cuerpo);
      ["nAsunto", "nNombre", "nCorreo", "nPdf"].forEach(function (i) { $(i).value = ""; }); $("nVarios").checked = false; modoVarios();
      await cargar();
      var c = contratos.filter(function (x) { return x.id === r.id; })[0]; if (c) detalle(c);
    } catch (e) { error("nErr", e.mensaje); }
    finally { $("nCrear").disabled = false; $("nCrear").textContent = "Registrar contrato"; }
  });

  function filaFirmante() {
    var n = $("nFirmantes").querySelectorAll(".firmante").length + 1, f = el("div", "firmante rej");
    [["Nombre completo del firmante " + n, "text", 120, "name"], ["Cargo o carácter (por ejemplo, Presidente del Consejo)", "text", 80, "organization-title"], ["Correo personal del firmante " + n, "email", 120, "off"]].forEach(function (k, m) { var d = el("div"), id = "nF" + n + "_" + m, l = el("label", null, k[0]); l.htmlFor = id; var i = el("input"); i.id = id; i.type = k[1]; i.maxLength = k[2]; i.autocomplete = k[3]; d.appendChild(l); d.appendChild(i); f.appendChild(d); });
    $("nFirmantes").insertBefore(f, $("nOtro"));
    $("nOtro").hidden = n >= 4;
  }
  function modoVarios() {
    var v = $("nVarios").checked; $("nFirmantes").hidden = !v; $("nCorreoCaja").hidden = v;
    $("nNombreEt").textContent = v ? "Nombre de la empresa o asociación (el cliente)" : "Nombre completo del cliente";
    if (v && !$("nFirmantes").querySelector(".firmante")) { filaFirmante(); filaFirmante(); }
  }
  $("nVarios").addEventListener("change", modoVarios); $("nOtro").addEventListener("click", filaFirmante);

  // ---------- Ventana
  function abrir(titulo) { $("dTitulo").textContent = titulo; $("dCuerpo").textContent = ""; $("velo").hidden = false; return $("dCuerpo"); }
  function cerrar() { $("velo").hidden = true; $("dCuerpo").textContent = ""; }
  $("dCerrar").addEventListener("click", cerrar);
  $("velo").addEventListener("click", function (e) { if (e.target === $("velo") && !$("dCuerpo").querySelector("input,textarea,canvas")) cerrar(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !$("velo").hidden) cerrar(); });

  function correoA(c, asunto, cuerpo) { return "mailto:" + String(c.cliente_correo || c.correo || "").replace(/[^a-zA-Z0-9@._+-]/g, "") + "?subject=" + encodeURIComponent(asunto) + "&body=" + encodeURIComponent(cuerpo); }
  function copiar(texto, boton) { navigator.clipboard.writeText(texto).then(function () { var t = boton.textContent; boton.textContent = "Copiado"; setTimeout(function () { boton.textContent = t; }, 1500); }).catch(function () { /* sin permiso */ }); }

  async function enviar(c, b) {
    b.disabled = true;
    try {
      var r = await api({ accion: "equipo_enviar", contrato_id: c.id });
      var envios = r.envios && r.envios.length ? r.envios : [{ n: 1, nombre: c.cliente_nombre, correo: c.cliente_correo, cargo: null, enlace: r.enlace, codigo: r.codigo, expira: r.expira }];
      // La invitación sale desde el correo del despacho. Si falla, quedan los botones para mandarla a mano.
      var inv = {}, remitente = "";
      try { var ri = await api({ accion: "invitar", contrato_id: c.id, envios: envios.map(function (v) { return { n: v.n, enlace: v.enlace, codigo: v.codigo }; }) }, DESPACHO); remitente = ri.remitente || ""; (ri.envios || []).forEach(function (x) { inv[x.n] = x; }); }
      catch (e) { envios.forEach(function (v) { inv[v.n] = { enviado: false, error: e.mensaje || "No se pudo enviar." }; }); }
      var D = abrir("Enviar " + c.numero);
      D.appendChild(el("p", "nota", "El enlace y el código se muestran una sola vez. Si cierra esta ventana sin enviarlos, genere enlaces nuevos. Los enlaces anteriores de estas personas dejaron de servir." + (envios.length > 1 ? " Cada firmante tiene su propio enlace y su propio código: no los cruce." : "")));
      envios.forEach(function (v) {
        var caja = el("div", "env");
        if (envios.length > 1 || varios(c)) caja.appendChild(el("h3", null, v.nombre + (v.cargo ? ", " + v.cargo : "") + " · " + v.correo));
        var x = inv[v.n] || {};
        caja.appendChild(el("p", x.enviado ? "okmsg" : "err", x.enviado ? "Correo enviado a " + (x.para || v.correo) + " desde " + (remitente || "el correo del despacho") + ", con su enlace y su código." : "El correo automático no salió" + (x.error ? " (" + x.error + ")" : "") + ". Mándelo con los botones de abajo."));
        caja.appendChild(el("label", null, "Enlace personal")); caja.appendChild(el("code", null, v.enlace));
        caja.appendChild(el("label", null, "Código de verificación")); caja.appendChild(el("div", "grande", v.codigo));
        caja.appendChild(el("p", "nota", "Vence el " + fecha(v.expira) + "."));
        var texto = "Estimado(a) " + v.nombre + ":\n\n" + (varios(c) ? "El contrato de " + c.cliente_nombre + " con HALTOR está listo para su firma" + (v.cargo ? " como " + v.cargo : "") + "." : "Su contrato con HALTOR está listo para firma.") + "\n\nAbra este enlace desde su celular:\n" + v.enlace + "\n\nSu código de verificación: " + v.codigo + "\n\nEl proceso le pedirá una fotografía de su identificación oficial por ambos lados y una de su rostro. El enlace es personal, vence en 72 horas y no debe compartirse.\n\n" + (envios.length > 1 || varios(c) ? "El contrato quedará firmado cuando hayan firmado todos los representantes y el despacho revise las identificaciones." : "Cuando firme, el despacho revisará su identificación y le enviará su copia.") + "\n\nHALTOR";
        var acc = el("div", "acc");
        var m = el("a", "btn" + ((inv[v.n] || {}).enviado ? " claro" : ""), (inv[v.n] || {}).enviado ? "Mandarlo también desde mi correo" : "Abrir mi correo con el mensaje listo"); m.href = correoA({ cliente_correo: v.correo }, "Contrato con HALTOR listo para firma", texto); acc.appendChild(m);
        var cp = el("button", "btn claro", "Copiar mensaje"); cp.type = "button"; cp.addEventListener("click", function () { copiar(texto, cp); }); acc.appendChild(cp);
        caja.appendChild(acc); D.appendChild(caja);
      });
      D.appendChild(el("p", "nota", "Si un firmante no encuentra el correo, pídale revisar la carpeta de no deseado. También puede dictarle el código por teléfono o WhatsApp."));
      await cargar();
    } catch (e) { error("lErr", e.mensaje); }
    finally { b.disabled = false; }
  }

  async function bajar(c, cual, b) {
    if (b) b.disabled = true;
    try { var r = await api({ accion: "equipo_enlace", contrato_id: c.id, cual: cual }); window.location.assign(r.url); }
    catch (e) { error("lErr", e.mensaje); }
    finally { if (b) b.disabled = false; }
  }

  function marcas(tipo, a) {
    if (!a) return { t: "Sin análisis automático.", alerta: false };
    var p = [], alerta = !!a.forzada;
    if (a.rostros !== null && a.rostros !== undefined && tipo !== "ine_reverso") { p.push(a.rostros === 0 ? "No se detectó rostro" : a.rostros === 1 ? "Se detectó un rostro" : "Se detectaron " + a.rostros + " rostros"); if (a.rostros !== 1) alerta = true; }
    if (a.nitidez !== null && a.nitidez !== undefined) p.push(a.nitidez < 30 ? "borrosa" : "nítida");
    if (a.luz !== null && a.luz !== undefined) p.push(a.luz < 40 ? "oscura" : a.luz > 238 ? "quemada" : "luz correcta");
    if (tipo === "rostro") p.push(a.origen === "camara" ? "tomada con la cámara en vivo" : "subida como archivo");
    if (a.forzada) p.push("ACEPTADA AL TERCER INTENTO: los filtros la habían rechazado");
    return { t: p.join(" · ") + ".", alerta: alerta };
  }

  // Dónde va la firma de cada firmante: encima de su nombre en el contrato. Si algo falla, el servidor la deja al margen y en la hoja de evidencias.
  async function lugares(c, lista) {
    try {
      var r = await api({ accion: "equipo_enlace", contrato_id: c.id, cual: "original" });
      var resp = await fetch(r.url, { cache: "no-store" }); if (!resp.ok) return [];
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = "../pdf.worker.min.js";
      var doc = await window.pdfjsLib.getDocument({ data: new Uint8Array(await resp.arrayBuffer()) }).promise, out = [];
      for (var i = 0; i < lista.length; i++) {
        var f = lista[i], h = await ubicarNombre(doc, f.nombre || c.cliente_nombre); if (!h) continue;
        var prop = 3; if (f.firma) { var im = new Image(); await new Promise(function (ok) { im.onload = ok; im.onerror = ok; im.src = f.firma; }); if (im.naturalWidth && im.naturalHeight) prop = im.naturalWidth / im.naturalHeight; }
        var ancho = Math.min(0.3, 0.075 * h.H * prop / h.W), alto = ancho * h.W / prop;
        out.push({ n: f.n || 1, pagina: h.pagina, cx: Math.min(0.95, Math.max(0.05, h.x / h.W)), cy: Math.min(0.97, Math.max(0.03, (h.y - 12 - alto * 0.45) / h.H)), ancho: ancho });
      }
      return out;
    } catch (e) { return []; }
  }
  var ESTADO_FIRMANTE = { sin_enlace: "Sin enlace todavía", abierta: "Aún no firma", bloqueada: "Enlace bloqueado por intentos", firmando: "Firmando", en_revision: "Ya firmó, falta su revisión", firmada: "Aprobado", anulada: "Enlace anulado" };
  async function revisar(c, b) {
    b.disabled = true;
    try {
      var r = await api({ accion: "equipo_evidencias", contrato_id: c.id });
      var lista = r.firmantes && r.firmantes.length ? r.firmantes : [r];
      var todos = lista.every(function (f) { return f.estado_sesion === "en_revision"; }) && r.estado_contrato === "firmado_cliente";
      var D = abrir((todos ? "Revisar " : "Avance de ") + c.numero);
      D.appendChild(el("p", "nota", "Compruebe que cada identificación sea legible y vigente, que el rostro corresponda a la fotografía de la identificación y que el nombre coincida con el del contrato. Nada queda firmado hasta que usted lo apruebe." + (lista.length > 1 ? " El contrato se aprueba una sola vez, cuando ya firmaron todos." : "")));
      var aviso = function (correo, asunto, cuerpo, nota) {
        var D2 = abrir(c.numero); D2.appendChild(el("p", "okmsg", nota));
        var m = el("a", "btn", "Abrir mi correo para avisar"); m.href = correoA({ cliente_correo: correo }, asunto, cuerpo); D2.appendChild(m);
        return D2;
      };
      var botones = [];
      lista.forEach(function (f) {
        var caja = el("div", "firmante-rev");
        if (lista.length > 1 || r.varios) caja.appendChild(el("h3", null, (f.nombre || r.cliente_nombre) + (f.cargo ? ", " + f.cargo : "") + " · " + (ESTADO_FIRMANTE[f.estado_sesion] || f.estado_sesion)));
        if (f.estado_sesion !== "en_revision" && f.estado_sesion !== "firmada") { caja.appendChild(el("p", "nota", "Todavía no hay evidencias que revisar de esta persona." + (f.rechazo_motivo ? " Se le pidió repetir: " + f.rechazo_motivo : ""))); D.appendChild(caja); return; }
        var dl = el("dl", "datos");
        [["Nombre en el contrato", f.nombre || r.cliente_nombre], ["Nombre que escribió al firmar", f.nombre_tecleado], ["Código verificado", fecha(f.verificado_en)], ["Contrato mostrado", fecha(f.mostrado_en)], ["Lectura confirmada", fecha(f.lectura_en)], ["Firmó", fecha(f.cliente_firmo_en)], ["Dirección de internet", f.ip], ["Dispositivo", f.agente]]
          .forEach(function (x) { dl.appendChild(el("dt", null, x[0])); dl.appendChild(el("dd", null, x[1] || "sin dato")); });
        caja.appendChild(dl);
        var F = el("div", "fotos");
        [["ine_frente", "Identificación, frente"], ["ine_reverso", "Identificación, reverso"], ["rostro", "Fotografía del rostro"], ["firma", "Firma trazada"]].forEach(function (k) {
          var d = el("div", "foto"); d.appendChild(el("b", null, k[1]));
          if (f[k[0]] && /^https:\/\/khkzwhsbhfydcshzggos\.supabase\.co\//.test(f[k[0]])) { var im = el("img"); im.alt = k[1]; im.src = f[k[0]]; d.appendChild(im); } else d.appendChild(el("small", "alerta", "Falta esta imagen."));
          if (k[0] !== "firma") { var m = marcas(k[0], (f.auto || {})[k[0]]); d.appendChild(el("small", m.alerta ? "alerta" : null, m.t)); }
          F.appendChild(d);
        });
        caja.appendChild(F);
        if (f.estado_sesion === "en_revision") {
          var R = el("div"); R.appendChild(el("h3", null, lista.length > 1 ? "Pedir a " + String(f.nombre).split(" ")[0] + " que repita" : "Pedir que repita"));
          var ch = el("div", "checks"), casillas = {}, sufijo = "-" + (f.n || 1);
          [["ine_frente", "Frente"], ["ine_reverso", "Reverso"], ["rostro", "Rostro"], ["firma", "Firma"]].forEach(function (k) { var l = el("label"); var i = el("input"); i.type = "checkbox"; i.id = "rz-" + k[0] + sufijo; casillas[k[0]] = i; l.appendChild(i); l.appendChild(document.createTextNode(k[1])); ch.appendChild(l); });
          R.appendChild(ch); var lm = el("label", null, "Motivo (el firmante lo leerá)"); lm.htmlFor = "rzMotivo" + sufijo; R.appendChild(lm);
          var mot = el("textarea"); mot.id = "rzMotivo" + sufijo; mot.maxLength = 300; R.appendChild(mot);
          var br = el("button", "btn rojo", "Rechazar y pedir repetición"); br.type = "button"; R.appendChild(br); var er = el("p", "err"); er.hidden = true; R.appendChild(er);
          botones.push(br);
          br.addEventListener("click", async function () {
            var campos = Object.keys(casillas).filter(function (k) { return casillas[k].checked; });
            botones.forEach(function (x) { x.disabled = true; });
            try {
              await api({ accion: "equipo_rechazar", contrato_id: c.id, firmante: f.n || 1, campos: campos, motivo: mot.value }); await cargar();
              aviso(f.correo || c.cliente_correo, "Necesitamos que repita un paso de su firma", "Estimado(a) " + (f.nombre || c.cliente_nombre) + ":\n\nAl revisar su firma encontramos lo siguiente: " + mot.value.trim() + "\n\nPor favor abra de nuevo el mismo enlace que le enviamos, escriba el mismo código y repita el paso que se le indica. Tiene 72 horas.\n\nHALTOR", "Se pidió a " + (f.nombre || "el cliente") + " repetir. El contrato volvió a \"Enviado al cliente\".");
            } catch (e) { er.textContent = e.mensaje; er.hidden = false; botones.forEach(function (x) { x.disabled = false; }); }
          });
          caja.appendChild(R);
        }
        D.appendChild(caja);
      });
      var A = el("div", "firmante-rev"); A.appendChild(el("h3", null, "Aprobar"));
      A.appendChild(el("p", "nota", todos ? "Cierra el contrato con su nombre como revisor" + (lista.length > 1 ? ", con las evidencias de todos los firmantes" : "") + ". No se puede deshacer." : "Se podrá aprobar cuando hayan firmado todos los firmantes."));
      var sinL = el("label", "nota"), sinC = document.createElement("input"); sinC.type = "checkbox"; sinL.appendChild(sinC); sinL.appendChild(document.createTextNode(" No enviar todavía el correo al cliente: quiero revisar primero su copia.")); sinL.style.display = "block"; A.appendChild(sinL);
      var ba = el("button", "btn", "Aprobar y cerrar el contrato"); ba.type = "button"; ba.disabled = !todos; A.appendChild(ba); var ea = el("p", "err"); ea.hidden = true; A.appendChild(ea);
      D.appendChild(A); botones.push(ba);
      ba.addEventListener("click", async function () {
        botones.forEach(function (x) { x.disabled = true; }); ba.textContent = "Cerrando el contrato";
        try {
          var col = await lugares(c, lista); var ra = await api({ accion: "equipo_aprobar", contrato_id: c.id, colocacion: col, sin_correo: sinC.checked }); await cargar();
          var nota = col.length === lista.length ? "Cada firma quedó estampada sobre el nombre de su firmante y al margen de las demás hojas." : "No se encontró en el PDF el nombre de " + (lista.length - col.length) + " firmante(s): su firma quedó al margen de las hojas y en la constancia de firma.";
          if (sinC.checked) {
            var D4 = abrir(c.numero);
            D4.appendChild(el("p", "okmsg", "Contrato aprobado y cerrado. El correo al cliente todavía no se ha enviado.")); D4.appendChild(el("p", "nota", nota));
            D4.appendChild(el("p", "nota", "Descargue la copia del cliente y revísela. Cuando esté conforme, envíe el correo con el botón de abajo. También puede enviarlo después desde el detalle del contrato, con \"Reenviar correo al cliente y al equipo\"."));
            var b1 = el("button", "btn claro", "Descargar la copia del cliente"); b1.type = "button"; b1.addEventListener("click", function () { bajar(c, "copia", b1); }); D4.appendChild(b1);
            var b2 = el("button", "btn claro", "Descargar el expediente completo"); b2.type = "button"; b2.addEventListener("click", function () { bajar(c, "firmado", b2); }); D4.appendChild(document.createTextNode(" ")); D4.appendChild(b2);
            var b3 = el("button", "btn", "Enviar el correo al cliente y al equipo"); b3.type = "button"; D4.appendChild(document.createTextNode(" ")); D4.appendChild(b3);
            b3.addEventListener("click", async function () {
              b3.disabled = true; b3.textContent = "Enviando";
              try { var r3 = await api({ accion: "equipo_reenviar_correo", contrato_id: c.id }); b3.textContent = r3.correo && r3.correo.enviado ? "Correo enviado a " + r3.correo.para : "No salió: " + ((r3.correo && r3.correo.error) || "error"); if (!(r3.correo && r3.correo.enviado)) b3.disabled = false; }
              catch (x) { b3.textContent = x.mensaje; b3.disabled = false; }
            });
            return;
          }
          if (ra.correo && ra.correo.enviado) {
            var D3 = abrir(c.numero);
            D3.appendChild(el("p", "okmsg", "Contrato aprobado y cerrado.")); D3.appendChild(el("p", "nota", nota));
            D3.appendChild(el("p", "nota", "Se envió a " + ra.correo.para + (ra.correo.completa === false ? " el contrato firmado con la constancia de firma de cada firmante, sin fotografías, con su huella y con copia a: " : " el contrato firmado con la huella, con copia a: ") + (ra.correo.cc || []).join(", ") + " y a la cuenta del despacho."));
            var bx = el("button", "btn claro", "Descargar el expediente completo"); bx.type = "button"; bx.addEventListener("click", function () { bajar(c, "firmado", bx); }); D3.appendChild(bx);
            var by = el("button", "btn claro", "Descargar la copia del cliente"); by.type = "button"; by.addEventListener("click", function () { bajar(c, "copia", by); }); D3.appendChild(document.createTextNode(" ")); D3.appendChild(by);
            return;
          }
          var D2 = aviso(lista.map(function (f) { return f.correo || c.cliente_correo; }).join(","), "Su contrato con HALTOR quedó firmado", "Estimado(a) " + lista.map(function (f) { return f.nombre || c.cliente_nombre; }).join(" y ") + ":\n\nRevisamos su identificación y su firma, y el contrato quedó aceptado.\n\nPara descargar su copia, abra el mismo enlace que le enviamos y escriba el mismo código de verificación. Podrá hacerlo durante los próximos 30 días.\n\nHALTOR", "Contrato aprobado y cerrado. El correo automático no salió" + (ra.correo && ra.correo.error ? " (" + ra.correo.error + ")" : "") + ". Avise desde su correo y adjunte el PDF.");
          var bd = el("button", "btn claro", "Descargar el contrato firmado"); bd.type = "button"; bd.addEventListener("click", function () { bajar(c, "firmado", bd); }); D2.appendChild(document.createTextNode(" ")); D2.appendChild(bd);
        } catch (e) { ea.textContent = e.mensaje; ea.hidden = false; botones.forEach(function (x) { x.disabled = false; }); ba.disabled = !todos; ba.textContent = "Aprobar y cerrar el contrato"; }
      });
    } catch (e) { error("lErr", e.mensaje); }
    finally { b.disabled = false; }
  }

  async function detalle(c) {
    var e = ESTADOS[c.estado] || { t: c.estado, c: "idle" };
    var D = abrir(c.numero);
    var dl = el("dl", "datos");
    [["Asunto", c.asunto], ["Cliente", c.cliente_nombre], ["Correo", c.cliente_correo], ["Estado", e.t], ["Registrado", fecha(c.creado_en)], ["Enviado", fecha(c.enviado_en)], ["Cerrado", fecha(c.firmado_en)], ["Huella del PDF original", c.pdf_sha256], ["Huella del PDF firmado", c.firmado_sha256]]
      .forEach(function (f) { if (f[1]) { dl.appendChild(el("dt", null, f[0])); dl.appendChild(el("dd", null, f[1])); } });
    D.appendChild(dl);
    var acc = el("div", "acc");
    var bo = el("button", "btn claro", "Descargar PDF original"); bo.type = "button"; bo.addEventListener("click", function () { bajar(c, "original", bo); }); acc.appendChild(bo);
    if (c.estado === "firmado") {
      var bf = el("button", "btn", "Descargar el expediente completo"); bf.type = "button"; bf.addEventListener("click", function () { bajar(c, "firmado", bf); }); acc.appendChild(bf);
      var bm = el("button", "btn claro", "Reenviar correo al cliente y al equipo"); bm.type = "button";
      bm.addEventListener("click", async function () {
        bm.disabled = true;
        try { var rr = await api({ accion: "equipo_reenviar_correo", contrato_id: c.id }); bm.textContent = rr.correo && rr.correo.enviado ? "Correo enviado" : "No salió: " + ((rr.correo && rr.correo.error) || "error"); }
        catch (x) { bm.textContent = x.mensaje; }
      });
      acc.appendChild(bm);
    }
    if (c.estado !== "firmado" && c.estado !== "cancelado") {
      var bc = el("button", "btn rojo", "Cancelar contrato"); bc.type = "button"; var paso = 0;
      bc.addEventListener("click", async function () {
        if (!paso) { paso = 1; bc.textContent = "Confirmar cancelación (no se puede deshacer)"; return; }
        bc.disabled = true;
        try { await api({ accion: "equipo_cancelar", contrato_id: c.id, motivo: "Cancelado desde la app del despacho" }); await cargar(); cerrar(); }
        catch (x) { bc.disabled = false; bc.textContent = x.mensaje; }
      });
      acc.appendChild(bc);
    }
    D.appendChild(acc);
    D.appendChild(el("h3", null, "Movimientos"));
    var ul = el("ul", "log"); D.appendChild(ul);
    var r = await sb.from("eventos").select("id,tipo,actor,creado_en").eq("contrato_id", c.id).order("id", { ascending: false }).limit(200);
    if (r.error) { ul.appendChild(el("li", null, "No se pudieron leer los movimientos.")); return; }
    (r.data || []).forEach(function (v) { var li = el("li"); li.appendChild(el("time", null, fecha(v.creado_en))); li.appendChild(el("span", null, humano(v.tipo) + (v.actor ? " (" + v.actor + ")" : ""))); ul.appendChild(li); });
  }

  // Arranque: si hay sesión, se pide o se confirma el segundo paso.
  var arrancado = false;
  function arrancar(sesion) {
    if (arrancado) return; arrancado = true;
    if (location.hash && /access_token|error/.test(location.hash)) { try { history.replaceState(null, "", location.pathname); } catch (e) { /* sin historial */ } }
    if (sesion) segundoPaso(); else ver("vAcceso");
  }
  if (/error_description=([^&]+)/.test(location.hash)) error("accesoErr", "El enlace de acceso ya se usó o venció. Pida uno nuevo.");
  sb.auth.onAuthStateChange(function (evento, sesion) { if (evento === "SIGNED_IN" && sesion) setTimeout(function () { arrancar(sesion); }, 0); });
  sb.auth.getSession().then(function (r) { arrancar(r.data && r.data.session); });
})();

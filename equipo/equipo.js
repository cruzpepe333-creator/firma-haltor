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
  function ver(id) { ["vAcceso", "vDos", "vPanel"].forEach(function (v) { $(v).hidden = v !== id; }); }
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

  async function abrirPanel() {
    var u = (await sb.auth.getUser()).data.user;
    $("quienCorreo").textContent = u ? u.email : ""; $("quien").hidden = false;
    ver("vPanel");
    try { desp = await api({ accion: "estado" }, DESPACHO); } catch (e) { desp = { firmante: "", soy_firmante: false, mi_firma: null }; }
    await cargar(); cargarEquipo(); pintarFirma();
    if (llegoPorEnlace) { llegoPorEnlace = false; ventanaClave(true); }
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
    var e = el("p", "err"); e.hidden = true; D.appendChild(e);
    var b = el("button", "btn", "Guardar contraseña"); b.type = "button"; D.appendChild(b);
    b.addEventListener("click", async function () {
      e.hidden = true;
      if (c1.value !== c2.value) { e.textContent = "Las dos contraseñas no coinciden."; e.hidden = false; return; }
      b.disabled = true;
      try {
        await api({ accion: "cuenta_clave", clave: c1.value }); c1.value = ""; c2.value = "";
        var D2 = abrir("Contraseña guardada"); D2.appendChild(el("p", "okmsg", "Listo. La próxima vez entre con su correo y esta contraseña."));
      } catch (x) { e.textContent = x.mensaje; e.hidden = false; }
      finally { b.disabled = false; }
    });
  }

  // ---------- Lista
  $("recargar").addEventListener("click", cargar);
  async function cargar() {
    error("lErr", "");
    var r = await sb.from("contratos").select("id,numero,asunto,cliente_nombre,cliente_correo,estado,pdf_sha256,firmado_sha256,autorizado_por,autorizado_en,creado_en,enviado_en,firmado_en,actualizado_en").order("creado_en", { ascending: false }).limit(200);
    if (r.error) { error("lErr", "No se pudo leer la lista. Si acaba de entrar, cierre sesión y vuelva a entrar."); return; }
    contratos = r.data || []; pintar();
  }
  function pintar() {
    var L = $("lista"); L.textContent = "";
    if (!contratos.length) { L.appendChild(el("p", "nota", "Todavía no hay contratos. Registre el primero con el formulario de arriba.")); return; }
    contratos.forEach(function (c) {
      var e = ESTADOS[c.estado] || { t: c.estado, c: "idle" };
      var it = el("div", "item" + (c.estado === "firmado_cliente" ? " atencion" : ""));
      var t = el("div", "t"); t.appendChild(el("b", null, c.asunto)); t.appendChild(el("span", null, c.numero + " · " + c.cliente_nombre + " · " + c.cliente_correo));
      it.appendChild(t);
      var a = el("div", "acc"); a.appendChild(el("span", "pill " + e.c, e.t));
      var boton = function (txt, cls, fn) { var b = el("button", "btn " + cls, txt); b.type = "button"; b.addEventListener("click", function () { fn(c, b); }); a.appendChild(b); };
      var falta = c.estado === "borrador" && desp.firmante && !c.autorizado_en;
      if (falta) { a.firstChild.textContent = "Falta la autorización de quien firma por el despacho"; a.firstChild.className = "pill warn"; if (desp.soy_firmante) boton("Autorizar y firmar", "", autorizar); }
      else if (c.estado === "borrador") { if (c.autorizado_en) a.firstChild.textContent = "Autorizado, listo para enviar"; boton("Enviar al cliente", "", enviar); }
      if (c.estado === "enviado") boton("Generar enlace nuevo", "claro", enviar);
      if (c.estado === "firmado_cliente") boton("Revisar", "sec", revisar);
      if (c.estado === "firmado") boton("Descargar firmado", "", function (c, b) { bajar(c, "firmado", b); });
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
      var D = abrir("Autorizar " + c.numero);
      D.appendChild(el("p", "nota", c.asunto + " · " + c.cliente_nombre + ". Lea el contrato completo. Después elija la hoja de firmas y toque el lugar exacto donde va su firma. Al autorizar, el PDF queda fijo y ya puede enviarse al cliente."));
      var bo = el("button", "btn claro", "Abrir el PDF completo para leerlo"); bo.type = "button"; bo.addEventListener("click", function () { window.open(r.url, "_blank", "noopener"); }); D.appendChild(bo);
      var ctl = el("div", "rej");
      var d1 = el("div"); var l1 = el("label", null, "Hoja donde va la firma"); var sel = el("select"); sel.id = "auHoja"; l1.htmlFor = "auHoja";
      for (var n = 1; n <= doc.numPages; n++) { var o = el("option", null, "Hoja " + n + " de " + doc.numPages); o.value = n; sel.appendChild(o); }
      sel.value = doc.numPages; d1.appendChild(l1); d1.appendChild(sel); ctl.appendChild(d1);
      var d2 = el("div"); var l2 = el("label", null, "Tamaño de la firma"); var tam = el("input"); tam.type = "range"; tam.min = "8"; tam.max = "45"; tam.value = "22"; tam.id = "auTam"; l2.htmlFor = "auTam"; d2.appendChild(l2); d2.appendChild(tam); ctl.appendChild(d2);
      D.appendChild(ctl);
      var marco = el("div", "pliego"); var lienzo = el("canvas"); var sello = el("img", "sello"); sello.alt = ""; sello.src = desp.mi_firma; sello.hidden = true; marco.appendChild(lienzo); marco.appendChild(sello); D.appendChild(marco);
      var pos = null, turno = 0;
      function colocar() { if (!pos) { sello.hidden = true; return; } sello.hidden = false; sello.style.left = (pos.cx * 100) + "%"; sello.style.top = (pos.cy * 100) + "%"; sello.style.width = tam.value + "%"; }
      async function hoja() {
        var mio = ++turno; pos = null; colocar(); bf.disabled = true;
        var pg = await doc.getPage(Number(sel.value)); if (mio !== turno) return;
        var base = pg.getViewport({ scale: 1 }), vp = pg.getViewport({ scale: Math.min(2, 1100 / base.width) });
        lienzo.width = vp.width; lienzo.height = vp.height;
        await pg.render({ canvasContext: lienzo.getContext("2d"), viewport: vp }).promise;
      }
      marco.addEventListener("click", function (ev) {
        var q = lienzo.getBoundingClientRect(); if (!q.width) return;
        pos = { cx: Math.min(0.98, Math.max(0.02, (ev.clientX - q.left) / q.width)), cy: Math.min(0.98, Math.max(0.02, (ev.clientY - q.top) / q.height)) };
        colocar(); bf.disabled = !si.checked;
      });
      tam.addEventListener("input", colocar); sel.addEventListener("change", hoja);
      var lc = el("label", "casilla"); var si = el("input"); si.type = "checkbox"; lc.appendChild(si); lc.appendChild(document.createTextNode(" Leí el contrato completo y autorizo que se estampe mi firma en el lugar marcado."));
      D.appendChild(lc);
      var er = el("p", "err"); er.hidden = true; D.appendChild(er);
      var bf = el("button", "btn", "Autorizar y firmar"); bf.type = "button"; bf.disabled = true; D.appendChild(bf);
      si.addEventListener("change", function () { bf.disabled = !(si.checked && pos); });
      bf.addEventListener("click", async function () {
        bf.disabled = true; er.hidden = true;
        try {
          await api({ accion: "autorizar", contrato_id: c.id, pagina: Number(sel.value), cx: pos.cx, cy: pos.cy, ancho: Number(tam.value) / 100, sha256_visto: huella }, DESPACHO);
          await cargar();
          var D2 = abrir(c.numero + " autorizado");
          D2.appendChild(el("p", "okmsg", "Su firma quedó estampada y el contrato está listo para enviarse al cliente. La versión sin firma se conserva en el expediente."));
          var bv = el("button", "btn claro", "Ver el PDF ya firmado por el despacho"); bv.type = "button"; bv.addEventListener("click", function () { bajar(c, "original", bv); }); D2.appendChild(bv);
        } catch (e) { er.textContent = e.mensaje || "No se pudo autorizar."; er.hidden = false; bf.disabled = false; }
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
      var r = await api({ accion: "equipo_crear", asunto: $("nAsunto").value, cliente_nombre: $("nNombre").value, cliente_correo: $("nCorreo").value, pdf: await aBase64(pdf) });
      ["nAsunto", "nNombre", "nCorreo", "nPdf"].forEach(function (i) { $(i).value = ""; });
      await cargar();
      var c = contratos.filter(function (x) { return x.id === r.id; })[0]; if (c) detalle(c);
    } catch (e) { error("nErr", e.mensaje); }
    finally { $("nCrear").disabled = false; $("nCrear").textContent = "Registrar contrato"; }
  });

  // ---------- Ventana
  function abrir(titulo) { $("dTitulo").textContent = titulo; $("dCuerpo").textContent = ""; $("velo").hidden = false; return $("dCuerpo"); }
  function cerrar() { $("velo").hidden = true; $("dCuerpo").textContent = ""; }
  $("dCerrar").addEventListener("click", cerrar);
  $("velo").addEventListener("click", function (e) { if (e.target === $("velo")) cerrar(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !$("velo").hidden) cerrar(); });

  function correoA(c, asunto, cuerpo) { return "mailto:" + c.cliente_correo.replace(/[^a-zA-Z0-9@._+-]/g, "") + "?subject=" + encodeURIComponent(asunto) + "&body=" + encodeURIComponent(cuerpo); }
  function copiar(texto, boton) { navigator.clipboard.writeText(texto).then(function () { var t = boton.textContent; boton.textContent = "Copiado"; setTimeout(function () { boton.textContent = t; }, 1500); }).catch(function () { /* sin permiso */ }); }

  async function enviar(c, b) {
    b.disabled = true;
    try {
      var r = await api({ accion: "equipo_enviar", contrato_id: c.id });
      var D = abrir("Enviar " + c.numero);
      D.appendChild(el("p", "nota", "El enlace y el código se muestran una sola vez. Si cierra esta ventana sin enviarlos, genere un enlace nuevo. Cualquier enlace anterior de este contrato dejó de servir."));
      var caja = el("div", "env");
      caja.appendChild(el("label", null, "Enlace personal del cliente")); var cl = el("code", null, r.enlace); caja.appendChild(cl);
      caja.appendChild(el("label", null, "Código de verificación")); caja.appendChild(el("div", "grande", r.codigo));
      caja.appendChild(el("p", "nota", "Vence el " + fecha(r.expira) + "."));
      D.appendChild(caja);
      var texto = "Estimado(a) " + c.cliente_nombre + ":\n\nSu contrato con HALTOR está listo para firma.\n\nAbra este enlace desde su celular:\n" + r.enlace + "\n\nSu código de verificación: " + r.codigo + "\n\nEl proceso le pedirá una fotografía de su identificación oficial por ambos lados y una de su rostro. El enlace es personal, vence en 72 horas y no debe compartirse.\n\nCuando firme, el despacho revisará su identificación y le avisará para que descargue su copia.\n\nHALTOR";
      var acc = el("div", "acc");
      var m = el("a", "btn", "Abrir mi correo con el mensaje listo"); m.href = correoA(c, "Su contrato con HALTOR está listo para firma", texto); acc.appendChild(m);
      var cp = el("button", "btn claro", "Copiar mensaje"); cp.type = "button"; cp.addEventListener("click", function () { copiar(texto, cp); }); acc.appendChild(cp);
      D.appendChild(acc);
      D.appendChild(el("p", "nota", "Para más seguridad puede mandar el enlace por correo y el código por otro medio, por ejemplo WhatsApp."));
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

  async function revisar(c, b) {
    b.disabled = true;
    try {
      var r = await api({ accion: "equipo_evidencias", contrato_id: c.id });
      var D = abrir("Revisar " + c.numero);
      D.appendChild(el("p", "nota", "Compruebe que la identificación sea legible y vigente, que el rostro corresponda a la fotografía de la identificación y que el nombre coincida con el del contrato. Nada queda firmado hasta que usted lo apruebe."));
      var dl = el("dl", "datos");
      [["Cliente en el contrato", r.cliente_nombre], ["Nombre que escribió al firmar", r.nombre_tecleado], ["Código verificado", fecha(r.verificado_en)], ["Contrato mostrado", fecha(r.mostrado_en)], ["Lectura confirmada", fecha(r.lectura_en)], ["Firmó", fecha(r.cliente_firmo_en)], ["Dirección de internet", r.ip], ["Dispositivo", r.agente]]
        .forEach(function (f) { dl.appendChild(el("dt", null, f[0])); dl.appendChild(el("dd", null, f[1] || "sin dato")); });
      D.appendChild(dl);
      var F = el("div", "fotos");
      [["ine_frente", "Identificación, frente"], ["ine_reverso", "Identificación, reverso"], ["rostro", "Fotografía del rostro"], ["firma", "Firma trazada"]].forEach(function (k) {
        var f = el("div", "foto"); f.appendChild(el("b", null, k[1]));
        if (r[k[0]] && /^https:\/\/khkzwhsbhfydcshzggos\.supabase\.co\//.test(r[k[0]])) { var im = el("img"); im.alt = k[1]; im.src = r[k[0]]; f.appendChild(im); } else f.appendChild(el("small", "alerta", "Falta esta imagen."));
        if (k[0] !== "firma") { var m = marcas(k[0], (r.auto || {})[k[0]]); f.appendChild(el("small", m.alerta ? "alerta" : null, m.t)); }
        F.appendChild(f);
      });
      D.appendChild(F);
      var dos = el("div", "dos");
      var A = el("div"); A.appendChild(el("h3", null, "Aprobar")); A.appendChild(el("p", "nota", "Cierra el contrato con su nombre como revisor. No se puede deshacer."));
      var ba = el("button", "btn", "Aprobar y cerrar el contrato"); ba.type = "button"; A.appendChild(ba); var ea = el("p", "err"); ea.hidden = true; A.appendChild(ea);
      var R = el("div"); R.appendChild(el("h3", null, "Pedir que repita"));
      var ch = el("div", "checks"), casillas = {};
      [["ine_frente", "Frente"], ["ine_reverso", "Reverso"], ["rostro", "Rostro"], ["firma", "Firma"]].forEach(function (k) { var l = el("label"); var i = el("input"); i.type = "checkbox"; i.id = "rz-" + k[0]; casillas[k[0]] = i; l.appendChild(i); l.appendChild(document.createTextNode(k[1])); ch.appendChild(l); });
      R.appendChild(ch); var lm = el("label", null, "Motivo (el cliente lo leerá)"); lm.htmlFor = "rzMotivo"; R.appendChild(lm);
      var mot = el("textarea"); mot.id = "rzMotivo"; mot.maxLength = 300; R.appendChild(mot);
      var br = el("button", "btn rojo", "Rechazar y pedir repetición"); br.type = "button"; R.appendChild(br); var er = el("p", "err"); er.hidden = true; R.appendChild(er);
      dos.appendChild(A); dos.appendChild(R); D.appendChild(dos);

      var aviso = function (asunto, cuerpo, nota) {
        var D2 = abrir(c.numero); D2.appendChild(el("p", "okmsg", nota));
        var m = el("a", "btn", "Abrir mi correo para avisar al cliente"); m.href = correoA(c, asunto, cuerpo); D2.appendChild(m);
        return D2;
      };
      ba.addEventListener("click", async function () {
        ba.disabled = true; br.disabled = true; ba.textContent = "Cerrando el contrato";
        try {
          var ra = await api({ accion: "equipo_aprobar", contrato_id: c.id }); await cargar();
          var enviado = ra.correo && ra.correo.enviado;
          if (enviado) {
            var D3 = abrir(c.numero);
            D3.appendChild(el("p", "okmsg", "Contrato aprobado y cerrado."));
            D3.appendChild(el("p", "nota", "Se envió al cliente (" + ra.correo.para + ") su contrato firmado con la huella, con copia a: " + (ra.correo.cc || []).join(", ") + " y a la cuenta del despacho."));
            var bx = el("button", "btn claro", "Descargar el contrato firmado"); bx.type = "button"; bx.addEventListener("click", function () { bajar(c, "firmado", bx); }); D3.appendChild(bx);
            return;
          }
          var D2 = aviso("Su contrato con HALTOR quedó firmado", "Estimado(a) " + c.cliente_nombre + ":\n\nRevisamos su identificación y su firma, y su contrato quedó aceptado.\n\nPara descargar su copia, abra el mismo enlace que le enviamos y escriba el mismo código de verificación. Podrá hacerlo durante los próximos 30 días.\n\nHALTOR", "Contrato aprobado y cerrado. El correo automático no salió" + (ra.correo && ra.correo.error ? " (" + ra.correo.error + ")" : "") + ". Avise al cliente desde su correo y adjunte el PDF.");
          var bd = el("button", "btn claro", "Descargar el contrato firmado"); bd.type = "button"; bd.addEventListener("click", function () { bajar(c, "firmado", bd); }); D2.appendChild(document.createTextNode(" ")); D2.appendChild(bd);
        } catch (e) { ea.textContent = e.mensaje; ea.hidden = false; ba.disabled = false; br.disabled = false; ba.textContent = "Aprobar y cerrar el contrato"; }
      });
      br.addEventListener("click", async function () {
        var campos = Object.keys(casillas).filter(function (k) { return casillas[k].checked; });
        br.disabled = true; ba.disabled = true;
        try {
          await api({ accion: "equipo_rechazar", contrato_id: c.id, campos: campos, motivo: mot.value }); await cargar();
          aviso("Necesitamos que repita un paso de su firma", "Estimado(a) " + c.cliente_nombre + ":\n\nAl revisar su firma encontramos lo siguiente: " + mot.value.trim() + "\n\nPor favor abra de nuevo el mismo enlace que le enviamos, escriba el mismo código y repita el paso que se le indica. Tiene 72 horas.\n\nHALTOR", "Se pidió al cliente repetir. El contrato volvió a \"Enviado al cliente\".");
        } catch (e) { er.textContent = e.mensaje; er.hidden = false; br.disabled = false; ba.disabled = false; }
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
      var bf = el("button", "btn", "Descargar PDF firmado"); bf.type = "button"; bf.addEventListener("click", function () { bajar(c, "firmado", bf); }); acc.appendChild(bf);
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

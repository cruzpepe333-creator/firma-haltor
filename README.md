# Firma digital HALTOR

Página que ve el cliente para firmar su contrato. No contiene datos, contraseñas ni llaves: todo lo sensible vive en el servidor privado del despacho.

- `index.html`, `app.js`, `estilos.css`, `extra.css`: la página.
- `pdf.min.js`, `pdf.worker.min.js`: visor de PDF (pdf.js 3.11.174, licencia Apache 2.0, ver `LICENSE-pdfjs.txt`).

Cada cliente recibe un enlace personal de un solo uso. Sin ese enlace la página no muestra nada.

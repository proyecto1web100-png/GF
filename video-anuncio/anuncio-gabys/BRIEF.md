---
workflow: product-launch-video
flow: automation
storyboard: yes
message: "La tienda completa de Gaby's Fashion ahora cabe en tu telefono"
destination: reels-tiktok-estados
aspect: 1080x1920
language: es
audience: "Clientas y clientes de Gaby's Fashion en Honduras, 25-55, compran por WhatsApp y descubren por Instagram"
length: 45s
angle: "Lanzamiento estilo Apple: el producto es el sitio; cada funcion se presenta mostrando la pantalla real, sin adornos"
---

## Intent

Anuncio de lanzamiento de la nueva web de Gaby's Fashion, boutique en Honduras.
Arranca con una animacion principal que presenta el sitio y su fachada intuitiva,
y sigue con tres bloques cortos que muestran como funciona, **siempre usando la
web real como ejemplo en pantalla**.

Estilo Apple en el sentido estricto: fondo oscuro, mucho aire, una idea por
pantalla, tipografia grande y serena, y sobre todo **animaciones suaves y
transiciones smooth** — nada de cortes secos ni rebotes. El ritmo lo marcan los
movimientos de camara sobre la propia interfaz, no los efectos.

Los tres bloques, en este orden:

1. **Catalogo online y carrito** — buscar, filtrar, agregar al carrito.
2. **Cuentas de usuario** — entrar, ver saldo pendiente y compras pasadas.
3. **Ofertas y redes** — el boton de Ofertas con su cascada, y los enlaces a redes.

## Assets

- Script Principal/web_temp/index.html — la tienda; fuente de todas las capturas del sitio.
- Script Principal/web_temp/gf-panel-7x9k2m.html — panel admin; NO aparece en el video.

## Customizations

- Presentar el sitio con sus propias pantallas capturadas: los screenshots reales
  son el material protagonista, no ilustraciones inventadas.
- Capturar en viewport movil (375px) — el video es vertical y asi coincide con
  como la clienta abre la web.
- Transiciones entre bloques por movimiento de camara continuo sobre la interfaz
  (punch-in / reframe), no por cortes.
- La paleta sale del sitio: negro #0e0e0e, oro #c9a84c, crema #f0ead6.

## Notes

- **Privacidad, critico:** el bloque 2 muestra cuentas, saldos y compras. NO puede
  aparecer ningun dato real de clientas — ni nombres, ni telefonos, ni montos
  adeudados. Se usa una cuenta de demostracion inventada. Validar en el storyboard.
- Los precios y productos que se vean deben ser reales del catalogo, pero sin
  inventar descuentos que no existan: hoy hay 9 productos en oferta con 15%, 20% y 30%.
- Sin narracion hablada: el mensaje va en texto en pantalla.
- SIN MUSICA (decidido 2026-09-15): no hay sesion HeyGen ni Python para los motores
  locales. El proyecto queda marcado silencioso (`music: none` + sin SCRIPT.md).
  Se puede agregar una pista despues sin rehacer las escenas.
- Evitar el emoji y cualquier recurso que se lea informal: la marca es sobria,
  oro sobre negro. Ya se limpio el sitio en esa direccion.
- El sitio corre en local en http://localhost:3030 para capturas.

---
format: 1080x1920
fps: 60
duration: 31.4s
message: "La tienda completa de Gaby's Fashion ahora cabe en tu telefono"
arc: "Marca → Un solo plano con el sitio funcionando (catalogo · carrito · cuenta · ofertas) → Cierre"
audience: "Clientas y clientes de Gaby's Fashion en Honduras que compran por WhatsApp"
mode: collaborative
music: none
---

> **Reestructurado.** Antes eran seis cuadros y el telefono nacia de nuevo en
> cada uno: al encadenar, la flotacion arrancaba desde cero y se veia un tiron
> hacia abajo. Ahora las cuatro secciones viven dentro de un unico plano
> continuo (Frame 2) y el aparato no se reinicia nunca.
>
> Las pantallas ya no son capturas fijas: son **video real del sitio**, grabado
> con `.claude/grabar.mjs` conduciendo el navegador por su protocolo de
> depuracion. Los guiones usan las funciones del propio sitio (`cartAdd`,
> `openCart`, `accAbrir`), no un simulacro.

## Frame 1 — Apertura de marca

- status: built
- src: compositions/frames/01-apertura.html
- duration: 3.5s
- transition_in: cut
- scene: Negro absoluto. El nombre aparece por desenfoque y se asienta.
- blueprint: titlecard-reveal
- handoff_out: "titulo Gaby's Fashion — x:540 y:560, escala 1.0, opacidad 1, quieto"

## Frame 2 — La demostracion (plano continuo)

- status: built
- src: compositions/frames/02-demo.html
- duration: 26s
- transition_in: crossfade
- scene: El telefono sube una vez y se queda. Flota sin cortes mientras la
  pantalla recorre las cuatro secciones. Alrededor, la capa de motion graphics:
  resplandor de fondo, reticula con parallaje, riel de avance de cuatro tramos,
  rotulos con numero de marca de agua, fichas con hilo que se dibuja y barrido
  de luz en cada cambio.
- capas de movimiento (separadas a proposito, para que no se pisen):
  - `#plano`    → entrada y salida del conjunto
  - `#flotador` → flotacion infinita (y, rotateZ)
  - `#giro`     → la vuelta de 360 grados
  - `#aparato`  → balanceo ambiente (rotateY)
- segmentos:
  - 01 Catalogo (1.0–5.9s) · `assets/clips/catalogo.mp4` · contador hasta 466
  - 02 Carrito  (5.9–11.9s) · `assets/clips/carrito.mp4` · tres articulos y el panel abierto
  - 03 Tu cuenta (11.9–19.1s) · `assets/clips/cuenta.mp4` · entra girando el aparato
  - 04 Ofertas  (19.1–26s) · `assets/clips/ofertas.mp4` · el telefono NO desaparece
- PRIVACIDAD, critico: el segmento de cuenta usa un usuario inventado
  ("Maria Ejemplo", 9876-5432) y cifras inventadas. El guion de grabacion NO
  llama a `accCheckTel` ni a `accVerSaldo`, que traerian datos de una persona
  real. Los precios y descuentos, en cambio, son los reales del inventario.
- handoff_out: "telefono hundiendose, opacidad 0 a los 26s"

## Frame 3 — Cierre

- status: built
- src: compositions/frames/06-cierre.html
- duration: 2.8s
- transition_in: crossfade
- scene: Queda la marca sobre negro, con la direccion del sitio y las redes.
- blueprint: titlecard-reveal
- url: gabysfashion.netlify.app

---

## Retirados

`compositions/frames/_retirados/` guarda los cuatro cuadros sueltos que
reemplazo el plano continuo (02-telefono, 03-catalogo, 04-cuenta, 05-ofertas).
Se conservan como referencia de la version de seis cuadros.

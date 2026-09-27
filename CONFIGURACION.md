# Configurar en un dispositivo nuevo

Estos archivos tienen credenciales y **no estan en el repo**. Hay que copiarlos
a mano (USB, gestor de contrasenas, etc.) despues de clonar:

| Archivo | Que es | De donde sale |
|---|---|---|
| `config.ps1` | token compartido con Apps Script | plantilla: `config.example.ps1` |
| `light-relic-496921-n3-*.json` | clave de service account de Google | Google Cloud > IAM > Cuentas de servicio |
| `netlify_token.txt` | token personal de Netlify | Netlify > User settings > Applications |
| `netlify_site.txt` | ID del sitio de Netlify | Netlify > Site settings |
| `gabys-analytics/config.json` | conexion SQL a RMS y API key de IA | plantilla: `gabys-analytics/config.example.json` |

## Dependencias

```
cd gabys-analytics
npm install
```

El proyecto de video (`video-anuncio/anuncio-gabys`) necesita ffmpeg, que no se
sube por peso. Descargarlo a `video-anuncio/anuncio-gabys/herramientas/`.

## Lo que no se sincroniza

Logs (`sync_log.txt`, `sync_diario_log.txt`), cache de analitica, renders MP4 y
respaldos `.bak` se quedan en cada maquina. La sincronizacion con RMS solo corre
en la PC que tiene acceso a la base de datos.

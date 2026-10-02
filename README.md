

# Gateaway para aula de desafíos - Especializate

Gateway (Node.js + Express) que **protege el sitio estático de Desafíos**
(`desafios-especializate`, HTML/CSS/JS puro) para que solo se abra desde Moodle.
Valida el lanzamiento LTI 1.3 **en el backend**, crea una sesión server-side y recién
entonces sirve las páginas. **No persiste progreso**: no hay backend de Spring ni base
de datos. Los datos persistidos se mantienen en el naviegador.

<!--  

```
Moodle ──LTI 1.3──▶ Nginx /aula/desafios/ ──▶ Gateway Express (:3002) ──▶ archivos de AULA_DIR
```

Parte del gateway de planillas (misma validación LTI, `BASE_PATH`, destino seguro del
launch), sin la capa de progreso. La validación criptográfica la hace
[`jose`](https://github.com/panva/jose).

## Qué protege y qué no

- Sin sesión LTI válida **nada** del sitio se sirve: ni páginas ni `assets/` ni descargables.
  Un acceso directo va a `/acceso.html` ("Ingresá desde tu aula de Moodle"); una sesión
  vencida, a `/sesion-finalizada.html`.
- Con sesión, el contenido llega completo al navegador: el gateway controla **quién entra**,
  no oculta lo que se sirve (`data.js`, archivos de `assets/files`).
- **Solo egresados:** si la herramienta queda visible en otros cursos del Moodle, definí
  `LTI_ALLOWED_CONTEXT_IDS` con el/los id de curso permitidos; cualquier otro curso recibe 403.
- Se sirven con `dotfiles: 'ignore'`: `.git`, `.env`, etc. del directorio del sitio dan 404.

## Estructura

```
aula-especializate-desafios/
├── src/                 server.js · config.js · aula.js · pages.js
│   ├── lti/             login OIDC, launch, JWKS, identidad, destino seguro, curso permitido
│   ├── routes/          /lti/*, /api/me, /api/logout
│   └── middleware/      requireSession
├── public/              acceso.html · sesion-finalizada.html
├── aula-client/         auth.js (se inyecta en cada página: identidad + vencimiento)
├── test/                node --test (14 tests, sin red ni backend)
└── deploy/              unidad systemd plantilla + snippet de Nginx
```

El sitio estático **no** va dentro de este repo: se apunta con `AULA_DIR`.

## Desarrollo local

```bash
cp .env.example .env     # ver abajo los valores de desarrollo
npm install
npm start
```

`.env` mínimo para probar sin Moodle:

```
NODE_ENV=development
PUBLIC_BASE_URL=http://localhost:3002
BASE_PATH=/aula/desafios
AULA_DIR=../desafios-especializate
SESSION_SECRET=<32+ caracteres>
DEV_FAKE_LAUNCH=true
LTI_ISSUER=https://moodle.local
LTI_CLIENT_ID=dev
LTI_DEPLOYMENT_ID=1
LTI_AUTH_LOGIN_URL=https://moodle.local/mod/lti/auth.php
LTI_JWKS_URL=https://moodle.local/mod/lti/certs.php
MOODLE_URL=https://moodle.local
```

Abrí `http://localhost:3002/aula/desafios/dev/launch` para simular un launch.
`npm test` corre los tests (incluye un launch firmado contra un Moodle simulado).

## Registrar la herramienta en el Moodle de egresados

Con el servidor arriba, imprime las tres URLs. En Moodle (Administración del sitio →
Plugins → Herramienta externa → Administrar herramientas → configurar manualmente):

| Campo en Moodle | Valor |
|---|---|
| Tool URL | `https://especializate.bue.edu.ar/aula/desafios/lti/launch` |
| LTI version | LTI 1.3 |
| Public key type | Keyset URL → `https://especializate.bue.edu.ar/aula/desafios/lti/jwks` |
| Initiate login URL | `https://especializate.bue.edu.ar/aula/desafios/lti/login` |
| Redirection URI(s) | `https://especializate.bue.edu.ar/aula/desafios/lti/launch` |

Moodle devuelve el **Client ID** y el **Deployment ID**; con ellos y los datos de la
plataforma (Platform ID = URL del campus, `…/mod/lti/auth.php`, `…/mod/lti/certs.php`)
se completa el `.env`. Conviene configurar la herramienta como "precargada" solo en el
curso de egresados (no a nivel sitio) **y** fijar `LTI_ALLOWED_CONTEXT_IDS`.

## Despliegue en la VM

Layout: gateway en `/opt/especializate/desafios`, sitio en `/var/www/desafios-especializate`.

```bash
# 1) código del gateway
sudo mkdir -p /opt/especializate/desafios && sudo chown www-data: /opt/especializate/desafios
sudo -u www-data git clone <repo> /opt/especializate/desafios
cd /opt/especializate/desafios && sudo -u www-data npm install --omit=dev

# 2) configuración (secretos fuera del repo)
sudo mkdir -p /etc/especializate
sudo cp .env.example /etc/especializate/desafios.env   # completar; chmod 600
sudo chmod 600 /etc/especializate/desafios.env

# 3) servicio (plantilla: una instancia por aula)
sudo cp deploy/especializate-gateway@.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now especializate-gateway@desafios
curl -s http://127.0.0.1:3002/healthz

# 4) Nginx
sudo cp deploy/nginx-desafios.conf /etc/nginx/snippets/desafios.conf
#   dentro del server de especializate.bue.edu.ar:  include snippets/desafios.conf;
sudo nginx -t && sudo systemctl reload nginx
```

Notas:

- `User=www-data` en la unidad: usá el mismo usuario que `especializate-gateway.service`.
  Necesita escribir en `/opt/especializate/desafios/.keys` (se genera sola la clave de la
  herramienta) y leer `AULA_DIR`.
- La clave de la herramienta vive en `.keys/` (no se versiona): hacer backup, o Moodle
  tendrá que releer el JWKS si se pierde.
- Las sesiones están en memoria: al reiniciar el servicio los alumnos ven "Tu sesión
  finalizó" y vuelven a entrar desde Moodle.
- Para actualizar el contenido de Desafíos alcanza con actualizar `AULA_DIR`
  (`git pull`); no hace falta reiniciar el gateway.
- Se sirve a través de este gateway: **no** dejar además un `location` de Nginx con `alias`
  al mismo directorio, o se saltea la validación.

## Comportamientos a tener en cuenta

- **Videos:** el CSP permite incrustar YouTube, YouTube-nocookie y Vimeo. Si cargan videos
  de otro proveedor, agregarlo a `frame-src` en `src/server.js`.
- **Referrer:** la política es `strict-origin-when-cross-origin`; con `no-referrer` el
  reproductor de YouTube falla.
- **Rutas relativas:** el sitio usa rutas relativas (`assets/...`) y router por hash
  (`#/explorar`), así que funciona bajo `BASE_PATH` sin cambios. Si algún día se agregan
  rutas absolutas (`/assets/...`) hay que cambiarlas.
- **Guardados / tema:** siguen en el `localStorage` del navegador (clave
  `especializate:guardados:v1`); en una computadora compartida los ve quien use ese navegador.


-->
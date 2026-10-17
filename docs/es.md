# Traefik

[Traefik](https://traefik.io/traefik/) es el proxy inverso delante de muchos
servicios autoalojados: envía `nextcloud.example.com` al contenedor de
Nextcloud, renueva los certificados y puede comprobar que cada backend sigue
respondiendo. Esta integración lleva el estado de Traefik a Gladys: un
dispositivo «Traefik» con su versión y los routers, servicios y middlewares con
error, y un dispositivo por servicio HTTP con sus servidores activos. Las
escenas pueden reaccionar cuando **cualquier** servicio cae o se restablece,
cuando un router pasa a error, o cuando el propio Traefik deja de responder; un
widget del panel muestra primero los servicios caídos.

Probada con un Traefik v3.7 real (Docker, provider de archivo, dos backends
tras un health check, routers rotos a propósito). Traefik v2 tiene la misma
API y debería funcionar, sin probar: sus comentarios son bienvenidos en
[las issues](https://github.com/guim31/gladys-traefik/issues).

## Lo que necesita

- Gladys Assistant 5.1.0 o posterior.
- Traefik v2 o v3 con su **API activada**, accesible desde la máquina de
  Gladys:
  - o bien `api.insecure=true` (configuración estática): la API responde en el
    punto de entrada `traefik`, puerto 8080, sin contraseña. Sencillo, solo
    para la red local;
  - o bien uno de sus routers hacia el servicio `api@internal`, en su dominio,
    normalmente tras un middleware `basicAuth`: introduzca su usuario y su
    contraseña.
- Para saber que un servicio está **caído**, un
  [health check](https://doc.traefik.io/traefik/routing/services/#health-check)
  en su load balancer. Sin él, Traefik declara todos los servidores UP: la
  integración sigue viendo un servicio con error o desaparecido (un contenedor
  Docker detenido), no un backend que ya no responde.

La integración envía dos peticiones ligeras por intervalo de actualización
(un minuto por defecto) a la API de Traefik, nada a Internet.

## Primeros pasos

### 1. Activar la API de Traefik

Con `api.insecure`, añada a la configuración estática (línea de comandos del
contenedor):

```
--api.insecure=true
```

y haga accesible el puerto 8080 desde Gladys. Mediante un router, la
[documentación de Traefik](https://doc.traefik.io/traefik/operations/api/)
muestra un router hacia `api@internal` con un middleware `basicAuth`.

### 2. Configurar la integración

En Gladys, abra **Integraciones → Traefik → Configuración**:

- **Dirección de la API**: `http://192.168.1.2:8080` con `api.insecure`, o
  `https://traefik.example.com` mediante un router. También sirve una
  dirección del panel copiada del navegador: se quita `/dashboard/…`.
- **Usuario (basic auth)** y **Contraseña (basic auth)**: solo si el router de
  la API los pide.
- **Intervalo de actualización**: de 30 segundos a 5 minutos.
- **Idioma de los nombres**: idioma de los nombres de las funciones y de los
  resultados de escena.

Guarde y después **Probar la conexión**: el resultado muestra la versión de
Traefik, el número de servicios HTTP y los caídos.

### 3. Añadir los dispositivos

Abra la pestaña **Descubrir**: allí aparecen el dispositivo «Traefik» y un
dispositivo por servicio HTTP (`nextcloud@docker`, `app@file`…). Añada los que
quiera seguir. Los servicios internos de Traefik (`api@internal`…) se omiten.

## Los dispositivos

El dispositivo **Traefik**:

| Función               | Valor                                                                 |
| --------------------- | --------------------------------------------------------------------- |
| Accesible             | sí cuando la API responde, no tras dos lecturas fallidas              |
| Versión               | p. ej. `3.7.15`                                                       |
| Routers con error     | routers HTTP, TCP y UDP que Traefik no pudo construir                 |
| Servicios con error   | servicios con error                                                   |
| Middlewares con error | middlewares con error                                                 |
| Advertencias          | routers, servicios y middlewares con advertencia                      |
| Servicios caídos      | servicios HTTP sin ningún servidor activo (o desaparecidos, añadidos) |

Cada **servicio HTTP**:

| Función             | Valor                                        |
| ------------------- | -------------------------------------------- |
| En buen estado      | sí mientras al menos un servidor esté activo |
| Servidores activos  | servidores UP según el health check          |
| Servidores en total | servidores declarados en el load balancer    |

Un servicio que desaparece de Traefik (su contenedor Docker detenido) cuenta
como caído: sin servidor, no en buen estado, hasta que vuelva.

## Panel

Añada el widget **Traefik** a un panel: los servicios caídos, los routers con
error y los servicios en servicio, después una línea por servicio — primero
los caídos, luego los degradados (parte de los servidores caídos), luego los
demás — con sus servidores activos, y los routers con error con su mensaje.
Sus ajustes pueden limitarlo a algunos servicios (dispositivos añadidos a
Gladys). **Actualizar** vuelve a leer Traefik al momento.

## Escenas

### Disparadores

- **Un servicio cae**: un servicio HTTP ya no tiene ningún servidor activo, o
  ha desaparecido de Traefik (dos lecturas seguidas). Se puede limitar a algunos servicios. Variables:
  nombre del servicio, proveedor, servidores activos y en total, desaparecido
  de Traefik.
- **Un servicio se restablece**: un servicio caído vuelve a tener un servidor
  activo. Variables: las mismas, y la duración de la caída en minutos.
- **Un router tiene un error**: un router pasa a error (servicio o middleware
  ausente, regla incorrecta…), una vez por router hasta que se corrija.
  Variables: nombre del router, proveedor, protocolo, mensaje de error.
- **Traefik no es accesible**: la API ya no responde, dos lecturas seguidas (un
  reinicio rápido de Traefik no lo dispara). Variable: el motivo.

Todos los servicios disparan, añadidos a Gladys o no. Los routers que ya tienen
error al arrancar la integración no se anuncian.

### Acciones

- **Estado de un servicio**: en buen estado o no, su estado en palabras (OK,
  Degradado, Caído, Ausente), servidores activos y en total, y una frase lista
  como «app@docker: Degradado, 1/2 servidor(es) activo(s).»
- **Estado de Traefik**: accesible o no, el número y los nombres de los
  servicios caídos y de los routers con error, la versión y una frase. Cuando
  Traefik no responde, la acción no falla: lo indica, y la escena continúa.

### Ideas de escenas

- Cuando **Un servicio cae**, enviar un mensaje de Telegram «{{service}} está
  caído ({{servers_up}}/{{servers_total}} servidores)», y otro con **Un
  servicio se restablece** con la duración de la caída.
- Cada mañana a las 8:00, **Estado de Traefik** y, si un servicio está caído,
  leer su frase en el altavoz.
- Cuando **Traefik no es accesible**, poner una luz en rojo: todos los sitios
  de la casa han caído a la vez.

## Solución de problemas

- **«Traefik no responde»**: compruebe la dirección y el puerto desde la
  máquina de Gladys (`curl http://192.168.1.2:8080/api/version`), y que el
  contenedor de Traefik publica el puerto 8080.
- **«no hay API de Traefik en esta dirección»**: la API no está activada, o la
  dirección apunta a otro router distinto del de `api@internal`.
- **«usuario o contraseña rechazados»**: compruebe el usuario de la basic
  auth; una contraseña que termina en espacio se conserva tal cual.
- **«la dirección redirige»**: introduzca directamente la dirección `https://`.
- **«certificado rechazado»**: use un certificado en el que Gladys confíe
  (Let's Encrypt), o la dirección `http://` de `api.insecure` en la red local.
- **Un servicio nunca cae**: añada un health check a su load balancer.
- Más detalles en los registros de la integración (Integraciones → Traefik →
  Registros), con `LOG_LEVEL=debug` para cada lectura.

## Límites

- Solo lectura: la API de Traefik no permite cambiar la configuración, así que
  la integración no tiene ningún comando.
- Solo los servicios HTTP se convierten en dispositivos; los routers y
  servicios TCP y UDP se cuentan en el dispositivo Traefik.
- Sin health check, Traefik declara todos los servidores UP.
- Las métricas de Prometheus (peticiones, errores 5xx) no se leen.
- Un solo Traefik por integración.

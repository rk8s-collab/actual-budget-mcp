[English](PRIVACY.md) | **Español**

# Política de privacidad

**Última actualización:** 24-07-2026

Esta política cubre el **Actual Budget MCP Server** (`actual-budget-mcp-es`), un servidor MCP de código abierto que se distribuye como código fuente y como extensión de Claude Desktop (`.mcpb`).

## Quién opera este software

No hay ningún servicio detrás. El software se ejecuta **enteramente en tu propio ordenador**, contra **tu propio** servidor self-hosted de Actual Budget. El autor no opera servidores, ni cuentas, ni ninguna infraestructura con la que este software hable.

## Qué recopila

**Nada.** No tiene telemetría, ni analítica, ni informes de errores, ni métricas de uso, ni comprobación de actualizaciones. Nunca contacta con el autor ni con ningún tercero elegido por el autor.

## A qué accede, y adónde va ese dato

Para hacer su trabajo, el software lee los datos de tu presupuesto —cuentas, saldos, movimientos, categorías, presupuestos y repetitivos— de tu servidor de Actual Budget. Si activas las herramientas de escritura, también puede modificarlos.

Esos datos viajan exactamente a dos sitios, y los dos los eliges tú:

1. **Tu servidor de Actual Budget**, en la URL que configures. Es una conexión directa desde tu ordenador a tu servidor.
2. **El cliente MCP al que lo conectes** — en la práctica, Claude. Cuando preguntas algo, la respuesta incluye los datos financieros necesarios para responder, y ese dato lo procesa tu cliente MCP bajo **su propia** política de privacidad, no bajo esta. Si usas Claude, consulta la [Política de Privacidad de Anthropic](https://www.anthropic.com/legal/privacy).

Esto es el propósito del software, no un efecto secundario: existe para que un asistente pueda leer tu presupuesto. Instálalo solo si te parece bien que tu cliente MCP vea los datos financieros por los que preguntes.

## Credenciales

La URL de tu servidor de Actual, la contraseña y el Sync ID del presupuesto los aportas tú como configuración.

- Como **extensión de Claude Desktop**, la contraseña la guarda el almacenamiento seguro del propio Claude Desktop; el resto de valores quedan en su configuración.
- Como **instalación manual**, todos viven en variables de entorno o en un fichero `.env` local que controlas tú.

Se usan únicamente para autenticarse contra tu propio servidor. Nunca se transmiten a ningún otro sitio, ni se escriben en los logs.

## Almacenamiento local y conservación

La API de Actual descarga una **copia local sin cifrar** de tu presupuesto (una base SQLite) en el directorio de datos, para que las consultas sean rápidas y funcionen sin conexión. El directorio se crea con permisos `0700`, legible solo por tu usuario.

Esa copia vive en tu máquina mientras el software esté instalado. Nadie la conserva salvo tú: al desinstalar la extensión, o borrar el directorio de datos, desaparece. El autor no conserva nada, porque nada le llega.

## Cesión a terceros

El autor no cede nada, porque no recibe nada. Los únicos que ven tus datos son los dos que has elegido: tu propio servidor de Actual y tu propio cliente MCP.

## Menores

Este software no está dirigido a menores y no recopila datos de nadie.

## Cambios

Los cambios en esta política se publican en este mismo fichero, en el repositorio público del proyecto, actualizando la fecha de arriba. El historial de versiones queda visible en el registro de commits del repositorio.

## Contacto

Abre una incidencia en [github.com/marcoaperez/actual-budget-mcp-es/issues](https://github.com/marcoaperez/actual-budget-mcp-es/issues).

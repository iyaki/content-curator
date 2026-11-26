# AGENTS.md

Sitio estático [curated.iyaki.ar](https://curated.iyaki.ar) + automatizaciones
que replican la base de conocimiento de Notion (curación, clasificación con
LLM y mantenimiento de enlaces). Monorepo con cuatro paquetes Node
independientes, cada uno con su propio `package.json`.

## Stack

- Node 24 (`.tool-versions`, `engines` en todos los package.json, `engine-strict=true` en `.npmrc`).
- ESM (`"type": "module"` en todos los paquetes).
- Eleventy 3 con Liquid para el sitio; PostCSS (nesting + cssnano) y minificado de HTML/XML solo en build.
- `@notionhq/client` y `openai` para las automatizaciones; `linkedom` + Readability en maintenance.
- CI: GitHub Actions (workflows en `.github/workflows/`); despliegue a GitHub Pages en push a `main` con cambios en `web/**`.

## Layout

- `web/`: fuente del sitio Eleventy (entrada configurada como `input` en `.eleventy.js`). `entries/` contiene las páginas curadas; `_data/` los datos globales.
- `curator/`: publica en la web las nuevas adiciones a la BD de Notion, agregando comentarios generados con OpenAI. Corre vía workflow `content_curator.yml`.
- `organizer/`: clasifica y mueve entradas del DB de triage al de base de conocimiento usando OpenAI (propiedades, emoji, cover, contenido). Corre a diario vía `organizer.yml`.
- `maintenance/`: tareas programadas sobre la KB (chequeo y reparación de enlaces). Corre cada 6 meses vía `maintenance.yml`.
- `_site/`: salida de build (gitignored). No editar.

## Comandos

Verificados en los package.json; todos desde la raíz salvo indicación.

```shell
npm install          # instalar dependencias del sitio
npm run build        # build de Eleventy + jampack sobre _site/
npm run serve        # dev server de Eleventy

cd curator && ./curate.sh            # corre el curador (node main.js); requiere NOTION_TOKEN y OPENAI_API_KEY, lee .env local
cd organizer && npm install && npm start   # corre el organizador
cd maintenance && npm start          # corre el mantenimiento

# Tests (node:test + assert, no hay runner de tests en package.json):
node --test organizer/*.test.mjs
node --test maintenance/*.test.mjs
```

Variables de entorno de las automatizaciones: `NOTION_TOKEN`,
`OPENAI_API_KEY`, y en organizer además `TRIAGE_DATABASE_ID` y
`KNOWLEDGE_BASE_DATABASE_ID`. Cada paquete acepta un `.env` local
(dotenv); no commitear `.env`.

## Convenciones

- Indentación con tabs (2 espacios en YAML y Markdown, según `.editorconfig`); LF, UTF-8, línea final.
- Documentación en español rioplatense (raíz, curator) o inglés (organizer, maintenance): seguir el idioma del README del paquete que se edite.
- Sin linter ni formateador configurado; no agregar uno sin pedido.

## Guardarraíles

- Node distinto de 24 falla por `engine-strict`. Usar la versión fijada.
- No editar `_site/` ni `node_modules/`: son generados.
- `maintenance/` escribe sobre la base de conocimiento real de Notion (archiva páginas): usar `DRY_RUN=true` salvo pedido explícito. Bot walls (401/403/406/429/503/999) y timeouts de red nunca se tratan como enlaces muertos; quedan para revisión manual.
- `curator/data/last_article.txt` guarda el cursor de sincronización; el workflow lo commitea de vuelta. No borrar ni editar a mano salvo para resetear la sincronización deliberadamente.
- Cambios en `web/**` disparan deploy a producción (GitHub Pages). Los workflows corren con secrets reales de Notion/OpenAI: probar en local con credenciales de prueba antes de pushear.

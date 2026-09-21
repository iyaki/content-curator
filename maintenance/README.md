# maintenance

Scheduled maintenance tasks over the Notion Knowledge Base. Runs every 6 months
via `.github/workflows/maintenance.yml` (also triggerable with `workflow_dispatch`).

## Task: maintain-kb

Single pass over every KB entry (id, title, URL property), link-checking and
repairing according to these rules:

1. **Link check, redirect-aware** — redirects are followed hop by hop
   (`redirect: 'manual'`). A redirect that lands on a live page (2xx) is a
   source that *moved*; a redirect ending in 404/dead is a dead link.
2. **Live redirect → URL update** — when the chain ends OK, the entry's URL
   property is updated to the final destination (unless it ends in 404: then
   the dead-link rules below apply).
3. **Dead link + page has a body → URL becomes the Notion page link**
   (`https://www.notion.so/<id>`). The content is already archived in Notion,
   so the entry points at its own copy.
4. **Live link + page has no body → fetch the article** from its (final) URL
   with Readability and append the extracted blocks to the Notion page.
5. **Dead link + page has no body → archive the entry** ("only a broken link").

Has-body means any block with text or image/file/code/pdf content; a bare
bookmark/link block does not count.

Safety rails:

- **Unverifiable ≠ dead**: bot walls (401/403/406/429/503/999) and network
  timeouts are never treated as broken. Those entries are listed for manual
  review and left untouched — live sites regularly time out from CI.
- **Fail-safe body scan**: if a page's blocks can't be read, it is assumed to
  have a body so it is never destroyed on uncertainty.
- **`DRY_RUN=true`** logs every action without writing anything. The workflow
  exposes it as a `dry_run` input on manual dispatch; the weekly scheduled run
  always executes for real.
- Archived pages remain recoverable from Notion trash for 30 days.

Known ceilings (marked in code): tables are flattened to text paragraphs,
images inside fetched articles are dropped, and sites that render content
client-side extract as "no article found".

## Add a task

Export an `async function` in `index.js` and register it in `TASKS`.
A task that throws fails the run (exit code 1); expected findings should be
reported, not thrown.

## Run locally

```sh
cp .env.example .env  # fill in NOTION_TOKEN
npm install
npm start
```

```sh
DRY_RUN=true npm start   # log actions without applying them
```

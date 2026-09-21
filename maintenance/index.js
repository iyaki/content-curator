import { Client } from '@notionhq/client'
import { appendFile } from 'node:fs/promises'
import { Readability } from '@mozilla/readability'
import { parseHTML } from 'linkedom'
import 'dotenv/config'

const KNOWLEDGE_BASE_DATASOURCE_ID = process.env.KNOWLEDGE_BASE_DATASOURCE_ID || 'e1a982ac-2c77-40d9-8783-50e1646af757'
const DRY_RUN = process.env.DRY_RUN === 'true'

const LINK_TIMEOUT = 15_000
const FETCH_TIMEOUT = 30_000
const CHECK_CONCURRENCY = 20
const MAX_REDIRECTS = 5
// ponytail: these statuses mean "we can't verify" (bot walls, login walls), not "dead" — never destroy on them
const UNVERIFIABLE_STATUSES = new Set([401, 403, 406, 429, 503, 999])

const BROWSER_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

// Connect timeouts / unreachable hosts are not proof of a dead link — our own
// network is often the problem (live sites like regex101.com time out here regularly).
// Only explicit death signals (HTTP 4xx/5xx answers, NXDOMAIN, refused connections,
// TLS failures) may classify a link as broken.
export function isUnverifiableNetworkError(code) {
	// note: "ETIMEDOUT" does not contain "TIMEOUT" (it's TIMED+OUT) — match it explicitly
	return /ETIMEDOUT|TIMEOUT|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|ENETDOWN/.test(code)
}

if (!process.env.NOTION_TOKEN) {
	console.error('Error: NOTION_TOKEN is required.')
	process.exit(1)
}

const notion = new Client({ auth: process.env.NOTION_TOKEN })

// New maintenance tasks go here: { name, run }
const TASKS = [
	{ name: 'maintain-kb', run: maintainKb },
]

export async function run(tasks = TASKS) {
	let failures = 0
	for (const task of tasks) {
		try {
			console.log(`\n=== ${task.name} ===`)
			await task.run()
		} catch (error) {
			failures++
			console.error(`Task ${task.name} failed:`, error)
		}
	}

	if (failures > 0) {
		console.error(`${failures} of ${tasks.length} tasks failed.`)
		process.exitCode = 1
	}
}

// ---------- link checking ----------

function normalizeHost(host) {
	return host.replace(/^www\./, '')
}

// Careful with redirects: a 200 behind a redirect is not a healthy link when the
// article's location was abandoned. Landing on a different domain or on the site
// root means the original content is gone, even if the server says OK.
export function classifyRedirect(originalUrl, finalUrl) {
	try {
		const orig = new URL(originalUrl)
		const fin = new URL(finalUrl)
		if (normalizeHost(orig.hostname) !== normalizeHost(fin.hostname)) return 'redirect-suspect'
		if (orig.pathname !== '/' && fin.pathname === '/') return 'redirect-suspect'
		return 'ok'
	} catch {
		return 'broken'
	}
}

export async function checkLink(url) {
	let current = url
	let hops = 0
	for (;;) {
		let res
		try {
			res = await fetch(current, { redirect: 'manual', signal: AbortSignal.timeout(LINK_TIMEOUT), headers: { 'user-agent': BROWSER_UA } })
		} catch (error) {
			const code = String(error.cause?.code ?? error.message)
			const status = isUnverifiableNetworkError(code) ? 'unverifiable' : 'broken'
			return { status, detail: code, finalUrl: current }
		}
		await res.body?.cancel() // status only; releases the socket instead of stalling undici's pool
		if (res.status >= 300 && res.status < 400) {
			const location = res.headers.get('location')
			if (!location) return { status: 'broken', detail: `HTTP ${res.status} without Location`, finalUrl: current }
			if (++hops > MAX_REDIRECTS) return { status: 'broken', detail: 'too many redirects', finalUrl: current }
			current = new URL(location, current).toString()
			continue
		}
		if (UNVERIFIABLE_STATUSES.has(res.status)) return { status: 'unverifiable', detail: `HTTP ${res.status}`, finalUrl: current }
		if (res.status < 400) {
			return {
				status: 'ok',
				redirected: hops > 0,
				// annotation only: cross-domain/root redirect targets are live but likely not the original article
				suspect: hops > 0 && classifyRedirect(url, current) === 'redirect-suspect',
				detail: `HTTP ${res.status}`,
				finalUrl: current,
			}
		}
		return { status: 'broken', detail: `HTTP ${res.status}`, finalUrl: current }
	}
}

// ---------- KB access ----------

async function fetchKbPages() {
	const pages = []
	let cursor
	do {
		const res = await notion.dataSources.query({
			data_source_id: KNOWLEDGE_BASE_DATASOURCE_ID,
			page_size: 100,
			...(cursor ? { start_cursor: cursor } : {}),
		})
		pages.push(...res.results)
		cursor = res.has_more ? res.next_cursor : undefined
	} while (cursor)
	return pages
}

export function extractUrls(pages) {
	return pages
		.map(page => ({
			id: page.id,
			title: page.properties?.Name?.title?.[0]?.plain_text || 'Untitled',
			url: page.properties?.URL?.url,
		}))
		.filter(entry => entry.url)
}

async function getPageBlocks(pageId) {
	const blocks = []
	let cursor
	do {
		const res = await notion.blocks.children.list({
			block_id: pageId,
			page_size: 100,
			...(cursor ? { start_cursor: cursor } : {}),
		})
		blocks.push(...res.results)
		cursor = res.has_more ? res.next_cursor : undefined
	} while (cursor)
	return blocks
}

// A page "has a body" when it holds real content: any block with text, or
// image/file/code/pdf content. A bare bookmark/link block does not count —
// that is exactly the "entry that is only a link" case.
export function hasBody(blocks) {
	return blocks.some(block => {
		const content = block[block.type]
		if (['image', 'file', 'pdf', 'code'].includes(block.type)) return true
		if (Array.isArray(content?.rich_text) && content.rich_text.some(t => (t.plain_text ?? '').trim() !== '')) return true
		return false
	})
}

// ---------- body fetching ----------

export function toRichText(text) {
	const clean = text.replace(/\s+/g, ' ').trim()
	if (!clean) return []
	return (clean.match(/[\s\S]{1,2000}/g) || []).map(chunk => ({ type: 'text', text: { content: chunk } }))
}

const HEADINGS = { H1: 'heading_1', H2: 'heading_2', H3: 'heading_3', H4: 'heading_3', H5: 'heading_3', H6: 'heading_3' }

function pushBlock(blocks, type, text) {
	const rich_text = toRichText(text)
	if (rich_text.length) blocks.push({ object: 'block', type, [type]: { rich_text } })
}

export function htmlToBlocks(root) {
	const blocks = []
	for (const el of root.children) {
		const tag = (el.tagName || '').toUpperCase()
		if (HEADINGS[tag]) {
			pushBlock(blocks, HEADINGS[tag], el.textContent)
			continue
		}
		switch (tag) {
			case 'P':
				pushBlock(blocks, 'paragraph', el.textContent)
				break
			case 'BLOCKQUOTE':
				pushBlock(blocks, 'quote', el.textContent)
				break
			case 'PRE': {
				const code = el.textContent.replace(/\s+$/, '')
				if (code) blocks.push({ object: 'block', type: 'code', code: { rich_text: toRichText(code), language: 'plain text' } })
				break
			}
			case 'UL':
			case 'OL': {
				const type = tag === 'UL' ? 'bulleted_list_item' : 'numbered_list_item'
				for (const li of el.children) {
					if ((li.tagName || '').toUpperCase() === 'LI') pushBlock(blocks, type, li.textContent)
				}
				break
			}
			// ponytail: tables flattened to one text paragraph; proper Notion tables if they ever matter
			case 'TABLE':
				pushBlock(blocks, 'paragraph', el.textContent)
				break
			case 'DIV':
			case 'SECTION':
			case 'ARTICLE':
			case 'MAIN':
			case 'ASIDE':
			case 'FIGURE':
				blocks.push(...htmlToBlocks(el))
				break
			default: {
				if (el.children.length) blocks.push(...htmlToBlocks(el))
				else pushBlock(blocks, 'paragraph', el.textContent)
			}
		}
	}
	return blocks
}

// Result: { status: 'extracted', blocks } | { status: 'blocked' } | { status: 'missing', reason }
export async function fetchArticleBlocks(url) {
	let res
	try {
		res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(FETCH_TIMEOUT), headers: { 'user-agent': BROWSER_UA } })
	} catch (error) {
		return { status: 'missing', reason: String(error.cause?.code ?? error.message) }
	}
	if (UNVERIFIABLE_STATUSES.has(res.status)) return { status: 'blocked' }
	if (!res.ok) return { status: 'missing', reason: `HTTP ${res.status}` }
	let html
	try {
		html = await res.text()
	} catch (error) {
		return { status: 'missing', reason: String(error.cause?.code ?? error.message) }
	}
	let { document } = parseHTML(html)
	let article
	try {
		article = new Readability(document).parse()
	} catch {
		// ponytail: Readability has DOM edge cases with linkedom (null tagName); skip, the entry stays as-is
		return { status: 'missing', reason: 'extractor crashed on this page' }
	}
	// With a linkedom document Readability returns serialized HTML; parse it into a real node tree.
	if (typeof article?.content === 'string') {
		document = parseHTML(`<html><body>${article.content}</body></html>`).document
	}
	const blocks = article?.content ? htmlToBlocks(document.body) : []
	if (blocks.length === 0) return { status: 'missing', reason: 'no article found at source' }
	return { status: 'extracted', blocks }
}

// ---------- actions ----------

function notionUrlFor(pageId) {
	return `https://www.notion.so/${pageId.replaceAll('-', '')}`
}

async function updateEntryUrl(entry, url) {
	if (DRY_RUN) {
		console.log(`[dry-run] would set URL of "${entry.title}" to ${url}`)
		return
	}
	await notion.pages.update({ page_id: entry.id, properties: { URL: { url } } })
}

async function archiveEntry(entry) {
	if (DRY_RUN) {
		console.log(`[dry-run] would archive "${entry.title}" (${entry.url})`)
		return
	}
	await notion.pages.update({ page_id: entry.id, archived: true })
}

async function appendBlocks(pageId, blocks) {
	if (DRY_RUN) {
		console.log(`[dry-run] would append ${blocks.length} blocks to ${pageId}`)
		return
	}
	for (let i = 0; i < blocks.length; i += 100) {
		await notion.blocks.children.append({ block_id: pageId, children: blocks.slice(i, i + 100) })
	}
}

// ---------- the task ----------

async function checkLinksConcurrently(entries) {
	const map = new Map()
	for (let i = 0; i < entries.length; i += CHECK_CONCURRENCY) {
		const chunk = entries.slice(i, i + CHECK_CONCURRENCY)
		const results = await Promise.all(chunk.map(entry =>
			checkLink(entry.url).catch(error => ({ status: 'broken', detail: error.message, finalUrl: entry.url }))
		))
		chunk.forEach((entry, j) => map.set(entry.id, results[j]))
		console.log(`links [${Math.min(i + CHECK_CONCURRENCY, entries.length)}/${entries.length}]`)
	}
	return map
}

async function scanBodies(entries, errors) {
	const map = new Map()
	let done = 0
	for (const entry of entries) {
		try {
			map.set(entry.id, hasBody(await getPageBlocks(entry.id)))
		} catch (error) {
			// fail safe: on a Notion API error assume content exists so the entry is never destroyed
			errors.push(`${entry.title} — ${entry.url}: body scan failed: ${error.message}`)
			map.set(entry.id, true)
		}
		if (++done % 200 === 0) console.log(`bodies [${done}/${entries.length}]`)
	}
	console.log(`bodies [${entries.length}/${entries.length}]`)
	return map
}

export async function maintainKb() {
	const entries = extractUrls(await fetchKbPages())
	console.log(`Maintaining ${entries.length} KB entries${DRY_RUN ? ' (DRY RUN)' : ''}...`)

	const errors = []
	// Link checks (external) and body scans (Notion API) are independent: run in parallel.
	const [links, bodies] = await Promise.all([
		checkLinksConcurrently(entries),
		scanBodies(entries, errors),
	])

	const report = {
		archived: [],      // link-only entries whose link is confirmed dead
		notionified: [],   // dead source link, content already archived -> URL now points at the Notion copy
		repointed: [],     // live redirect: URL updated to the final destination
		fetched: [],       // missing body rescued from the source URL
		fetchFailed: [],   // body missing and extraction impossible/failed
		unverified: [],    // unverifiable (bot walls, timeouts) -> manual review, left untouched
	}

	for (const entry of entries) {
		const link = links.get(entry.id)
		const label = `${entry.title} — ${entry.url}`
		try {
			if (link.status === 'unverifiable') {
				report.unverified.push(`${label} [${link.detail}]`)
				continue
			}

			if (link.status === 'broken') {
				// The original location is dead.
				if (bodies.get(entry.id)) {
					await updateEntryUrl(entry, notionUrlFor(entry.id))
					report.notionified.push(`${label} [${link.detail}]`)
				} else {
					await archiveEntry(entry)
					report.archived.push(`${label} [${link.detail}]`)
				}
				continue
			}

			// Live link (HTTP 2xx at the end of the chain).
			if (link.redirected) {
				// The source moved and is alive: point the URL at its current home.
				await updateEntryUrl(entry, link.finalUrl)
				report.repointed.push(`${label} → ${link.finalUrl}${link.suspect ? ' [cross-domain/root target — verify]' : ''}`)
			}

			if (!bodies.get(entry.id)) {
				const result = await fetchArticleBlocks(link.finalUrl)
				if (result.status === 'extracted') {
					await appendBlocks(entry.id, result.blocks)
					report.fetched.push(`${label} (${result.blocks.length} blocks)`)
				} else if (result.status === 'blocked') {
					report.unverified.push(`${label} [body fetch blocked]`)
				} else {
					report.fetchFailed.push(`${label} (${result.reason})`)
				}
			}
		} catch (error) {
			errors.push(`${label}: action failed: ${error.message}`)
		}
	}

	printReport(report, entries.length, errors)
}

function printReport(report, total, errors) {
	const section = (title, items) => {
		if (items.length === 0) return
		console.error(`\n${title} (${items.length}):`)
		for (const line of items) console.error(`- ${line}`)
	}

	console.log(`\nMaintenance finished for ${total} entries: ` +
		`${report.archived.length} archived, ${report.notionified.length} URLs repointed to Notion, ` +
		`${report.repointed.length} URLs updated after redirect, ${report.fetched.length} bodies fetched, ` +
		`${report.fetchFailed.length} fetch failures, ${report.unverified.length} unverifiable (manual review).`)

	section('Archived (link-only entries with a confirmed-dead link)', report.archived)
	section('URL repointed to the Notion copy (dead source, content archived)', report.notionified)
	section('URL updated after redirect', report.repointed)
	section('Bodies fetched from source', report.fetched)
	section('Body fetch failures', report.fetchFailed)
	section('Unverifiable links — manual review', report.unverified)
	section('Errors', errors)

	if (process.env.GITHUB_STEP_SUMMARY) {
		const lines = [
			`## KB maintenance${DRY_RUN ? ' (dry run)' : ''}`,
			`-${report.archived.length} archived, ${report.notionified.length} repointed to Notion, ${report.repointed.length} redirect updates, ${report.fetched.length} bodies fetched`,
			...report.archived.map(l => `- archived: ${l}`),
			...report.notionified.map(l => `- repointed: ${l}`),
			...report.repointed.map(l => `- redirect: ${l}`),
			...report.unverified.map(l => `- unverifiable: ${l}`),
			...errors.map(l => `- error: ${l}`),
		]
		appendFile(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n').catch(() => {})
	}

	if (errors.length > 0) process.exitCode = 1
}

// Auto-run if executed directly
if (process.argv[1] === import.meta.filename) {
	run().catch(error => {
		console.error('Maintenance run failed:', error)
		process.exit(1)
	})
}

import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.TRIAGE_DATABASE_ID ??= 'test'
process.env.OPENAI_API_KEY ??= 'test'
const { sanitizeBlocks, toOptionNames } = await import('./index.js')

test('keeps empty-content blocks valid (divider)', () => {
	const out = sanitizeBlocks([{ type: 'divider', divider: {} }])
	assert.deepEqual(out, [{ type: 'divider', divider: {} }])
})

test('drops null-synced_from but keeps the content key', () => {
	const out = sanitizeBlocks([{ type: 'synced_block', synced_block: { synced_from: null } }])
	assert.deepEqual(out, [{ type: 'synced_block', synced_block: {} }])
})

test('preserves bookmark url and caption', () => {
	const out = sanitizeBlocks([{ type: 'bookmark', bookmark: { url: 'https://x.com', caption: [] } }])
	assert.deepEqual(out, [{ type: 'bookmark', bookmark: { url: 'https://x.com', caption: [] } }])
})

test('preserves paragraph text', () => {
	const out = sanitizeBlocks([{ type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: 'hola', link: null } }] } }])
	assert.equal(out[0].paragraph.rich_text[0].text.content, 'hola')
})

test('keeps external image url', () => {
	const out = sanitizeBlocks([{ type: 'image', image: { type: 'external', external: { url: 'https://img.example/x.png' } } }])
	assert.deepEqual(out, [{ type: 'image', image: { external: { url: 'https://img.example/x.png' } } }])
})

test('drops child_page and unsupported blocks', () => {
	const out = sanitizeBlocks([
		{ type: 'child_page', child_page: { title: 'x' } },
		{ type: 'unsupported', unsupported: {} },
	])
	assert.deepEqual(out, [])
})

test('chunks long paragraphs at 2000 chars', () => {
	const out = sanitizeBlocks([{ type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: 'a'.repeat(2500), link: null } }] } }])
	assert.equal(out.length, 2)
	assert.equal(out[0].paragraph.rich_text[0].text.content.length, 2000)
	assert.equal(out[1].paragraph.rich_text[0].text.content.length, 500)
})

test('toOptionNames coerces and filters LLM output', () => {
	assert.deepEqual(toOptionNames('DevOps'), ['DevOps'])
	assert.deepEqual(toOptionNames(['A', 'B']), ['A', 'B'])
	assert.deepEqual(toOptionNames(['A', 42, {}]), ['A'])
	assert.deepEqual(toOptionNames(42), [])
	assert.deepEqual(toOptionNames([]), [])
})

import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.TRIAGE_DATABASE_ID ??= 'test'
process.env.OPENAI_API_KEY ??= 'test'
const { stripTrackingParams } = await import('./index.js')

test('strips utm_* tracking params', () => {
	assert.equal(stripTrackingParams('https://x.com/a?utm_source=tldrdev'), 'https://x.com/a')
	assert.equal(stripTrackingParams('https://x.com/a?utm_source=t&utm_campaign=c&id=42'), 'https://x.com/a?id=42')
})

test('strips click IDs and ref params', () => {
	assert.equal(stripTrackingParams('https://x.com/a?fbclid=1&gclid=2'), 'https://x.com/a')
	assert.equal(stripTrackingParams('https://x.com/a?ref_src=twsrc&id=7'), 'https://x.com/a?id=7')
})

test('keeps functional query params', () => {
	assert.equal(stripTrackingParams('https://youtu.be/abc?v=xyz&utm_source=y'), 'https://youtu.be/abc?v=xyz')
	assert.equal(stripTrackingParams('https://x.com/search?q=notion&page=2'), 'https://x.com/search?q=notion&page=2')
})

test('keeps fragments', () => {
	assert.equal(stripTrackingParams('https://x.com/a?utm_source=n#fnref-1'), 'https://x.com/a#fnref-1')
})

test('handles already-clean and invalid URLs', () => {
	assert.equal(stripTrackingParams('https://x.com/a'), 'https://x.com/a')
	assert.equal(stripTrackingParams('not a url'), 'not a url')
})

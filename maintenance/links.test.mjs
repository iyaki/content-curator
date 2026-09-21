import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.NOTION_TOKEN ??= 'test'
const { extractUrls, classifyRedirect, hasBody, isUnverifiableNetworkError } = await import('./index.js')

test('extracts id, title and url from KB pages', () => {
	const pages = [
		{ id: '1', properties: { Name: { title: [{ plain_text: 'Some post' }] }, URL: { url: 'https://x.com/a' } } },
		{ id: '2', properties: { Name: { title: [] }, URL: { url: 'https://x.com/b' } } },
	]
	assert.deepEqual(extractUrls(pages), [
		{ id: '1', title: 'Some post', url: 'https://x.com/a' },
		{ id: '2', title: 'Untitled', url: 'https://x.com/b' },
	])
})

test('skips pages without a URL property', () => {
	const pages = [
		{ id: '1', properties: { Name: { title: [{ plain_text: 'No url' }] } } },
		{ id: '2', properties: { Name: { title: [{ plain_text: 'Empty' }] }, URL: { url: null } } },
	]
	assert.deepEqual(extractUrls(pages), [])
})

test('same-domain path redirects are ok', () => {
	assert.equal(classifyRedirect('https://a.com/x', 'https://a.com/y'), 'ok')
	assert.equal(classifyRedirect('http://a.com/x', 'https://a.com/x'), 'ok')
	assert.equal(classifyRedirect('https://www.a.com/x', 'https://a.com/updated-slug'), 'ok')
})

test('redirects to another domain are suspect', () => {
	assert.equal(classifyRedirect('https://a.com/x', 'https://b.com/'), 'redirect-suspect')
	assert.equal(classifyRedirect('https://a.com/x', 'https://parked.example.com/plot'), 'redirect-suspect')
})

test('redirects to the site root are suspect', () => {
	assert.equal(classifyRedirect('https://a.com/blog/post', 'https://a.com/'), 'redirect-suspect')
	assert.equal(classifyRedirect('https://a.com/blog/post', 'https://www.a.com/?utm=1'), 'redirect-suspect')
})

test('root homepages and unparseable urls do not false-positive', () => {
	assert.equal(classifyRedirect('https://a.com/', 'https://a.com/'), 'ok')
	assert.equal(classifyRedirect('not a url', 'https://a.com/'), 'broken')
})

test('hasBody: any text block counts as a body', () => {
	const blocks = [{ type: 'paragraph', paragraph: { rich_text: [{ plain_text: 'hello' }] } }]
	assert.equal(hasBody(blocks), true)
	assert.equal(hasBody([{ type: 'paragraph', paragraph: { rich_text: [{ plain_text: '   ' }] } }]), false)
	assert.equal(hasBody([]), false)
})

test('hasBody: image/code/pdf count, bare bookmark does not', () => {
	assert.equal(hasBody([{ type: 'image', image: {} }]), true)
	assert.equal(hasBody([{ type: 'code', code: { rich_text: [] } }]), true)
	assert.equal(hasBody([{ type: 'bookmark', bookmark: { url: 'https://x.com' } }]), false)
})

test('timeouts and unreachable networks are unverifiable, real death signals are broken', () => {
	// our network being flaky — never destroy on these
	assert.equal(isUnverifiableNetworkError('ETIMEDOUT'), true)
	assert.equal(isUnverifiableNetworkError('UND_ERR_CONNECT_TIMEOUT'), true)
	assert.equal(isUnverifiableNetworkError('EAI_AGAIN'), true)
	assert.equal(isUnverifiableNetworkError('EHOSTUNREACH'), true)
	// explicit death signals
	assert.equal(isUnverifiableNetworkError('ENOTFOUND'), false)
	assert.equal(isUnverifiableNetworkError('ECONNREFUSED'), false)
	assert.equal(isUnverifiableNetworkError('CERT_HAS_EXPIRED'), false)
})

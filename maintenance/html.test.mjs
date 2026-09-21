import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.NOTION_TOKEN ??= 'test'
const { htmlToBlocks, toRichText } = await import('./index.js')
const { parseHTML } = await import('linkedom')

function convert(html) {
	// linkedom does not synthesize <body> for fragments; production input is always a full document
	const { document } = parseHTML(`<html><body>${html}</body></html>`)
	return htmlToBlocks(document.body)
}

test('maps headings, paragraphs, lists, code and quotes', () => {
	const blocks = convert(`<div>
		<h2>Title</h2>
		<p>First   paragraph.</p>
		<p>   </p>
		<ul><li>one</li><li>two</li></ul>
		<ol><li>first</li></ol>
		<pre><code>const x = 1
</code></pre>
		<blockquote>quoted</blockquote>
	</div>`)
	assert.deepEqual(blocks.map(b => b.type), [
		'heading_2', 'paragraph', 'bulleted_list_item', 'bulleted_list_item',
		'numbered_list_item', 'code', 'quote',
	])
	assert.equal(blocks[1].paragraph.rich_text[0].text.content, 'First paragraph.')
	assert.equal(blocks[5].code.rich_text[0].text.content, 'const x = 1')
	assert.equal(blocks[5].code.language, 'plain text')
})

test('recurses into nested containers and figures', () => {
	const blocks = convert('<article><div><section><p>deep</p></section></div><figure><img src="x"><figcaption>caption</figcaption></figure></article>')
	assert.deepEqual(blocks.map(b => b.type), ['paragraph', 'paragraph'])
	assert.equal(blocks[0].paragraph.rich_text[0].text.content, 'deep')
	assert.equal(blocks[1].paragraph.rich_text[0].text.content, 'caption')
})

test('flattens tables to a text paragraph and drops bare images', () => {
	const blocks = convert('<div><table><tr><td>a</td><td>b</td></tr></table><img src="x"></div>')
	assert.equal(blocks.length, 1)
	assert.equal(blocks[0].type, 'paragraph')
	assert.equal(blocks[0].paragraph.rich_text[0].text.content, 'ab')
})

test('splits text at the Notion 2000-char limit', () => {
	const rich = toRichText('a'.repeat(2500))
	assert.equal(rich.length, 2)
	assert.equal(rich[0].text.content.length, 2000)
	assert.equal(rich[1].text.content.length, 500)
	assert.deepEqual(toRichText('  '), [])
})

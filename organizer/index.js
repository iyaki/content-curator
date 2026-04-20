import { Client } from '@notionhq/client'
import OpenAI from 'openai'
import 'dotenv/config'

const TRIAGE_DATABASE_ID = process.env.TRIAGE_DATABASE_ID
const KNOWLEDGE_BASE_DATASOURCE_ID = 'e1a982ac-2c77-40d9-8783-50e1646af757'

if (!TRIAGE_DATABASE_ID) {
	console.error('TRIAGE_DATABASE_ID is not defined in environment variables.')
	process.exit(1)
}

const notion = new Client({
	auth: process.env.NOTION_TOKEN,
	notionVersion: '2025-09-03',
})

const openai = new OpenAI({
	apiKey: process.env.OPENAI_API_KEY,
})

// Categories are now fetched dynamically
let databaseSchema = null

export async function organize() {
	console.log('Starting organization process...')

	// Fetch schema first
	databaseSchema = await getDatabaseSchema()
	console.log('Fetched database schema properties:', Object.keys(databaseSchema).join(', '))

	const unclassifiedArticles = await fetchUnclassifiedArticles()
	console.log(`Found ${unclassifiedArticles.length} unclassified articles.`)

	for (const article of unclassifiedArticles) {
		try {
			await processArticle(article)
		} catch (error) {
			console.error(`Failed to process article ${article.id}:`, error)
		}
	}

	console.log('Organization process finished.')
}

async function getDatabaseSchema() {
	try {
		const dataSource = await notion.dataSources.retrieve({ data_source_id: KNOWLEDGE_BASE_DATASOURCE_ID })
		const properties = {}

		for (const [name, prop] of Object.entries(dataSource.properties)) {
			// We only care about Select and Multi-select for classification for now
			if (prop.type === 'select' || prop.type === 'multi_select') {
				properties[name] = {
					type: prop.type,
					options: prop[prop.type]?.options?.map(opt => opt.name) || []
				}
			}
		}
		return properties
	} catch (error) {
		if (error.code === 'object_not_found') {
			console.error(`Error: Could not access Knowledge Base Database. Make sure the integration is connected to it.`)
			process.exit(1)
		}
		throw error
	}
}

async function fetchUnclassifiedArticles() {
	// Fetch the data source ID from the triage database
	const database = await notion.databases.retrieve({ database_id: TRIAGE_DATABASE_ID })
	if (!database.data_sources || database.data_sources.length === 0) {
		throw new Error(`No data sources found in triage database ${TRIAGE_DATABASE_ID}`)
	}
	const triageDataSourceId = database.data_sources[0].id

	const results = await notion.dataSources.query({
		data_source_id: triageDataSourceId,
		page_size: 10,
	})
	return results.results
}

async function processArticle(article) {
	const title = article.properties.Name?.title[0]?.plain_text || 'Untitled'
	const url = article.properties.URL?.url

	if (!url) {
		console.log(`Skipping article ${article.id} (No URL)`)
		return
	}

	console.log(`Processing: ${title} (${url})`)

	const blocks = await getAllPageBlocks(article.id)
	const content = extractTextFromBlocks(blocks)

	const classification = await classifyArticle(title, url, content)
	console.log(`Classification result:`, JSON.stringify(classification, null, 2))

	await copyAndDeletePage(article, classification, blocks)
}

async function getAllPageBlocks(pageId) {
	let allBlocks = []
	let cursor = undefined
	try {
		do {
			const response = await notion.blocks.children.list({
				block_id: pageId,
				start_cursor: cursor,
			})
			allBlocks.push(...response.results)
			cursor = response.next_cursor
		} while (cursor)

		// Recursively fetch children for tables
		for (const block of allBlocks) {
			if (block.has_children && block.type === 'table') {
				block.table.children = await getAllPageBlocks(block.id)
			}
		}
	} catch (error) {
		console.warn(`Failed to fetch blocks for page ${pageId}:`, error.message)
	}
	return allBlocks
}

function sanitizeBlocks(blocks) {
	return blocks.flatMap(block => {
		// We only copy supported block types and strip metadata
		if (!block[block.type]) return []

		// Skip unsupported types for creation via API if necessary
		if (['child_page', 'child_database', 'unsupported'].includes(block.type)) return []

		// Fix for image blocks: ensure they have a valid object
		if (block.type === 'image') {
			if (block.image.type === 'external') {
				return [sanitizeNotionValue({ type: 'image', image: { external: { url: block.image.external.url } } })]
			}
			if (block.image.type === 'file') {
				// Files hosted by Notion expire, so we might lose them if we don't re-upload
				// For now, we skip internal files to avoid errors
				return []
			}
		}

		const blockContent = { ...block[block.type] }

		// Sanitize rich_text links
		if (blockContent.rich_text) {
			blockContent.rich_text = blockContent.rich_text.map(textItem => {
				if (textItem.href) {
					try {
						const url = new URL(textItem.href)
						if (!['http:', 'https:'].includes(url.protocol)) {
							throw new Error('Invalid protocol')
						}
					} catch (e) {
						// Invalid URL, remove href and link
						const { href, ...rest } = textItem
						if (rest.text && rest.text.link) {
							const { link, ...textRest } = rest.text
							return { ...rest, text: textRest }
						}
						return rest
					}
				}
				return textItem
			})
		}

		// Handle long text blocks (Notion limit: 2000 characters)
		if (blockContent.rich_text && blockContent.rich_text.length === 1) {
			const textItem = blockContent.rich_text[0]
			if (textItem.type === 'text' && textItem.text.content.length > 2000) {
				const chunks = textItem.text.content.match(/[\s\S]{1,2000}/g) || []
				return chunks.map(chunk => sanitizeNotionValue({
					type: block.type,
					[block.type]: {
						...blockContent,
						rich_text: [{ type: 'text', text: { content: chunk } }]
					}
				}))
			}
		}

		// Recursively sanitize children (e.g. for tables)
		if (blockContent.children) {
			blockContent.children = sanitizeBlocks(blockContent.children)
		}

		return [sanitizeNotionValue({
			type: block.type,
			[block.type]: blockContent
		})]
	})
}

function sanitizeNotionValue(value) {
	if (Array.isArray(value)) {
		return value
			.map(item => sanitizeNotionValue(item))
			.filter(item => item !== undefined)
	}

	if (value && typeof value === 'object') {
		const sanitizedEntries = Object.entries(value)
			.map(([key, nestedValue]) => [key, sanitizeNotionValue(nestedValue)])
			.filter(([, nestedValue]) => nestedValue !== undefined)

		if (sanitizedEntries.length === 0) {
			return undefined
		}

		return Object.fromEntries(sanitizedEntries)
	}

	if (value === null || value === undefined) {
		return undefined
	}

	return value
}

function extractTextFromBlocks(blocks) {
	return blocks
		.slice(0, 20) // Limit to first 20 blocks for the prompt
		.map(block => {
			if (block.type === 'paragraph' && block.paragraph.rich_text.length > 0) {
				return block.paragraph.rich_text.map(t => t.plain_text).join('')
			}
			if (block.type === 'heading_1' && block.heading_1.rich_text.length > 0) {
				return '# ' + block.heading_1.rich_text.map(t => t.plain_text).join('')
			}
			if (block.type === 'heading_2' && block.heading_2.rich_text.length > 0) {
				return '## ' + block.heading_2.rich_text.map(t => t.plain_text).join('')
			}
			if (block.type === 'heading_3' && block.heading_3.rich_text.length > 0) {
				return '### ' + block.heading_3.rich_text.map(t => t.plain_text).join('')
			}
			if (block.type === 'bulleted_list_item' && block.bulleted_list_item.rich_text.length > 0) {
				return '- ' + block.bulleted_list_item.rich_text.map(t => t.plain_text).join('')
			}
			return ''
		})
		.filter(text => text.length > 0)
		.join('\n')
		.substring(0, 2000)
}

async function classifyArticle(title, url, content) {
	const schemaDescription = Object.entries(databaseSchema)
		.map(([name, details]) => {
			return `- ${name} (${details.type}): [${details.options.join(', ')}]`
		})
		.join('\n')

	const prompt = `
You are a helpful assistant that categorizes technical articles.
I have a Notion database with the following classification properties:

${schemaDescription}

Please analyze the following article and determine the best values for these properties.
Title: ${title}
URL: ${url}

Content Snippet:
${content}

Return a JSON object with the following keys:
- Property names (keys) and selected option(s) (values).
- "Emoji": A single emoji representing the article.
- "CoverKeyword": A single English keyword representing the topic (for image search).

For 'multi_select', return an array of strings. For 'select', return a single string.
Only use the provided options for properties.

Avoid adding the "Article" Category along with "Tool" or "Service".

Example JSON output:
{
  "Category": ["Tool"],
  "Language": "JavaScript",
  "Emoji": "🛠️",
  "CoverKeyword": "coding"
}
`

	const completion = await openai.chat.completions.create({
		messages: [{ role: "user", content: prompt }],
		model: "gpt-4o-mini",
		response_format: { type: "json_object" }
	})

	return JSON.parse(completion.choices[0].message.content)
}

async function copyAndDeletePage(originalPage, classification, blocks) {
	const propertiesToUpdate = {
		Name: originalPage.properties.Name, // Preserve Title
		URL: originalPage.properties.URL,   // Preserve URL
	}

	for (const [name, value] of Object.entries(classification)) {
		if (name === 'Emoji' || name === 'CoverKeyword') continue

		const schema = databaseSchema[name]
		if (!schema) continue

		if (schema.type === 'select') {
			propertiesToUpdate[name] = { select: { name: value } }
		} else if (schema.type === 'multi_select') {
			propertiesToUpdate[name] = { multi_select: value.map(v => ({ name: v })) }
		}
	}

	// Sanitize blocks for creation
	const children = sanitizeBlocks(blocks)

	const pageParams = {
		parent: { data_source_id: KNOWLEDGE_BASE_DATASOURCE_ID },
		properties: propertiesToUpdate,
		children: children.slice(0, 100)
	}

	if (classification.Emoji) {
		pageParams.icon = { type: "emoji", emoji: classification.Emoji }
	}

	if (classification.CoverKeyword) {
		pageParams.cover = { type: "external", external: { url: `https://loremflickr.com/1200/600/${classification.CoverKeyword}` } }
	}

	const newPage = await notion.pages.create(pageParams)
	console.log(`Created new page ${newPage.id} in Knowledge Base.`)

	// Append remaining blocks in batches of 100
	if (children.length > 100) {
		const remainingBlocks = children.slice(100)
		for (let i = 0; i < remainingBlocks.length; i += 100) {
			const batch = remainingBlocks.slice(i, i + 100)
			await notion.blocks.children.append({
				block_id: newPage.id,
				children: batch
			})
			console.log(`Appended batch ${i / 100 + 1} of remaining blocks.`)
		}
	}

	await notion.pages.update({
		page_id: originalPage.id,
		archived: true,
	})
	console.log(`Archived original page ${originalPage.id}.`)
}

// Auto-run if executed directly
if (process.argv[1] === import.meta.filename) {
	organize()
}

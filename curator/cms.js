import { Client } from '@notionhq/client'
import { getComment } from './commentator.js'

const DATA_SOURCE_ID = 'e1a982ac-2c77-40d9-8783-50e1646af757'

const notion = new Client({
	auth: process.env.NOTION_TOKEN,
})

export async function getNewArticle(lastArticleId) {
	const notionArticle = await fetchArticleFromNotion(lastArticleId)

	if (notionArticle === null) {
		return null
	}

	return await extractArticleData(notionArticle)
}

async function fetchArticleFromNotion(startCursor) {
	const results = await notion.dataSources.query({
		data_source_id: DATA_SOURCE_ID,
		page_size: 2,
		start_cursor: startCursor,
		sorts: [{
			timestamp: 'created_time',
			direction: 'ascending',
		}],
		filter: {
			and: [
				{
					property: "Category",
					multi_select: {
						does_not_contain: "Tool",
					},
				},
				{
					property: "Category",
					multi_select: {
						does_not_contain: "Service",
					},
				},
				{
					property: "Category",
					multi_select: {
						does_not_contain: "Website",
					},
				},
				{
					property: "Category",
					multi_select: {
						does_not_contain: "Note",
					},
				},
				{
					property: "Category",
					multi_select: {
						does_not_contain: "Framework/Library",
					},
				},
				{
					property: "Category",
					multi_select: {
						does_not_contain: "Game",
					},
				},
			]
		}
	})

	if (results.results.length < 2) {
		return null
	}

	return results.results[1]
}

async function extractArticleData(article) {
	return {
		id: article.id,
		title: article.properties.Name.title[0].plain_text,
		url: article.properties.URL.url,
		comment: await getArticleComment(article.id),
	}
}

async function getArticleComment(notionPageId) {
	const excerpt = await getArticleExcerpt(notionPageId)

	return await getComment(excerpt)
}

async function getArticleExcerpt(notionPageId) {
	const blocks = await retrievePageBlocks(notionPageId)

	let excerpt = ''

	for (let block of blocks) {
		if (block.type !== 'paragraph') {
			continue
		}

		excerpt += block.paragraph.rich_text.map(rt => rt.plain_text).join('')
	}

	return excerpt
}

async function retrievePageBlocks(notionPageId) {
	const results = await notion.blocks.children.list({
		block_id: notionPageId,
		page_size: 15,
	})

	return results.results
}

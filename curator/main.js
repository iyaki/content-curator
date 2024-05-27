
import fs from 'fs'
import { getNewArticle } from './cms.js'
import { addArticle } from './webpage.js';

const LAST_ARTICLE_PATH = './data/last_article.txt'

console.log('Starting curator')

let existNewArticles = false

let lastArticleId = fs.readFileSync(LAST_ARTICLE_PATH, { encoding: 'utf8' }).trim()
for (let i = 1; i <= 3; ++i) {
	const newArticle = await getNewArticle(lastArticleId)

	if (newArticle === null) {
		break
	}

	existNewArticles = true
	addArticle(newArticle)
	lastArticleId = newArticle.id

	console.log(`Added ${i} articles`)
}


if (existNewArticles) {
	console.log('Updating last_article.txt')
	fs.writeFileSync(LAST_ARTICLE_PATH, lastArticleId);
}

console.log('Curator finished')

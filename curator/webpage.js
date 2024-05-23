import fs from 'fs'

// TODO: Agregar propagandas

const DESTINATION_DIR = '../web/src/entries'

const HTML_TEMPLATE = fs.readFileSync('./templates/entry.html', { encoding: 'utf8' })

export function addArticle(articleData) {
	fs.writeFileSync(
		`${DESTINATION_DIR}/${articleData.id}.html`,
		hydrateTemplate(articleData)
	);
}

function hydrateTemplate(articleData) {
	return HTML_TEMPLATE
		.replace('{{articleTitle}}', articleData.title)
		.replace('{{articleLink}}', articleData.url)
		.replace('{{articleComment}}', articleData.comment)
}

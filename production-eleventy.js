import postcss from 'postcss'
import postcssPresetEnv from 'postcss-preset-env'
import cssnano from 'cssnano'
import htmlSyntax from 'postcss-html'
import { minify as minifyHtml } from 'html-minifier-terser'

function getPostCss() {
	const postCssConfig = [
		postcssPresetEnv({
			minimumVendorImplementations: 3,
			features: {
				'nesting-rules': true,
			}
		}),
		cssnano(),
	]

	return postcss(postCssConfig)
}

/** @param {import("@11ty/eleventy").UserConfig} eleventyConfig */
export default function(eleventyConfig) {
	eleventyConfig.addTemplateFormats('css')

	eleventyConfig.addExtension('css', {
		outputFileExtension: 'css',

		compile: async (content, from) => {
			return async () => {
				return process.env.ELEVENTY_RUN_MODE === 'build' ?
					(await getPostCss().process(content, { from })).css :
					content
			}
		}
	})

	eleventyConfig.addTransform('minify html', async function(content) {
		if (process.env.ELEVENTY_RUN_MODE !== 'build') {
			return content
		}

		if( !(this.page.outputPath && this.page.outputPath.endsWith(".html")) ) {
			return content
		}

		// Process and minify inline CSS
		content = (
			await getPostCss()
				.process(content, {from: this.inputPath, syntax: htmlSyntax})
		).css

		content = await minifyHtml(content, {
			minifyJS: true,
			removeComments: true,
			removeRedundantAttributes: true,
			removeScriptTypeAttributes: true,
			removeStyleLinkTypeAttributes: true,
		})

		return content
	})

	eleventyConfig.addTransform('minify xml', async function(content) {
		if (process.env.ELEVENTY_RUN_MODE !== 'build') {
			return content
		}

		if( !(this.page.outputPath && this.page.outputPath.endsWith(".xml")) ) {
			return content
		}

		const xmlMinifier = await import('minify-xml')

		return xmlMinifier.minify(content)
	})
}

import ProductionConfigs from './production-eleventy.js'

/** @param {import("@11ty/eleventy").UserConfig} eleventyConfig */
export default function(eleventyConfig) {
	const BASE_PATH = 'web'

	eleventyConfig.addPlugin(ProductionConfigs)

	eleventyConfig.addPassthroughCopy(BASE_PATH + '/images')
	eleventyConfig.addPassthroughCopy(BASE_PATH + '/**/*.{png,jpg,jpeg,svg,webp,avif}')

	return {
		dir: {
			input: BASE_PATH,
		}
	}
};

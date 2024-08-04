/** @param {import("@11ty/eleventy").UserConfig} eleventyConfig */
module.exports = eleventyConfig => {
	const BASE_PATH = 'web';

	eleventyConfig.addPlugin(require('./production-eleventy.js'));

	eleventyConfig.addPassthroughCopy(BASE_PATH + '/images')
	eleventyConfig.addPassthroughCopy(BASE_PATH + '/**/*.{png,jpg,jpeg,svg,webp,avif}')

	return {
		dir: {
			input: BASE_PATH,
		}
	}
};

export default function() {
	return {
		ELEVENTY_RUN_MODE: process.env.ELEVENTY_RUN_MODE,
		DATE_NOW: new Date(),
	}
}

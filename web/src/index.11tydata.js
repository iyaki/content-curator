const fs = require('fs')
const ENTRIES_PATH = __dirname + '/entries'

module.exports = function() {
	let dateLastEntry
	fs.readdir(ENTRIES_PATH, (_, list) => {
		dateLastEntry = list.reduce((newer, file) => {
			const date = (fs.statSync(ENTRIES_PATH + '/' + file)).birthtime
			return newer > date ? newer : date
		})
	})

	return {
		date: dateLastEntry,
	}
}

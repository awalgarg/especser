var jspm = require('jspm');
var fs = require('fs');
var less = require('less');
jspm.setPackagePath('.');
jspm.bundleSFX('src/index', 'dist/index.js', {
	minify: true,
	mangled: true
}).then(function () {
	console.log('jspm bundling complete, adding localforage');
}).then(function () {
	fs.writeFileSync(
		'dist/index.js',
		Buffer.concat([
			fs.readFileSync('./src/mod/localforage.min.js'),
			fs.readFileSync('./dist/index.js')
		])
	);
}).then(function () {
	less.render(
		[
			fs.readFileSync('./src/css/layout.css') + '',
			fs.readFileSync('./src/css/content.css') + ''
		].join('\n'),
		{
			fileName: 'build.css',
			compress: 'true'
		}
	).then(function (output) {
		fs.writeFileSync(
			'dist/build.css',
			output.css
		);
		console.log('bundled css. finished build');
	});
});
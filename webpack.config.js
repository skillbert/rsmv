const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');

/**
 * @type {import("webpack").Configuration}
 */
module.exports = {
	devtool: false,
	mode: "development",
	entry: {
		main: "./src/main.ts",
		electronviewer: "./src/viewer/",
		extract: "./src/scripts/extractfiles.ts",
		indexoverview: "./src/scripts/indexoverview.ts",
		testdecode: "./src/scripts/testdecode.ts",
		opcode_reader: "./src/opcode_reader.ts",
		skeleton: "./src/scripts/testskeletons.ts",
		material: "./src/scripts/testmats.ts",
		diff: "./src/scripts/cachediff.ts",
		deps: "./src/scripts/dependencies.ts",
		quickchatlookup: "./src/scripts/quickchatlookup.ts",
		scrapeavatars: "./src/scripts/scrapeavatars.ts",
		searchmap: "./src/scripts/searchmap.ts",
		maprender: "./src/map/",
		runmap: "./src/map/run.ts"
	},
	module: {
		rules: [
			{
				test: /\.tsx?$/,
				use: 'ts-loader',
				exclude: /node_modules/,
			},
			{
				test: /\.jsonc?$/,
				type: "asset/source"
			}
		],
	},
	target: "node",
	externals: {
		// "fs", "net", "path", "os", "util", "assert",
		"sqlite3": { commonjs: "sqlite3" },
		"electron": { commonjs: "electron" },
		"electron/main": { commonjs: "electron/main" },
		"electron/renderer": { commonjs: "electron/renderer" },
		"sharp": { commonjs: "sharp" },
		"zlib": { commonjs: "zlib" },
		"lzma": { commonjs: "lzma" },
		"cmd-ts": { commonjs: "cmd-ts" },
		"comment-json": { commonjs: "comment-json" }
	},
	resolve: {
		extensions: ['.tsx', '.ts', '.js'],
	},
	externalsType: "commonjs",
	output: {
		libraryTarget: "commonjs",
		filename: '[name].js',
		path: path.resolve(__dirname, 'dist'),
	},
	plugins: [
		new CopyWebpackPlugin({
			patterns: [
				{ from: 'src/assets', to: "assets" },
				{ from: 'src/opcodes', to: "opcodes" }
			]
		})
	]
};
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
		cli: "./src/cli.ts",
		// opcode_reader: "./src/opcode_reader.ts",
		// searchmap: "./src/scripts/searchmap.ts",
		buildfiletypes: "./src/buildfiletypes.ts",
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
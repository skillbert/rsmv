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
		buildfiletypes: "./src/buildfiletypes.ts",
		maprender: "./src/map/",
		runmap: "./src/map/run.ts",
		headless: "./src/headless/",
		runheadless: "./src/headless/runelectron.ts",
		runbrowser: "./src/headless/runbrowser.ts"
	},
	module: {
		rules: [
			{
				test: /\.tsx?$/,
				loader: 'ts-loader',
				exclude: /node_modules/,
				options: {
					onlyCompileBundledFiles: true
				}
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
		"comment-json": { commonjs: "comment-json" },
		"gl": { commonjs: "gl" },
		"canvas": { commonjs: "canvas" }
	},
	resolve: {
		extensions: ['.tsx', '.ts', '.js'],
	},
	externalsType: "commonjs",
	output: {
		libraryTarget: "commonjs",
		filename: "[name].js",
		chunkFilename: "[contenthash].js",
		path: path.resolve(__dirname, 'dist')
	},
	plugins: [
		new CopyWebpackPlugin({
			patterns: [
				{ from: 'src/assets', to: "assets" }
			]
		})
	]
};
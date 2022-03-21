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
		// viewer: "./src/viewer/",
		extract: "./src/scripts/extractfiles.ts",
		indexoverview: "./src/scripts/indexoverview.ts",
		testdecode: "./src/scripts/testdecode.ts"
	},
	module: {
		rules: [
			{
				test: /\.tsx?$/,
				use: 'ts-loader',
				exclude: /node_modules/,
			},
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
		"lzma": { commonjs: "lzma" }
	},
	resolve: {
		extensions: ['.tsx', '.ts', '.js'],
	},
	externalsType: "commonjs",
	output: {
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
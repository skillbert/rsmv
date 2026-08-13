const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const ForkTsCheckerWebpackPlugin = require('fork-ts-checker-webpack-plugin');

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
		api: "./src/headless/api",
		buildfiletypes: "./src/buildfiletypes.ts",
		maprender: "./src/map/mapcli.ts",
		runbrowser: "./src/headless/runbrowser.ts"
	},
	module: {
		rules: [
			{
				test: /\.tsx?$/,
				use: {
					loader: 'swc-loader',
					options: {
						env: {
							targets: "last 5 chrome versions",
						},
						jsc: {
							parser: {
								syntax: 'typescript',
								tsx: true,
								decorators: true
							},
							transform: {
								react: {
									runtime: 'automatic'
								}
							}
						}
					}
				}
			},
			{
				test: /\.jsonc?$/,
				type: "asset/source"
			},
			{
				test: /\.glsl(\.c)?$/,
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
		chunkFilename: "generated/[contenthash].js",
		assetModuleFilename: "generated/[contenthash][ext]",
		webassemblyModuleFilename: "generated/[contenthash][ext]",
		path: path.resolve(__dirname, 'dist')
	},
	plugins: [
		new ForkTsCheckerWebpackPlugin(),
		new CopyWebpackPlugin({
			patterns: [
				{ from: 'src/assets', to: "assets" },
				// special case for sql.js wasm, webpack is choking on it otherwise
				{ from: 'node_modules/sql.js/dist/sql-wasm-workerfs.wasm', to: "generated/sql-wasm-workerfs.wasm" }
			]
		})
	]
};
const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const { ProvidePlugin, HotModuleReplacementPlugin } = require('webpack');

/**
 * @type {import("webpack").Configuration}
 */
module.exports = {
	devtool: false,
	mode: "development",
	entry: {
		webviewer: {
			import: "./src/viewer/",
			library: {
				type: "umd",
				name: { root: "RSMV", amd: "rsmv", commonjs: "rsmv" }
			}
		},
		webapi: {
			import: "./src/headless/api.ts",
			library: {
				type: "umd",
				name: { root: "RSMVApi", amd: "rsmv-api", commonjs: "rsmv-api" }
			}
		}
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
			},
			{
				test: /\.glsl(\.c)?$/,
				type: "asset/source"
			}
		],
	},
	target: "web",
	devServer: {
		static: "./dist",
		hot: true,
		port: 8081
	},
	resolve: {
		extensions: ['.tsx', '.ts', '.js'],
		alias: {
			fs: false,
			path: false,
			crypto: false,
			sharp: false,
			net: false,
			sqlite3: false,
			process: require.resolve('process/browser'),
			"electron/renderer": false
		},
		fallback: {
			buffer: require.resolve('buffer/'),//weird slash needed to import npm buffer instead of node buffer
			zlib: require.resolve('browserify-zlib'),
			util: require.resolve('util/'),
			assert: require.resolve('assert/'),
			stream: require.resolve('stream-browserify'),
		}
	},
	output: {
		filename: "[name].js",
		chunkFilename: "generated/[contenthash].js",
		assetModuleFilename: "generated/[contenthash][ext]",
		webassemblyModuleFilename: "generated/[contenthash][ext]",
		path: path.resolve(__dirname, 'dist')
	},
	plugins: [
		new CopyWebpackPlugin({
			patterns: [
				{ from: 'src/assets', to: "assets" }
			]
		}),
		new ProvidePlugin({
			Buffer: ['buffer', 'Buffer'],
			process: [require.resolve('process/browser')]
		})
	]
};
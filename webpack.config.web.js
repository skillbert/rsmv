const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const { ProvidePlugin } = require('webpack');

/**
 * @type {import("webpack").Configuration}
 */
module.exports = {
	devtool: false,
	mode: "development",
	entry: {
		viewer: "./src/viewer/",
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
	target: "web",
	externals: {
		// "sharp": { commonjs: "sharp" },
		// "lzma": { commonjs: "lzma" }
	},
	resolve: {
		extensions: ['.tsx', '.ts', '.js'],
		alias: {
			fs: false,
			path: false,
			crypto: false,
			sharp: false,
			process: require.resolve('process/browser')
		},
		fallback: {
			buffer: require.resolve('buffer/'),//weird slash needed to import npm buffer instead of node buffer
			zlib: require.resolve('browserify-zlib'),
			util: require.resolve('util/'),
			assert: require.resolve('assert/'),
			stream: require.resolve('stream-browserify'),
		}
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
		}),
		new ProvidePlugin({
			Buffer: ['buffer', 'Buffer'],
			process: [require.resolve('process/browser')]
		}),
	]
};
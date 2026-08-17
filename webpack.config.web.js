const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const { ProvidePlugin, HotModuleReplacementPlugin } = require('webpack');
const ForkTsCheckerWebpackPlugin = require('fork-ts-checker-webpack-plugin');

/**
 * @param {Record<string,string>} env
 * @returns {import("webpack").Configuration}
 */
module.exports = (env) => {
	const isDevServer = !!env?.WEBPACK_SERVE;
	return {
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
		target: "web",
		devServer: {
			static: "./dist",
			hot: false,
			// hot: true,
			port: 8081,
			client: false
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
			chunkFilename: isDevServer ? "generated/[name].js" : "generated/[contenthash].js",
			assetModuleFilename: isDevServer ? "generated/[name][ext]" : "generated/[contenthash][ext]",
			webassemblyModuleFilename: isDevServer ? "generated/[name][ext]" : "generated/[contenthash][ext]",
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
			}),
			new ProvidePlugin({
				Buffer: ['buffer', 'Buffer'],
				process: [require.resolve('process/browser')]
			})
		]
	};
};
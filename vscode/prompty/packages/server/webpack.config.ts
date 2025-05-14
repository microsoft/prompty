'use strict';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require('path');


/**@type {import('webpack').Configuration}*/
const config = {
	target: 'node',
	node: {
		__dirname: false,
		__filename: false,
	},
	entry: {
		server: './src/server.ts',
	},
	output: {
		path: path.resolve(__dirname, 'out'),
		filename: '[name].js',
		libraryTarget: 'commonjs2',
		devtoolModuleFilenameTemplate: '../[resource-path]',
	},
	devtool: 'source-map',
	externals: {
		vscode: 'commonjs vscode',
	},
	resolve: {
		extensions: ['.ts', '.js'],
	},
	module: {
		unknownContextCritical: false,
		rules: [
			{
				test: /\.ts$/,
				exclude: /node_modules/,
				use: [
					{
						loader: 'ts-loader',
					},
				],
			},
			{
				test: /node_modules[\\|/](vscode-json-languageservice)/,
				use: { loader: 'umd-compat-loader' },
			},
		],
	},
};

module.exports = [config];
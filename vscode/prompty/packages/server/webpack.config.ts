// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT license.

//@ts-check

'use strict';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const path = require('path');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const webpack = require('webpack');

/**@type {import('webpack').Configuration}*/
const config = {
  target: 'node', // vscode extensions run in a Node.js-context 📖 -> https://webpack.js.org/configuration/node/
  node: {
    __dirname: false,
    __filename: false,
  },
  entry: {    
    server: './src/server.ts',
  },
  output: {
    // the bundle is stored in the 'dist' folder (check package.json), 📖 -> https://webpack.js.org/configuration/output/
    path: path.resolve(__dirname, 'out'),
    filename: '[name].js',
    libraryTarget: 'commonjs2',
    devtoolModuleFilenameTemplate: '../[resource-path]',
  },
  devtool: 'source-map',
  externals: {
    vscode: 'commonjs vscode', // the vscode-module is created on-the-fly and must be excluded. Add other modules that cannot be webpack'ed, 📖 -> https://webpack.js.org/configuration/externals/
    // prettier: 'commonjs prettier',
  },
  resolve: {
    // support reading TypeScript and JavaScript files, 📖 -> https://github.com/TypeStrong/ts-loader
    extensions: ['.ts', '.js'],
  },
  module: {
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

// /**@type {import('webpack').Configuration}*/
// const clientWeb = {
//   mode: 'none', // this leaves the source code as close as possible to the original (when packaging we set this to 'production')
//   target: 'webworker', // extensions run in a webworker context
//   entry: {
//     'extension-web': './src/webworker/yamlClientMain.ts',
//   },
//   output: {
//     filename: 'extension-web.js',
//     path: path.join(__dirname, './dist'),
//     libraryTarget: 'commonjs',
//     devtoolModuleFilenameTemplate: '../[resource-path]',
//   },
//   resolve: {
//     mainFields: ['module', 'main'],
//     extensions: ['.ts', '.js'], // support ts-files and js-files
//     alias: {
//       'node-fetch': 'whatwg-fetch',
//       'object-hash': 'object-hash/dist/object_hash.js',
//     },
//     fallback: {
//       path: require.resolve('path-browserify'),
//       'node-fetch': require.resolve('whatwg-fetch'),
//       util: require.resolve('util'),
//       fs: false,
//     },
//   },
//   module: {
//     rules: [
//       {
//         test: /\.ts$/,
//         exclude: /node_modules/,
//         use: [
//           {
//             // configure TypeScript loader:
//             // * enable sources maps for end-to-end source maps
//             loader: 'ts-loader',
//             options: {
//               compilerOptions: {
//                 sourceMap: true,
//                 declaration: false,
//               },
//             },
//           },
//         ],
//       },
//     ],
//   },
//   plugins: [
//     new webpack.ProvidePlugin({
//       process: path.resolve(path.join(__dirname, 'node_modules/process/browser.js')), // provide a shim for the global `process` variable
//     }),
//   ],
//   externals: {
//     vscode: 'commonjs vscode', // ignored because it doesn't exist
//   },
//   performance: {
//     hints: false,
//   },
//   devtool: 'nosources-source-map',
// };

// /**@type {import('webpack').Configuration}*/
// const serverWeb = {
//   mode: 'none', // this leaves the source code as close as possible to the original (when packaging we set this to 'production')
//   target: 'webworker', // extensions run in a webworker context
//   entry: {
//     'languageserver-web': './node_modules/yaml-language-server/lib/esm/webworker/yamlServerMain',
//   },
//   output: {
//     filename: 'languageserver-web.js',
//     path: path.join(__dirname, './dist'),
//     libraryTarget: 'var',
//     library: 'serverExportVar',
//     devtoolModuleFilenameTemplate: '../[resource-path]',
//   },
//   resolve: {
//     mainFields: ['browser', 'module', 'main'],
//     extensions: ['.ts', '.js'], // support ts-files and js-files
//     alias: {
//       './services/yamlFormatter': path.resolve(__dirname, './build/polyfills/yamlFormatter.js'), // not supported for now. prettier can run in the web, but it's a bit more work.
//       'vscode-json-languageservice/lib/umd': 'vscode-json-languageservice/lib/esm',
//     },
//     fallback: {
//       path: require.resolve('path-browserify/'),
//       url: require.resolve('url/'),
//       buffer: require.resolve('buffer/'),
//       fs: false,
//     },
//   },
//   plugins: [
//     new webpack.ProvidePlugin({
//       process: path.resolve(path.join(__dirname, 'node_modules/process/browser.js')), // provide a shim for the global `process` variable
//     }),
//   ],
//   module: {},
//   externals: {},
//   performance: {
//     hints: false,
//   },

//   devtool: 'nosources-source-map',
// };

module.exports = [config/*, clientWeb, serverWeb*/];
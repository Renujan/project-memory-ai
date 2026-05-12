const path = require('path');

/** @type {import('webpack').Configuration} */
module.exports = {
  mode: 'none',
  target: 'node',
  entry: {
    extension: './src/extension.ts'
  },
  output: {
    filename: '[name].js',
    path: path.join(__dirname, 'dist'),
    libraryTarget: 'commonjs'
  },
  resolve: {
    mainFields: ['module', 'main'],
    extensions: ['.ts', '.js']
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          {
            loader: 'ts-loader'
          }
        ]
      }
    ]
  },
  externals: {
    vscode: 'commonjs vscode'
  },
  devtool: 'nosources-source-map',
};

const path = require('path');

module.exports = {
  mode: 'production',
  entry: './index.js',
  devtool: 'inline-source-map',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'shepherd-client.bundle.js',
    libraryTarget: 'window'
  }
};

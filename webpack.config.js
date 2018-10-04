const path = require('path');

module.exports = {
  mode: 'production',
  entry: './index.js',
  output: {
    path: path.resolve(__dirname, '..', 'static'),
    filename: 'shepherd.bundle.js'
  }
};

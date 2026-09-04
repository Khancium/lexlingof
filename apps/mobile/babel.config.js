// As of Expo SDK 57, babel-preset-expo auto-configures the Reanimated /
// react-native-worklets Babel plugin whenever the library is installed --
// do not add 'react-native-worklets/plugin' manually here, that would
// double-apply the transform.
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [['@babel/plugin-proposal-decorators', { legacy: true }]],
  };
};

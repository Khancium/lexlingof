// As of Expo SDK 57, babel-preset-expo auto-configures the Reanimated /
// react-native-worklets Babel plugin whenever the library is installed --
// do not add 'react-native-worklets/plugin' manually here, that would
// double-apply the transform.
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      ['@babel/plugin-proposal-decorators', { legacy: true }],
      // WatermelonDB's @field/@date/@readonly decorators require legacy
      // decorator semantics for class properties; without loose mode here,
      // Babel's spec-mode class-fields transform rejects TS definite-
      // assignment fields (`x!: string`) used by every model, only in
      // release/production bundling (dev bundling didn't exercise this path).
      ['@babel/plugin-transform-class-properties', { loose: true }],
      // loose mode must match across all three of these or Babel throws --
      // adding class-properties above pulled these into scope too, since
      // some dependencies (e.g. @tanstack/query-core) use private class
      // fields/methods.
      ['@babel/plugin-transform-private-methods', { loose: true }],
      ['@babel/plugin-transform-private-property-in-object', { loose: true }],
    ],
  };
};

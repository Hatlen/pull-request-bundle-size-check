const compareAssets = require('./compareAssets');

describe('compareAssets', () => {
  test('transforms two stats.json objects to a diff array', () => {
    const assetsBefore = [
      {
        name: 'increased-bundle.js',
        size: 1,
      },
      {
        name: 'shrunk-bundle.js',
        size: 20,
      },
      {
        name: 'removed-bundle.js',
        size: 1000,
      },
    ];
    const assetsAfter = [
      {
        name: 'increased-bundle.js',
        size: 2,
      },
      {
        name: 'shrunk-bundle.js',
        size: 10,
      },
      {
        name: 'new-bundle.js',
        size: 100,
      },
    ];

    expect(compareAssets(assetsBefore, assetsAfter)).toEqual([
      {
        name: 'increased-bundle.js',
        change: 1,
        newSize: 2,
        oldSize: 1,
        type: 'bigger',
      },
      {
        name: 'shrunk-bundle.js',
        change: -10,
        newSize: 10,
        oldSize: 20,
        type: 'smaller',
      },
      {
        name: 'new-bundle.js',
        change: 100,
        newSize: 100,
        oldSize: 0,
        type: 'new',
      },
      {
        name: 'removed-bundle.js',
        change: -1000,
        newSize: 0,
        oldSize: 1000,
        type: 'removed',
      },
    ]);
  });
});

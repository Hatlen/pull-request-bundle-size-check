const compareAssets = (oldAssets, newAssets) =>
  newAssets
    .map((newAsset) => {
      const {
        files: [name],
        size,
      } = newAsset;
      const oldAsset = oldAssets.find(asset => asset.files[0] === name);

      let type;
      if (!oldAsset) {
        type = 'new';
      } else if (oldAsset.size === size) {
        type = 'unchanged';
      } else if (oldAsset.size > size) {
        type = 'smaller';
      } else {
        type = 'bigger';
      }

      let change;
      if (oldAsset && newAsset) {
        change = size - oldAsset.size;
      } else {
        change = size;
      }

      return {
        name,
        type,
        change,
        oldSize: oldAsset ? oldAsset.size : 0,
        newSize: size,
      };
    })
    .concat(oldAssets
      .filter(oldAsset => !newAssets.find(newAsset => newAsset.files[0] === oldAsset.files[0]))
      .map(oldAsset => ({
        name: oldAsset.files[0],
        change: -oldAsset.size,
        newSize: 0,
        oldSize: oldAsset.size,
        type: 'removed',
      })));

module.exports = compareAssets;

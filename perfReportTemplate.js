const HumanReadableSize = size =>
  (size >= 1000 || size <= -1000 ? `${Math.round(size / 1e3)}kB` : `${size}B`);

const cSS = `
  body, table {
    font-family: Helvetica Neue, arial;
    font-size: 20px;
  }
  table {
    width: 100%;
    text-align: right;
    border-collapse: collapse;
  }
  th, td {
    border: 1px solid black;
    padding: 5px;
  }
  th {
    font-weight: 500;
  }
  .name {
    text-align: left;
  }
  .smaller {
    color: green;
  }
  .bigger {
    color: #e60606;
  }
`;

const thead = `
  <thead>
    <tr>
      <th class="name">Bundle file name</th>
      <th>Change</th>
      <th>Now</th>
      <th>Before</th>
    </tr>
  </thead>
`;

const sizeRow = ({
  change, name, newSize, oldSize, type,
}) =>
  `
  <tr>
    <td class="name">${name}</td>
    <td class="${type}">${change > 0 ? '+' : ''}${HumanReadableSize(change)}</td>
    <td>${HumanReadableSize(newSize)}</td>
    <td><del>${HumanReadableSize(oldSize)}</del></td>
  </tr>
`;

const perfReportTemplate = ({
  branch, fileSizes, getS3Url, repo,
}) => {
  const totalChange = fileSizes.reduce((total, fileSize) => total + fileSize.change, 0);
  let description;
  if (totalChange > 0) {
    description = `The total size increased with:
      <span class="bigger">+${HumanReadableSize(totalChange)}</span>`;
  } else if (totalChange === 0) {
    description = 'The total size stayed the same, great job!!! (?)';
  } else {
    description = `The size decreased with:
      <span class="smaller">${HumanReadableSize(totalChange)}</span>, great job!!!`;
  }

  const typeOrder = ['new', 'bigger', 'smaller', 'deleted'];
  const changed = fileSizes
    .filter(fileSize => fileSize.type !== 'unchanged')
    .sort((a, b) => typeOrder.indexOf(a.type) >= typeOrder.indexOf(b.type));

  return `
    <style>${cSS}</style>
    <h1>Bundle size report for the <em>${branch}</em> branch</h1>
    <p>
      ${description}
    </p>
    <h3>Changed bundles</h3>
    <table>
      ${thead}
      <tbody>
        ${changed.map(fileSize => sizeRow(fileSize)).join('')}
      </tbody>
    </table>

    <h3>All bundles</h3>
    <table>
      ${thead}
      <tbody>
        ${fileSizes.map(fileSize => sizeRow(fileSize)).join('')}
      </tbody>
    </table>
    <h3>Details</h3>
    <ul>
      <li>
        <a href="${getS3Url({ branch, fileName: 'report.html', repo })}">
          Bundle sizes treemap (webpack-bundle-analyzer report.html)
        </a>
      </li>
      <li>
        <a href="${getS3Url({ branch, fileName: 'stats.json', repo })}">
          Webpack stats.json object
        </a>
      </li>
    </ul>
    <h3>Master branch details (for comparisons)</h3>
    <ul>
      <li>
        <a href="${getS3Url({ branch: 'master', fileName: 'report.html', repo })}">
          <del>Bundle sizes treemap (webpack-bundle-analyzer report.html)</del>
        </a>
      </li>
      <li>
        <a href="${getS3Url({ branch: 'master', fileName: 'stats.json', repo })}">
          <del>Webpack stats.json object</del>
        </a>
      </li>
    </ul>
  `;
};

module.exports = perfReportTemplate;

const debugLog = require('debug')('log');
const debugError = require('debug')('error');
// const debugInfo = require('debug')('info');
const dotenvFlow = require('dotenv-flow');
const fs = require('fs');
const HttpCors = require('http-cors');
const WebhooksApi = require('@octokit/webhooks');
const octokit = require('@octokit/rest')();
const { spawn } = require('child_process');
const rimraf = require('rimraf');
const S3 = require('aws-sdk/clients/s3');
const perfReportTemplate = require('./perfReportTemplate');
const compareAssets = require('./compareAssets');

if (process.env.NODE_ENV !== 'production') {
  dotenvFlow.config();
}

const kBSize = size => `${Math.round(size / 1e3)}KB`;
const cors = new HttpCors();

octokit.authenticate({
  type: 'token',
  token: process.env.GITHUB_PERSONAL_ACCESS_TOKEN,
});

const repoFolderLocation = ({ branch, repo }) => `${process.env.DOWNLOAD_FOLDER}/${repo}-${branch}`;

const deleteBranchFolder = ({ branch, repo }) =>
  new Promise((resolve, reject) => {
    rimraf(repoFolderLocation({ branch, repo }), (error) => {
      if (error) {
        debugError("couldn't delete a repo", error);
        reject();
        return;
      }
      resolve();
    });
  });

const logProcessOutput = (logPrefix, spawnedProcess) => {
  spawnedProcess.stdout.on('data', (data) => {
    debugLog(`"${logPrefix}" stdout: ${data}`);
  });

  spawnedProcess.stderr.on('data', (data) => {
    debugError(`"${logPrefix}" stderr: ${data}`);
  });
};

const runShellCommand = shellCommand =>
  new Promise((resolve, reject) => {
    const [command, ...commandArguments] = shellCommand.split(' ');
    const shellCommandProcess = spawn(command, commandArguments);
    logProcessOutput(shellCommand, shellCommandProcess);
    shellCommandProcess.on('close', (code) => {
      // yarn analyze exits with 1 as the exit code even though it's successful
      if (code !== 0 && !(code === 1 && shellCommand.match(/yarn analyze/))) {
        reject(new Error(`"${shellCommand}" failed with error code ${code}`));
        return;
      }
      resolve();
    });
  });

const yarnInstall = ({ branch, repo }) =>
  runShellCommand(`yarn install --cwd=${repoFolderLocation({ branch, repo })}`);

const downloadBranch = ({ branch, owner, repo }) =>
  runShellCommand(`git clone --branch ${branch} --single-branch --depth=1 git@github.com:${owner}/${repo} ${repoFolderLocation({ branch, repo })}`);

const yarnRunAnalyze = ({ branch, repo }) =>
  runShellCommand(`yarn --cwd=${repoFolderLocation({ branch, repo })} ${process.env.BUILD_AND_ANALYZE_SCRIPT}`);

const getFileSizes = ({ branch, repo }) =>
  new Promise((resolve) => {
    const branchStats = JSON.parse(fs.readFileSync(`${repoFolderLocation({ branch, repo })}/${process.env.DIST_FOLDER}/stats.json`));
    const masterStats = JSON.parse(fs.readFileSync(`${repoFolderLocation({ branch: 'master', repo })}/${process.env.DIST_FOLDER}/stats.json`));

    resolve(compareAssets(masterStats.assets, branchStats.assets));
  });

const downloadMasterBranch = ({ owner, repo }) =>
  new Promise((resolve, reject) => {
    const tasks = [deleteBranchFolder, downloadBranch, yarnInstall, yarnRunAnalyze];
    tasks
      .reduce(
        (previousPromise, task) =>
          previousPromise.then(() => task({ branch: 'master', owner, repo })),
        Promise.resolve(),
      )
      .then(resolve)
      .catch((error) => {
        debugError(error);
        reject(error);
      });
  });

const downloadMasterBranches = () =>
  new Promise((resolve, reject) => {
    process.env.MONITORED_REPOSITORIES.split(',')
      .reduce((previousPromise, repository) => {
        const [owner, repo] = repository.split('/');
        return previousPromise.then(() => downloadMasterBranch({ owner, repo }));
      }, Promise.resolve())
      .then(resolve)
      .catch(reject);
  });

// ALREADY_DOWNLOADED can be used when developing this project
if (!process.env.ALREADY_DOWNLOADED) {
  downloadMasterBranches().catch(debugError);
}

const setStatus = ({
  description, owner, repo, sha, state, targetUrl,
}) => {
  octokit.repos
    .createStatus({
      owner,
      repo,
      sha,
      state,
      description,
      target_url: targetUrl,
      context: 'Perf',
    })
    .catch(debugError);
};

const webhooks = new WebhooksApi({
  secret: process.env.GITHUB_SECRET,
});

const s3Region = process.env.AWS_S3_REGION;

const s3 = () =>
  new S3({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    region: s3Region,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  });
const s3BucketName = process.env.AWS_S3_BUCKET_NAME;
const s3BucketUrl = `https://${s3BucketName}.s3.${s3Region}.amazonaws.com`;
const getS3Url = ({ branch, fileName, repo }) => `${s3BucketUrl}/${repo}-${branch}-${fileName}`;

const uploadCoverageFile = ({ branch, fileName, repo }) =>
  new Promise((fileResolve, fileReject) => {
    const filePath = `${repoFolderLocation({ branch, repo })}/${
      process.env.DIST_FOLDER
    }/${fileName}`;
    const stream = fs.createReadStream(`${filePath}`);
    s3().upload(
      {
        ACL: 'public-read',
        Bucket: s3BucketName,
        ContentType: 'text/html',
        Body: stream,
        Key: `${repo}-${branch}-${fileName}`,
      },
      { partSize: 100 * 1024 ** 2 },
      (error, data) => {
        if (error) {
          fileReject(new Error(error));
        } else {
          fileResolve(data.Location);
        }
      },
    );
  });

const uploadFiles = ({ branch, repo }) =>
  new Promise((resolve, reject) => {
    Promise.all([
      ...['report.html'].map(fileName => uploadCoverageFile({ branch: 'master', fileName, repo })),
      ...['report.html', 'index.html'].map(fileName =>
        uploadCoverageFile({ branch, fileName, repo })),
    ])
      .then(([reportUrl, statsUrl]) => {
        resolve({
          reportUrl,
          statsUrl,
        });
      })
      .catch(reject);
  });

webhooks.on('pull_request', ({ payload }) => {
  debugLog('PULL REQUEST event received:\n', JSON.stringify({ payload }, null, 2));

  const {
    action,
    pull_request: {
      head: { sha, ref: branch },
    },
    repository: {
      name: repo,
      owner: { login: owner },
    },
  } = payload;

  if (!['opened', 'synchronize'].includes(action)) {
    debugLog("exiting since the action wasn't opened or synchronize");
    return;
  }

  setStatus({
    owner,
    repo,
    sha,
    state: 'pending',
  });

  const tasks = [
    // ALREADY_DOWNLOADED can be used when developing this project
    process.env.ALREADY_DOWNLOADED !== 'true' && [
      deleteBranchFolder.bind(null, { branch, owner, repo }),
      downloadBranch.bind(null, { branch, owner, repo }),
      yarnInstall.bind(null, { branch, owner, repo }),
      yarnRunAnalyze.bind(null, { branch, owner, repo }),
    ],
    getFileSizes.bind(null, { branch, owner, repo }),
    (fileSizes) => {
      const changeLimit = 2000;
      const change = fileSizes.reduce((sum, fileSize) => sum + fileSize.change, 0);
      const description =
        change > changeLimit
          ? `Size increase > ${kBSize(changeLimit)} (${kBSize(change)}) double check details`
          : `Size changed with: ${kBSize(change)}`;

      fs.writeFileSync(
        `${repoFolderLocation({ branch, repo })}/${process.env.DIST_FOLDER}/index.html`,
        perfReportTemplate({
          branch,
          fileSizes,
          getS3Url,
          repo,
        }),
        (error) => {
          if (error) {
            throw new Error(error);
          }
        },
      );

      uploadFiles({ branch, repo })
        .then(() => {
          setStatus({
            owner,
            repo,
            sha,
            state: change < 2000 ? 'success' : 'failure',
            description,
            targetUrl: getS3Url({ branch, fileName: 'index.html', repo }),
          });
        })
        .catch(debugError);
    },
  ];
  tasks
    .filter(task => task) // filter out false if ALREADY_DOWNLOADED is set
    .flat()
    .reduce((previousPromise, task) => previousPromise.then(task), Promise.resolve())
    .catch(debugError);
});

const server = require('http').createServer((request, response) => {
  if (cors.apply(request, response)) {
    response.end();
    return;
  }

  webhooks.middleware(request, response);
});

if (require.main === module) {
  const port = process.env.PORT || 3000;
  debugLog(`Starting server on http://localhost:${port}`);
  server.listen(port);
}

exports.server = server;

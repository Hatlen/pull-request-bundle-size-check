const debugLog = require('debug')('log');
const debugError = require('debug')('error');
const WebhooksApi = require('@octokit/webhooks');
const octokit = require('@octokit/rest')();
const { spawn } = require('child_process');

octokit.authenticate({
  type: 'token',
  token: process.env.GITHUB_PERSONAL_ACCESS_TOKEN,
});

const downloadBranch = ({ branch, owner, repo }) => {
  const gitProcess = spawn('git', [
    'clone',
    '--branch',
    branch,
    '--single-branch',
    '--depth=1',
    `git@github.com:${owner}/${repo}`,
    `/tmp/${branch}`,
  ]);

  gitProcess.stdout.on('data', (data) => {
    debugLog(`stdout: ${data}`);
  });

  gitProcess.stderr.on('data', (data) => {
    debugError(`stderr: ${data}`);
  });

  gitProcess.on('close', (code) => {
    debugLog(`child process exited with code ${code}`);
  });
};

const setStatusPending = ({
  owner, repo, sha, state,
}) => {
  octokit.repos
    .createStatus({
      owner,
      repo,
      sha,
      state,
      context: 'WIP: Performance budget',
    })
    .catch(debugError);
};

const webhooks = new WebhooksApi({
  secret: process.env.GITHUB_SECRET,
});

webhooks.on('deployment', ({ id, name, payload }) => {
  debugLog(
    'DEPLOYMENT:',
    name,
    'event received\n',
    JSON.stringify({ id, name, payload }, null, 2),
  );
});

webhooks.on('pull_request', ({ payload }) => {
  debugLog(
    'PULL REQUEST event received:\n',
    JSON.stringify({ payload }, null, 2),
  );

  const {
    action,
    pull_request: { head: { sha, ref: branch } },
    repository: { name: repo, owner: { login: owner } },
  } = payload;

  if (!['opened', 'synchronize'].includes(action)) {
    debugLog("exiting since the action wasn't opened or synchronize");
    return;
  }

  setStatusPending({
    owner,
    repo,
    sha,
    state: 'pending',
  });

  downloadBranch({ branch, owner, repo });

  setTimeout(() => {
    setStatusPending({
      owner,
      repo,
      sha,
      state: 'success',
    });
  }, 15e3);

  debugLog('data:');
  debugLog({
    branch,
    owner,
    repo,
    sha,
  });
});

webhooks.on('push', ({ id, name, payload }) => {
  debugLog(
    'PUSH:',
    name,
    'event received\n',
    JSON.stringify({ id, name, payload }, null, 2),
  );
});

const server = require('http').createServer(webhooks.middleware);
if (require.main === module) {
  const port = process.env.PORT || 3000;
  debugLog(`Starting server on http://localhost:${port}`)
  server.listen(port);
}

exports.server = server;

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
    console.log(`stdout: ${data}`);
  });

  gitProcess.stderr.on('data', (data) => {
    console.log(`stderr: ${data}`);
  });

  gitProcess.on('close', (code) => {
    console.log(`child process exited with code ${code}`);
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
    .catch(error => console.log(error));
};

const webhooks = new WebhooksApi({
  secret: process.env.GITHUB_SECRET,
});

webhooks.on('deployment', ({ id, name, payload }) => {
  console.log(
    'DEPLOYMENT:',
    name,
    'event received\n',
    JSON.stringify({ id, name, payload }, null, 2),
  );
});

webhooks.on('pull_request', ({ payload }) => {
  console.log(
    'PULL REQUEST event received:\n',
    JSON.stringify({ payload }, null, 2),
  );

  const {
    action,
    pull_request: { head: { sha, ref: branch } },
    repository: { name: repo, owner: { login: owner } },
  } = payload;

  if (!['opened', 'synchronize'].includes(action)) {
    console.log("exiting since the action wasn't opened or synchronize");
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

  console.log('data:');
  console.log({
    branch,
    owner,
    repo,
    sha,
  });
});

webhooks.on('push', ({ id, name, payload }) => {
  console.log(
    'PUSH:',
    name,
    'event received\n',
    JSON.stringify({ id, name, payload }, null, 2),
  );
});

require('http')
  .createServer(webhooks.middleware)
  .listen(process.env.PORT || 3000);

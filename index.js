const WebhooksApi = require('@octokit/webhooks');
const octokit = require('@octokit/rest')();

octokit.authenticate({
  type: 'token',
  token: process.env.GITHUB_PERSONAL_ACCESS_TOKEN,
});

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
    pull_request: { head: { sha } },
    repository: { name: repo, owner: { login: owner } },
  } = payload;

  setStatusPending({
    owner,
    repo,
    sha,
    state: 'pending',
  });

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

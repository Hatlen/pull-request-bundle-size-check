const WebhooksApi = require('@octokit/webhooks');

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
    pull_request: {
      url,
      state,
      head: {
        ref, // branch-name
        sha, // commit sha
      },
      statuses_url: statusesUrl, // probably used for setting the pull request status
    },
  } = payload;

  console.log('data:');
  console.log({
    url,
    state,
    statusesUrl,
    ref,
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

require('dotenv').config();
const fetch = require('node-fetch');
const getPort = require('get-port');
const promisify = require('pify');

const { server } = require('./index');

const pushEventPayload = require('./fixtures/pull_request_payload');
const crypto = require('crypto');

const hmac = crypto.createHmac('SHA1', process.env.GITHUB_SECRET);
hmac.update(JSON.stringify(pushEventPayload));
const pushEventPayloadSignature = hmac.digest('hex');

describe('github-webhook-service', () => {
  let port;

  beforeEach((done) => {
    getPort().then((availablePort) => {
      port = availablePort;
      done();
    });
  });

  test('', (done) => {
    promisify(server.listen.bind(server))(port)
      .then(() => {
        fetch(`http://localhost:${port}`, {
          method: 'POST',
          body: JSON.stringify(pushEventPayload),
          headers: {
            'X-GitHub-Delivery': '123e4567-e89b-12d3-a456-426655440000',
            'X-GitHub-Event': 'pull_request',
            'X-Hub-Signature': `sha1=${pushEventPayloadSignature}`,
          },
        })
        .catch(error => {
          console.log('error');
        })
        .then(result => {
          expect(result.status).toBe(200);
          done();
        })
        .then(() => {
          server.close();
        })
        .catch(error => console.log({ error }))
      })
      .catch(() => console.log('couldn\'t start the server :('));
  });
});

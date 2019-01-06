require('dotenv-flow').config();
const debugLog = require('debug')('test:debug');
const fetch = require('node-fetch');
const getPort = require('get-port');
const promisify = require('pify');
const mockSpawn = require('mock-spawn');
const nock = require('nock');

const pushEventPayload = require('./fixtures/pull_request_payload');
const crypto = require('crypto');

const hmac = crypto.createHmac('SHA1', process.env.GITHUB_SECRET);
hmac.update(JSON.stringify(pushEventPayload));
const pushEventPayloadSignature = hmac.digest('hex');
debugLog({ pushEventPayloadSignature });

describe('github-webhook-service', () => {
  let port;
  let mockSpawnMock;
  let mockReadFileSync;
  let mockWriteFileSync;
  let mockS3Upload;

  beforeEach((done) => {
    nock.disableNetConnect();

    // get an available port for the server
    getPort().then((availablePort) => {
      port = availablePort;
      done();
    });

    jest.mock('child_process', () => {
      mockSpawnMock = mockSpawn();
      mockSpawnMock.setDefault(mockSpawnMock.simple(0));

      return {
        spawn: mockSpawnMock,
      };
    });

    // set up possibility to mock specific readFileSync calls
    jest.doMock('fs', () => {
      const fs = jest.requireActual('fs');
      const originalReadFileSync = fs.readFileSync;
      let mockFiles = {};

      fs.setMockFiles = (files) => {
        mockFiles = {
          ...mockFiles,
          ...files,
        };
      };

      mockReadFileSync = jest.fn((filename, ...rest) => {
        if (mockFiles[filename]) {
          return mockFiles[filename];
        }
        return originalReadFileSync.call(this, filename, ...rest);
      });
      fs.readFileSync = mockReadFileSync;
      fs.createReadStream = jest.fn();
      mockWriteFileSync = jest.fn();
      fs.writeFileSync = mockWriteFileSync;
      return fs;
    });

    jest.mock('aws-sdk/clients/s3', () => {
      function mockS3() {
        mockS3Upload = jest.fn((_params, _options, callback) => {
          const errors = false;
          const data = {};
          callback(errors, data);
        });

        return {
          upload: mockS3Upload,
        };
      }

      return mockS3;
    });
  });

  afterEach(() => {
    nock.restore();
  });

  test('the server accepts pull request webhook events', (done) => {
    nock.enableNetConnect(`localhost:${port}`);
    const mockGithubAPIPostBody = jest.fn(() => true);
    const mockGithubAPI = nock('https://api.github.com:443')
      .post(
        '/repos/mynewsdesk/mnd-publish-frontend/statuses/624d21b51d71310150447f43d18e9db69af39799',
        mockGithubAPIPostBody,
      )
      .times(2)
      .reply(201);

    const fs = require('fs');
    fs.setMockFiles({
      '/tmp/mnd-publish-frontend-master/dist/stats.json': JSON.stringify({
        assets: [
          {
            name: 'increased-bundle.js',
            size: 1,
          },
        ],
      }),
      '/tmp/mnd-publish-frontend-analyze-parsed-bundle-sizes/dist/stats.json': JSON.stringify({
        assets: [
          {
            name: 'increased-bundle.js',
            size: 4000,
          },
        ],
      }),
    });
    const { server } = require('./index');

    promisify(server.listen.bind(server))(port)
      .then(() =>
        fetch(`http://localhost:${port}`, {
          method: 'POST',
          body: JSON.stringify(pushEventPayload),
          headers: {
            'X-GitHub-Delivery': '123e4567-e89b-12d3-a456-426655440000',
            'X-GitHub-Event': 'pull_request',
            'X-Hub-Signature': `sha1=${pushEventPayloadSignature}`,
          },
        }))
      .then((result) => {
        expect(result.status).toBe(200);
        expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
        const generatedReport = mockWriteFileSync.mock.calls[0][1];
        expect(generatedReport).toMatchSnapshot();
        expect(generatedReport).toMatch(/The total size increased with:\n.*\+4KB/);
        expect(generatedReport).toMatch(/increased-bundle.js.*\n.*\+4KB.*\n.*4KB.*\n.*0KB/);
        expect(mockSpawnMock.calls.length).toBe(6);
        expect(mockSpawnMock.calls.map(({ command, args }) => `${command} ${args.join(' ')}`)).toEqual(expect.arrayContaining([
          'git clone --branch master --single-branch --depth=1 git@github.com:github-user/github-repo /tmp/github-repo-master',
          'yarn install --cwd=/tmp/github-repo-master',
          'yarn --cwd=/tmp/github-repo-master build:webpack-bundle-analyzer',
          'git clone --branch analyze-parsed-bundle-sizes --single-branch --depth=1 git@github.com:mynewsdesk/mnd-publish-frontend /tmp/mnd-publish-frontend-analyze-parsed-bundle-sizes',
          'yarn install --cwd=/tmp/mnd-publish-frontend-analyze-parsed-bundle-sizes',
          'yarn --cwd=/tmp/mnd-publish-frontend-analyze-parsed-bundle-sizes build:webpack-bundle-analyzer',
        ]));
        expect(mockS3Upload).toHaveBeenCalled();
        expect(mockGithubAPI.isDone()).toBe(true);
        expect(mockGithubAPIPostBody).toHaveBeenCalledTimes(2);
        expect(mockGithubAPIPostBody).toHaveBeenNthCalledWith(1, {
          context: 'Perf',
          state: 'pending',
        });
        expect(mockGithubAPIPostBody).toHaveBeenNthCalledWith(2, {
          context: 'Perf',
          description: 'Size increase > 2KB (4KB) double check details',
          state: 'failure',
          target_url:
            'https://<bucket-name>.s3.<region>.amazonaws.com/mnd-publish-frontend-analyze-parsed-bundle-sizes-index.html',
        });
        done();
      })
      .then(() => server.close())
      .catch(console.error);
  }, 1e3);
});

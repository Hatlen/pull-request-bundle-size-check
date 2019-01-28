require('dotenv-flow').config();
const debugLog = require('debug')('test:debug');
const fetch = require('node-fetch');
const getPort = require('get-port');
const promisify = require('pify');
const mockSpawn = require('mock-spawn');
const nock = require('nock');
const crypto = require('crypto');

const pushEventPayload = require('./fixtures/pull_request_payload');

// Create signature for the push event payload
const hmac = crypto.createHmac('SHA1', process.env.GITHUB_SECRET);
hmac.update(JSON.stringify(pushEventPayload));
const pushEventPayloadSignature = hmac.digest('hex');
debugLog({ pushEventPayloadSignature });

describe('github-webhook-service', () => {
  let port;
  let mockSpawnMock;
  let mockReadFileSync;
  let mockWriteFileSync;
  let mockRimraf;
  let mockS3Upload;

  beforeEach((done) => {
    nock.disableNetConnect();

    // get an available port for the server
    getPort().then((availablePort) => {
      port = availablePort;
      done();
    });

    jest.mock('rimraf', () => {
      mockRimraf = jest.fn((folderLocation, callback) => {
        callback();
      });

      return mockRimraf;
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
      fs.createReadStream = jest.fn(filename => `Mocked readStream: ${filename}`);
      mockWriteFileSync = jest.fn();
      fs.writeFileSync = mockWriteFileSync;
      return fs;
    });

    // use same upload mock for all three S3 calls
    mockS3Upload = jest.fn((_params, _options, callback) => {
      const errors = false;
      const data = {};
      callback(errors, data);
    });

    jest.mock('aws-sdk/clients/s3', () => {
      function mockS3() {
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
        '/repos/repository-owner/repository-name/statuses/git-commit-sha',
        mockGithubAPIPostBody,
      )
      .times(2)
      .reply(201);

    const fs = require('fs');
    fs.setMockFiles({
      '/tmp/repository-name-master/dist/stats.json': JSON.stringify({
        assets: [
          {
            name: 'increased-bundle.js',
            size: 1,
          },
        ],
      }),
      '/tmp/repository-name-feature-branch/dist/stats.json': JSON.stringify({
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
        // Check that the directories from the previous run has been deleted
        expect(mockRimraf).toHaveBeenCalledTimes(2);
        expect(mockRimraf).toHaveBeenCalledWith(
          '/tmp/repository-name-master',
          expect.any(Function),
        );
        expect(mockRimraf).toHaveBeenCalledWith(
          '/tmp/repository-name-feature-branch',
          expect.any(Function),
        );

        // Check that the github status is set to pending
        expect(mockGithubAPIPostBody).toHaveBeenNthCalledWith(1, {
          context: 'Perf',
          state: 'pending',
        });

        // Download github repos and generate stats.json files
        expect(mockSpawnMock.calls.length).toBe(6);
        expect(mockSpawnMock.calls.map(({ command, args }) => `${command} ${args.join(' ')}`)).toEqual(expect.arrayContaining([
          'git clone --branch master --single-branch --depth=1 git@github.com:repository-owner/repository-name /tmp/repository-name-master',
          'yarn install --cwd=/tmp/repository-name-master',
          'yarn --cwd=/tmp/repository-name-master build:webpack-bundle-analyzer',
          'git clone --branch feature-branch --single-branch --depth=1 git@github.com:repository-owner/repository-name /tmp/repository-name-feature-branch',
          'yarn install --cwd=/tmp/repository-name-feature-branch',
          'yarn --cwd=/tmp/repository-name-feature-branch build:webpack-bundle-analyzer',
        ]));

        // Check that the stats.json files are read
        expect(mockReadFileSync).toHaveBeenNthCalledWith(
          mockReadFileSync.mock.calls.length - 1,
          '/tmp/repository-name-feature-branch/dist/stats.json',
        );
        expect(mockReadFileSync).toHaveBeenNthCalledWith(
          mockReadFileSync.mock.calls.length,
          '/tmp/repository-name-master/dist/stats.json',
        );

        // The report is generated correctly
        expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
        const generatedReport = mockWriteFileSync.mock.calls[0][1];
        expect(generatedReport).toMatchSnapshot();
        expect(generatedReport).toMatch(/The total size increased with:\n.*\+4kB/);
        expect(generatedReport).toMatch(/increased-bundle.js.*\n.*\+4kB.*\n.*4kB.*\n.*1B/);

        // Files are uploaded to S3
        expect(mockS3Upload).toHaveBeenCalledTimes(5);
        expect(mockS3Upload).toHaveBeenCalledWith(
          expect.objectContaining({
            Body: 'Mocked readStream: /tmp/repository-name-feature-branch/dist/index.html',
            Key: 'repository-name-feature-branch-index.html',
          }),
          expect.any(Object),
          expect.any(Function),
        );

        expect(mockS3Upload).toHaveBeenCalledWith(
          expect.objectContaining({
            Body: 'Mocked readStream: /tmp/repository-name-feature-branch/dist/report.html',
            Key: 'repository-name-feature-branch-report.html',
          }),
          expect.any(Object),
          expect.any(Function),
        );

        expect(mockS3Upload).toHaveBeenCalledWith(
          expect.objectContaining({
            Body: 'Mocked readStream: /tmp/repository-name-master/dist/report.html',
            Key: 'repository-name-master-report.html',
          }),
          expect.any(Object),
          expect.any(Function),
        );

        // Check that the check results are reported back to github
        expect(mockGithubAPI.isDone()).toBe(true);
        expect(mockGithubAPIPostBody).toHaveBeenCalledTimes(2);
        expect(mockGithubAPIPostBody).toHaveBeenNthCalledWith(2, {
          context: 'Perf',
          description: 'Size increase > 2kB (4kB) double check details',
          state: 'failure',
          target_url:
            'https://s3-<region>.amazonaws.com/<bucket-name>/repository-name-feature-branch-index.html',
        });

        // Check that the server responded with 200
        expect(result.status).toBe(200);
        done();
      })
      .then(() => server.close())
      .catch(console.error);
  }, 1e3);
});

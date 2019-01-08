module.exports = {
  action: 'synchronize',
  pull_request: {
    head: {
      ref: 'feature-branch',
      sha: 'git-commit-sha',
    },
  },
  repository: {
    name: 'repository-name',
    owner: {
      login: 'repository-owner',
    },
  },
};

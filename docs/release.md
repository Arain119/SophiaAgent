# Release Sophia Agent

Sophia Agent is published to npm as `sophiaagent`. The primary executable is
`sophia`.

## One-time setup

1. Create an npm automation or granular access token with permission to publish
   `sophiaagent`.
2. In `Arain119/SophiaAgent`, add it as the GitHub Actions repository secret
   `NPM_TOKEN`.

## Publish a version

1. Update `package.json` and `bun.lock` to the same version.
2. Commit and push the version change.
3. Create and push the matching tag, for example `v0.1.0`.

The `Publish to npm` workflow validates the tag, runs the full test suite,
builds the distributable, inspects the npm package, publishes it, and creates a
GitHub Release.

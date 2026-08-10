const { createHash } = require('node:crypto')

/** SHA-256 digests published with microsoft/ripgrep-prebuilt v15.0.1. */
const RIPGREP_SHA256 = Object.freeze({
  'aarch64-apple-darwin':
    '2fa16464fd8638588a67c7fc172d3c4b57fbdc65dff366e10b0b0e90734628a6',
  'aarch64-pc-windows-msvc':
    'cc36bae403f25c838d25a3c65ba64f38cc00904652e89d6377b5ceaf66df8432',
  'aarch64-unknown-linux-gnu':
    '301eaf7e580272acb9e370d7b9f4ed9ba0b0fa8c3479e7282a895bbfe0f1076c',
  'aarch64-unknown-linux-musl':
    'dd3738a4b6e8df0fb3bc3edc5af352c4c39e0d97ad118a23e5176bdc5d48ba08',
  'x86_64-apple-darwin':
    '591c693e80bb444ef1907b2a906feb9c77bcafe1cdf509107cc75dcf0e875bd2',
  'x86_64-pc-windows-msvc':
    'bd28761f4918ea8fcb7a95f636b4422a915d55af268d9805be82d8ce0fdfc823',
  'x86_64-unknown-linux-musl':
    '4499958bfd5252df3d9e7504127fd448e4a14fbf2805ef4f14baaa1bcf775188',
})

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

function getRipgrepSha256(target) {
  const digest = RIPGREP_SHA256[target]
  if (!digest) throw new Error(`No pinned ripgrep checksum for ${target}`)
  return digest
}

function verifySha256(buffer, expected, label = 'download') {
  const actual = sha256(buffer)
  if (actual !== expected) {
    throw new Error(
      `${label} checksum mismatch: expected ${expected}, received ${actual}`,
    )
  }
}

module.exports = {
  RIPGREP_SHA256,
  getRipgrepSha256,
  sha256,
  verifySha256,
}

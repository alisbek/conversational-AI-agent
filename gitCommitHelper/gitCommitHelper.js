// git commit helper stub

const { exec } = require('child_process');

async function gitCommitHelper(message) {
  // simplistic commit invocation
  return new Promise((resolve, reject) => {
    exec(`git commit -am "${message}"`, (err, stdout, stderr) => {
      if (err) return reject(err);
      resolve(stdout);
    });
  });
}

module.exports = { gitCommitHelper };
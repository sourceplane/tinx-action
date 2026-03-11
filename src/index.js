const core = require('@actions/core');
const exec = require('@actions/exec');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { DefaultArtifactClient } = require('@actions/artifact');

function parseMultiline(input) {
  return (input || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
}

function parseOutputMappings(input) {
  const mappings = parseMultiline(input);
  return mappings.map(entry => {
    const index = entry.indexOf('=');
    if (index <= 0 || index === entry.length - 1) {
      throw new Error(`Invalid outputs entry '${entry}', expected 'name=path'`);
    }
    return {
      name: entry.slice(0, index).trim(),
      filePath: entry.slice(index + 1).trim()
    };
  });
}

function resolvePath(baseDir, candidate) {
  if (path.isAbsolute(candidate)) {
    return candidate;
  }
  return path.join(baseDir, candidate);
}

async function runCmd(command, args, options = {}) {
  const result = await exec.exec(command, args, {
    failOnStdErr: false,
    ignoreReturnCode: false,
    ...options
  });
  return result;
}

async function installTinx({ version, installUrl }) {
  const installDir = path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'tinx-bin');
  await fsp.mkdir(installDir, { recursive: true });

  core.exportVariable('TINX_INSTALL_DIR', installDir);
  core.exportVariable('TINX_BIN', path.join(installDir, 'tinx'));
  core.addPath(installDir);

  const shellScript = `set -euo pipefail\nexport TINX_INSTALL_DIR=${JSON.stringify(installDir)}\nexport TINX_VERSION=${JSON.stringify(version)}\ncurl -fsSL ${JSON.stringify(installUrl)} | bash`;
  await runCmd('bash', ['-lc', shellScript]);

  const tinxBin = path.join(installDir, 'tinx');
  await fsp.access(tinxBin, fs.constants.X_OK);
  await runCmd(tinxBin, ['version']);

  return tinxBin;
}

async function runTinx(tinxBin, runSpec, workingDirectory) {
  const trimmed = (runSpec || '').trim();
  if (!trimmed) {
    throw new Error("'run' input is required");
  }
  const shellCommand = `${JSON.stringify(tinxBin)} run ${trimmed}`;
  await runCmd('bash', ['-lc', shellCommand], { cwd: workingDirectory });
}

async function collectOutputs(outputMappingsInput, workingDirectory) {
  const mappings = parseOutputMappings(outputMappingsInput);
  const payload = {};

  for (const mapping of mappings) {
    const absolute = resolvePath(workingDirectory, mapping.filePath);
    const value = await fsp.readFile(absolute, 'utf8');
    core.setOutput(mapping.name, value);
    payload[mapping.name] = value;
  }

  core.setOutput('outputs-json', JSON.stringify(payload));
}

async function uploadArtifacts(artifactsInput, artifactName, workingDirectory) {
  const artifactPaths = parseMultiline(artifactsInput).map(item => resolvePath(workingDirectory, item));
  if (!artifactPaths.length) {
    return;
  }

  const filesToUpload = [];
  for (const artifactPath of artifactPaths) {
    try {
      const stat = await fsp.stat(artifactPath);
      if (stat.isFile()) {
        filesToUpload.push(artifactPath);
      }
    } catch {
      // Skip non-existing paths to keep behavior compatible with optional artifacts.
    }
  }

  if (!filesToUpload.length) {
    core.info('No artifact files found to upload.');
    return;
  }

  const artifactClient = new DefaultArtifactClient();
  await artifactClient.uploadArtifact(artifactName, filesToUpload, workingDirectory, {
    compressionLevel: 6
  });
}

async function main() {
  try {
    const runSpec = core.getInput('run', { required: true });
    const workingDirectoryInput = core.getInput('working-directory') || '.';
    const outputsInput = core.getInput('outputs');
    const artifactsInput = core.getInput('artifacts');
    const artifactName = core.getInput('artifact-name') || 'tinx-artifacts';
    const tinxVersion = core.getInput('tinx-version') || 'v0.1.4';
    const installUrl = core.getInput('install-url') || 'https://raw.githubusercontent.com/sourceplane/tinx/main/install.sh';

    const workingDirectory = path.resolve(process.cwd(), workingDirectoryInput);

    const tinxBin = await installTinx({ version: tinxVersion, installUrl });
    await runTinx(tinxBin, runSpec, workingDirectory);
    await collectOutputs(outputsInput, workingDirectory);
    await uploadArtifacts(artifactsInput, artifactName, workingDirectory);
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error));
  }
}

main();

// afterPack hook for masquerade builds.
//
// Why this exists: electron-builder's `productName` override correctly
// renames the .app directory (e.g. "Notes.app") and CFBundleDisplayName,
// but it does NOT consistently rewrite the binary inside
// Contents/MacOS/ (it keeps "Cue" — visible in `ps -A`, `top`, and
// crash logs) nor CFBundleExecutable in Info.plist. macOS uses
// CFBundleExecutable to spawn the process; if it points at a binary
// that doesn't exist after rename, the bundle won't launch.
//
// We post-process the bundle: rename the executable to match
// CFBundleName, then rewrite CFBundleExecutable + CFBundleName in
// Info.plist with `plutil` (preinstalled on macOS). The result is
// Activity Monitor reading the masquerade name from the bundle exactly
// like a native app.
//
// This hook is wired from each electron-builder.<preset>.yml via
// `afterPack: scripts/afterPack-masquerade.cjs`.

const { execFileSync } = require('node:child_process');
const { existsSync, renameSync, readFileSync } = require('node:fs');
const { join } = require('node:path');

module.exports = async function afterPack(context) {
  // Mac-only — skip on Windows / Linux builds.
  if (context.electronPlatformName !== 'darwin') return;

  // electron-builder sets appOutDir to e.g.
  //   cue/dist/mac-notes/mac-arm64/
  // and the bundle lives at <appOutDir>/<productName>.app
  const productName = context.packager.appInfo.productFilename;
  const appPath = join(context.appOutDir, `${productName}.app`);
  if (!existsSync(appPath)) {
    console.warn(`afterPack-masquerade: bundle not found at ${appPath}, skipping`);
    return;
  }

  const contents = join(appPath, 'Contents');
  const infoPlist = join(contents, 'Info.plist');
  const macosDir = join(contents, 'MacOS');

  // Read existing CFBundleExecutable so we know which binary to rename.
  let oldExec;
  try {
    oldExec = execFileSync('/usr/bin/plutil', ['-extract', 'CFBundleExecutable', 'raw', infoPlist], {
      encoding: 'utf-8',
    }).trim();
  } catch (e) {
    console.warn(`afterPack-masquerade: cannot read CFBundleExecutable: ${e.message}`);
    return;
  }

  const oldBinary = join(macosDir, oldExec);
  const newBinary = join(macosDir, productName);

  if (oldExec === productName) {
    // Already aligned — nothing to do (e.g. running afterPack twice).
    console.log(`afterPack-masquerade: ${productName} already aligned`);
    return;
  }

  if (!existsSync(oldBinary)) {
    console.warn(`afterPack-masquerade: expected binary ${oldBinary} missing`);
    return;
  }

  // 1. Rename Contents/MacOS/<old> → Contents/MacOS/<productName>
  console.log(`afterPack-masquerade: renaming binary ${oldExec} → ${productName}`);
  renameSync(oldBinary, newBinary);

  // 2. Rewrite Info.plist CFBundleExecutable + CFBundleName so macOS
  //    LaunchServices picks the new binary and Activity Monitor reads
  //    the alias name. plutil -replace edits in place and preserves
  //    binary plist format.
  execFileSync('/usr/bin/plutil', [
    '-replace',
    'CFBundleExecutable',
    '-string',
    productName,
    infoPlist,
  ]);
  execFileSync('/usr/bin/plutil', [
    '-replace',
    'CFBundleName',
    '-string',
    productName,
    infoPlist,
  ]);

  // 3. Ensure LSUIElement is set — extendInfo from the YAML SHOULD have
  //    written it, but double-check because masquerade bundles surfacing
  //    in Cmd+Tab is an instant tell.
  try {
    execFileSync('/usr/bin/plutil', ['-extract', 'LSUIElement', 'raw', infoPlist], {
      encoding: 'utf-8',
    });
  } catch {
    console.log(`afterPack-masquerade: injecting missing LSUIElement=true`);
    execFileSync('/usr/bin/plutil', [
      '-insert',
      'LSUIElement',
      '-bool',
      'true',
      infoPlist,
    ]);
  }

  console.log(`afterPack-masquerade: ${productName}.app fully aliased`);
};

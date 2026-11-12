// Candidate targets admitted for validation. Each requires its own installation evidence.
export function isDesktopTarget(platform, arch) {
  return (platform === 'darwin' && (arch === 'arm64' || arch === 'x64')) ||
    ((platform === 'win32' || platform === 'linux') && arch === 'x64');
}

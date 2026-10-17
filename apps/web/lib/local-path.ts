/** Shared by the import form and the server so both refuse the same paths with the same words. */
export const LOCAL_PATH_HINT = 'Enter the full path to a git clone on this machine, for example /Users/you/code/project or ~/code/project.';

/** Absolute (POSIX, Windows drive or UNC) or home-relative. Relative paths would resolve against
 *  the server's working directory, which the user cannot see. */
export const acceptableLocalPath = (raw: string): boolean => {
  const t = raw.trim();
  return t === '~' || t.startsWith('~/') || t.startsWith('/') || /^[A-Za-z]:[\\/]/.test(t) || t.startsWith('\\\\');
};

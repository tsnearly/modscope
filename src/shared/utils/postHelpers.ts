export function getPostUrlFromId(postId?: string): string | null {
  if (!postId) return null;
  // postId might be 't3_abcdef' or just 't3_abcdef' or 'abcdef'
  const id = postId.startsWith('t3_') ? postId.replace(/^t3_/, '') : postId;
  if (!id) return null;
  return `https://reddit.com/comments/${id}`;
}

export function isExternalUrl(url?: string): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    // treat reddit domains as internal
    const host = u.hostname.toLowerCase();
    return !(host.endsWith('reddit.com') || host.endsWith('redd.it'));
  } catch {
    return false;
  }
}

/**
 * StoryMap links stay on their portal.
 *
 * A StoryMap is a Next.js app whose router only accepts its own
 * /<web adaptor>/apps/storymaps/... path. Served from under the portal proxy it
 * routes itself to its error page, so an Experience embedding a story showed
 * nothing but the StoryMaps logo. Links to a story are set aside while a body
 * is rewritten and put back untouched, so the browser frames the story
 * straight from its portal. Same rule as the mapping apps' dev proxies.
 *
 * Matches the host-and-path part in plain, JSON-escaped (\/) and URL-encoded
 * (%2F) form, so the scheme in front of it no longer spells a portal URL that
 * a rewrite would recognise. Hosts without a dot (localhost) never match.
 */
const SEP = String.raw`(?:\/|\\\/|%2F)`;
const STORYMAP_LINK = new RegExp(
  String.raw`[a-z0-9-]+(?:\.[a-z0-9-]+)+(?::\d+)?${SEP}[\w-]+${SEP}apps${SEP}storymaps(?=${SEP}|[?#"'\s<\\]|$)`,
  'gi',
);
// A private-use character brackets each placeholder: never part of a real payload.
const PRIVATE = String.fromCharCode(0xe000);
const MARK = new RegExp(`${PRIVATE}storymap(\\d+)${PRIVATE}`, 'g');

export function keepStoryMapLinks(
  text: string,
  rewrite: (text: string) => string,
): string {
  if (typeof text !== 'string' || !/storymaps/i.test(text))
    return rewrite(text);
  const kept: string[] = [];
  const shielded = text.replace(STORYMAP_LINK, (link) => {
    kept.push(link);
    return `${PRIVATE}storymap${kept.length - 1}${PRIVATE}`;
  });
  const out = rewrite(shielded);
  if (!kept.length || typeof out !== 'string') return out;
  return out.replace(MARK, (_, i: string) => kept[Number(i)]);
}

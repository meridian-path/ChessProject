'use strict';

const SLUG = 'best-chess-openings-for-beginners';

const meta = {
  slug: SLUG,
  title: 'Best Chess Openings for Beginners, by Win Rate',
  description: 'The openings this site tracks, ranked by measured score at 1400-1600, with the sample size for every number shown.',
  targetQuery: 'best chess openings for beginners',
  related: [],
};

const LOWER_BAND = '1400-1600';

function render(ctx) {
  const { entries, rankOpeningsByScore, escapeHtml, displayName, formatPct, formatGamesAbbrev, wrapTable } = ctx;
  const ranked = rankOpeningsByScore(entries, LOWER_BAND);
  const usedBalanced = ranked.length > 0 && ranked[0].usedBalanced;

  // rankOpeningsByScore() deliberately drops any opening whose LOWER_BAND
  // sample doesn't clear the minimum-games threshold (see that function's
  // own doc comment in src/processOpenings.js) -- correct for the ranking
  // itself, but `ranked` is not the full opening list, and the intro
  // paragraph below counts unfiltered `entries.length`. Building `rows`
  // from `ranked` alone used to silently drop an under-sampled opening from
  // this table while the heading kept claiming the true total -- the same
  // production bug (King's Indian Defense, real 1400-1600 games under the
  // threshold) already fixed in renderOpeningsHub for openings.html. Fix:
  // every entry gets a row -- ranked entries first, in rank order, then any
  // entry rankOpeningsByScore left out, in declaration order -- with an
  // honestly empty rank cell and an 'n/a' score rather than disappearing.
  const rankedSlugs = new Set(ranked.map((r) => r.slug));
  const unranked = entries
    .filter((e) => !rankedSlugs.has(e.openingConfig.slug))
    .map((e) => {
      const band = (e.model.bands || []).find((b) => b.band === LOWER_BAND);
      return {
        slug: e.openingConfig.slug,
        name: e.model.name,
        side: e.model.side,
        games: band ? band.games : 0,
      };
    });

  const rows = [
    ...ranked.map((r) => {
      const scoreCell = usedBalanced && r.scoreForSideBalanced != null
        ? `${formatPct(r.scoreForSideBalanced)}% <span class="rep-pct">(${formatPct(r.scoreForSide)}% all games)</span>`
        : `${formatPct(r.scoreForSide)}%`;
      return `<tr><td>${r.rank}</td><td><a href="${escapeHtml(r.slug)}.html">${displayName(r.name)}</a></td><td>${escapeHtml(r.side)}</td><td>${formatGamesAbbrev(r.games)}</td><td>${scoreCell}</td></tr>`;
    }),
    ...unranked.map((u) => `<tr><td></td><td><a href="${escapeHtml(u.slug)}.html">${displayName(u.name)}</a></td><td>${escapeHtml(u.side)}</td><td>${formatGamesAbbrev(u.games)}</td><td>n/a</td></tr>`),
  ].join('');

  return `
    <p>&ldquo;Best opening for beginners&rdquo; gets asked constantly and answered mostly with opinion. This page answers a narrower, checkable version of the question: among the ${entries.length} openings this site tracks, which ones actually score best for the side that plays them at ${escapeHtml(LOWER_BAND)}, based on real Lichess games?</p>

    <div class="callout">This is not a claim that these are the only good openings for beginners, or that a higher score here means &ldquo;easier to learn&rdquo; - it means players in this rating band who reached this exact position won more often with this piece configuration than with the others on this list. Style, how much you enjoy a position, and how much time you want to spend on theory all matter too, and none of those are measurable from a database.</div>

    <h2>Ranked by score at ${escapeHtml(LOWER_BAND)}</h2>
    <p class="confound-note">${usedBalanced
      ? 'Ranked by score among games between similarly-rated opponents (rating gap &le;50), with the all-games score shown alongside - this removes the biggest confound in a raw comparison like this (players who choose one opening are not the same players who choose another). Rows too close to call given their own sample sizes share a rank number.'
      : 'This ranking uses each opening&rsquo;s all-games score and does NOT control for who tends to choose each opening - a real confound in any list like this. Rows too close to call given their own sample sizes share a rank number.'}</p>
    ${rows ? wrapTable(`<table><caption class="sr-only">Openings ranked by score at ${escapeHtml(LOWER_BAND)}</caption><thead><tr><th scope="col">#</th><th scope="col">Opening</th><th scope="col">Side</th><th scope="col">Games</th><th scope="col">Score</th></tr></thead><tbody>${rows}</tbody></table>`, `Openings ranked by score at ${LOWER_BAND}`) : '<p class="empty-note">Band data was not available for this build.</p>'}

    <h2>Why a &ldquo;score&rdquo; isn&rsquo;t the whole story</h2>
    <p>Score here means the standard chess scoring convention (a win counts 1, a draw counts 0.5) as a percentage, for the side whose opening this is, from real games at this rating band. A high score can partly reflect that a line is comfortable and hard to go wrong in, rather than that it&rsquo;s objectively strongest - which is arguably a better property for a beginner&rsquo;s first opening than raw engine strength would be anyway.</p>

    <h2>Go deeper</h2>
    <p>Every opening in the table above links to its own page with a full rating-band breakdown, common mistakes at this level, and real recent games. See the <a href="openings.html">full openings comparison &rarr;</a> for all four rating bands side by side, or the side-specific breakdowns once you know which color you&rsquo;re asking about: <a href="best-white-openings-1400-1600.html">best White openings at 1400-1600 &rarr;</a> and <a href="best-black-openings-1400-1600.html">best Black openings at 1400-1600 &rarr;</a>, each with links up through 1600-1800, 1800-2000, and 2000+.</p>
  `;
}

module.exports = { meta, render };

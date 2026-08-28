'use strict';

/**
 * Factory for the 8 "best White/Black openings at [band]" guides -- the
 * rating-banded companion to best-chess-openings-for-beginners.js, which
 * covers 1400-1600 only and doesn't split by side. One factory rather than
 * 8 near-duplicate files:
 * every page differs only by `side`/`band`, and every number is still pulled
 * from ctx.entries the same as every other guide -- no hand-typed statistics.
 *
 * Query intent: "best openings for [rating] as White/Black" -- one page per
 * (side, band) pair, RATING_BANDS' own 4 bands crossed with the 2 sides.
 */

const BANDS = ['1400-1600', '1600-1800', '1800-2000', '2000+'];
const SIDES = ['white', 'black'];

function bandSlug(band) {
  return band === '2000+' ? '2000-plus' : band;
}

function sideLabel(side) {
  return side === 'white' ? 'White' : 'Black';
}

function otherSide(side) {
  return side === 'white' ? 'black' : 'white';
}

/**
 * Ranks only the openings whose configured `side` matches -- rankOpeningsByScore
 * itself ranks whatever entries it's given on each entry's OWN side score, so
 * filtering first is what turns "rank everything" into "rank White's own
 * openings" or "rank Black's own openings" without changing that function.
 */
function rankSide(entries, side, band, rankOpeningsByScore) {
  const sideEntries = entries.filter((e) => e.openingConfig.side === side);
  return { sideEntries, ranked: rankOpeningsByScore(sideEntries, band) };
}

function createPage(side, band) {
  const label = sideLabel(side);
  const other = otherSide(side);
  const otherLabel = sideLabel(other);
  const slug = `best-${side}-openings-${bandSlug(band)}`;

  const meta = {
    slug,
    title: `Best ${label} Openings at ${band}, by Win Rate`,
    description: `The ${side}-side openings this site tracks, ranked by measured score at ${band}, with the sample size for every number shown.`,
    targetQuery: `best openings for ${band} as ${side}`,
    related: [],
  };

  function render(ctx) {
    const { entries, rankOpeningsByScore, escapeHtml, displayName, formatPct, formatGamesAbbrev, wrapTable } = ctx;

    const { sideEntries, ranked } = rankSide(entries, side, band, rankOpeningsByScore);
    const usedBalanced = ranked.length > 0 && ranked[0].usedBalanced;

    // Same honesty fix as best-chess-openings-for-beginners.js: every
    // side-matching opening gets a row, ranked entries first in rank order,
    // then anything rankOpeningsByScore dropped for an under-sampled band,
    // with an empty rank cell and 'n/a' score rather than disappearing.
    const rankedSlugs = new Set(ranked.map((r) => r.slug));
    const unranked = sideEntries
      .filter((e) => !rankedSlugs.has(e.openingConfig.slug))
      .map((e) => {
        const b = (e.model.bands || []).find((x) => x.band === band);
        return { slug: e.openingConfig.slug, name: e.model.name, games: b ? b.games : 0 };
      });

    const rows = [
      ...ranked.map((r) => {
        const scoreCell = usedBalanced && r.scoreForSideBalanced != null
          ? `${formatPct(r.scoreForSideBalanced)}% <span class="rep-pct">(${formatPct(r.scoreForSide)}% all games)</span>`
          : `${formatPct(r.scoreForSide)}%`;
        return `<tr><td>${r.rank}</td><td><a href="${escapeHtml(r.slug)}.html">${displayName(r.name)}</a></td><td>${formatGamesAbbrev(r.games)}</td><td>${scoreCell}</td></tr>`;
      }),
      ...unranked.map((u) => `<tr><td></td><td><a href="${escapeHtml(u.slug)}.html">${displayName(u.name)}</a></td><td>${formatGamesAbbrev(u.games)}</td><td>n/a</td></tr>`),
    ].join('');

    // The comparison point for "how this compares to the other side" below --
    // the SAME ranking function, run against the other side's own entries at
    // the same band, so this isn't a separate hand-typed claim.
    const { ranked: otherRanked } = rankSide(entries, other, band, rankOpeningsByScore);
    const topOther = otherRanked[0] || null;
    const topThis = ranked[0] || null;

    const bandIndex = BANDS.indexOf(band);
    const prevBand = bandIndex > 0 ? BANDS[bandIndex - 1] : null;
    const nextBand = bandIndex < BANDS.length - 1 ? BANDS[bandIndex + 1] : null;
    const bandNavLinks = [
      prevBand ? `<a href="best-${side}-openings-${bandSlug(prevBand)}.html">&larr; ${escapeHtml(label)} at ${escapeHtml(prevBand)}</a>` : null,
      nextBand ? `<a href="best-${side}-openings-${bandSlug(nextBand)}.html">${escapeHtml(label)} at ${escapeHtml(nextBand)} &rarr;</a>` : null,
    ].filter(Boolean).join(' &middot; ');

    return `
      <p>&ldquo;Best opening for ${escapeHtml(side)} at ${escapeHtml(band)}&rdquo; gets asked constantly and answered mostly with opinion. This page answers a narrower, checkable version of the question: among the ${sideEntries.length} ${escapeHtml(side)}-side openings this site tracks, which ones actually score best for ${escapeHtml(label)} at ${escapeHtml(band)}, based on real Lichess games?</p>

      <div class="callout">This is not a claim that these are the only good openings for ${escapeHtml(label)} at ${escapeHtml(band)}, or that a higher score here means &ldquo;easier to learn&rdquo; - it means players in this rating band who reached this exact position won more often with this piece configuration than with the others on this list. Style, how much you enjoy a position, and how much time you want to spend on theory all matter too, and none of those are measurable from a database.</div>

      <h2>Ranked by score at ${escapeHtml(band)}</h2>
      <p class="confound-note">${usedBalanced
        ? 'Ranked by score among games between similarly-rated opponents (rating gap &le;50), with the all-games score shown alongside - this removes the biggest confound in a raw comparison like this (players who choose one opening are not the same players who choose another). Rows too close to call given their own sample sizes share a rank number.'
        : 'This ranking uses each opening&rsquo;s all-games score and does NOT control for who tends to choose each opening - a real confound in any list like this. Rows too close to call given their own sample sizes share a rank number.'}</p>
      ${rows ? wrapTable(`<table><caption class="sr-only">${escapeHtml(label)} openings ranked by score at ${escapeHtml(band)}</caption><thead><tr><th scope="col">#</th><th scope="col">Opening</th><th scope="col">Games</th><th scope="col">Score</th></tr></thead><tbody>${rows}</tbody></table>`, `${label} openings ranked by score at ${band}`) : '<p class="empty-note">Band data was not available for this build.</p>'}

      <h2>How this compares to ${escapeHtml(otherLabel)}</h2>
      <p>${topThis && topOther
        ? `At ${escapeHtml(band)}, ${escapeHtml(label)}&rsquo;s top-scoring tracked opening is <a href="${escapeHtml(topThis.slug)}.html">${displayName(topThis.name)}</a> at ${formatPct(topThis.scoreForSideBalanced != null ? topThis.scoreForSideBalanced : topThis.scoreForSide)}%, versus <a href="${escapeHtml(topOther.slug)}.html">${displayName(topOther.name)}</a> at ${formatPct(topOther.scoreForSideBalanced != null ? topOther.scoreForSideBalanced : topOther.scoreForSide)}% for ${escapeHtml(otherLabel)}. Scores for the two sides aren&rsquo;t directly comparable (White and Black start from a different position and this site doesn&rsquo;t track every possible opening for either side), so read this as &ldquo;here is each side&rsquo;s own best pick&rdquo;, not a claim that one side has an edge.`
        : `Not enough band data was available in this build to compare against ${escapeHtml(otherLabel)}&rsquo;s own top pick at ${escapeHtml(band)}.`}</p>

      <h2>Why a &ldquo;score&rdquo; isn&rsquo;t the whole story</h2>
      <p>Score here means the standard chess scoring convention (a win counts 1, a draw counts 0.5) as a percentage, for ${escapeHtml(label)}, from real games at ${escapeHtml(band)}. A high score can partly reflect that a line is comfortable and hard to go wrong in, rather than that it&rsquo;s objectively strongest - which matters more at some rating bands than others, since a beginner and a 2000+ player are not choosing an opening for the same reasons.</p>

      <h2>Go deeper</h2>
      <p>Every opening in the table above links to its own page with a full rating-band breakdown, common mistakes at this level, and real recent games. New to openings entirely? Start with <a href="best-chess-openings-for-beginners.html">best chess openings for beginners &rarr;</a> (1400-1600, unsplit by side). See the <a href="openings.html">full openings comparison &rarr;</a> for all four rating bands and both sides at once${bandNavLinks ? `, or jump between bands for ${escapeHtml(label)}: ${bandNavLinks}` : ''}. See <a href="upgrade-your-repertoire-as-you-improve.html">how to upgrade your repertoire as you improve &rarr;</a> for how these rankings shift as you move up through the rating bands.</p>
    `;
  }

  return { meta, render };
}

function createBestOpeningsByRatingBandPages() {
  const pages = [];
  for (const side of SIDES) {
    for (const band of BANDS) {
      pages.push(createPage(side, band));
    }
  }
  return pages;
}

module.exports = { createBestOpeningsByRatingBandPages, BANDS, SIDES, bandSlug };

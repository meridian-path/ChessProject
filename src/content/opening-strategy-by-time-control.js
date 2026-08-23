'use strict';

/**
 * Editorial guide answering "does my opening choice need to change for
 * blitz vs. rapid vs. classical?" Two kinds of claim are kept strictly
 * separate here, on purpose: general, well-established chess principles
 * about time pressure (stated as such, not as this site's own finding),
 * and this build's own measured numbers (computed from ctx.entries, same
 * as every other guide in this directory). This site's own aggregate
 * pipeline only ever displays ONE speed pool per build (see
 * src/explorerSource.js's DEFAULT_POOL/actualPoolSpeeds doc) -- so this
 * page never fabricates a blitz-vs-rapid-vs-classical score comparison
 * the data doesn't back. It discloses that limitation directly, using the
 * same poolDisclosure() sentence the Repertoire Packs product already
 * uses, rather than staying silent about it.
 */

const SLUG = 'opening-strategy-by-time-control';

const meta = {
  slug: SLUG,
  title: 'Blitz vs. Classical Opening Strategy',
  description: 'Does your opening need to change for bullet, blitz, rapid, or classical? What changes in general, and what this site can and cannot measure about it.',
  targetQuery: 'blitz chess openings vs classical strategy',
  related: ['london-system', 'scandinavian-defense', 'caro-kann-defense'],
};

function render(ctx) {
  const { entries, rankOpeningsByScore, escapeHtml, formatPct, formatGamesAbbrev, wrapTable, poolSpeeds, poolDisclosure } = ctx;

  const defaultBand = entries[0] ? entries[0].model.defaultBand : '1600-1800';

  const whiteEntries = entries.filter((e) => e.openingConfig.side === 'white');
  const blackEntries = entries.filter((e) => e.openingConfig.side === 'black');
  const topWhite = rankOpeningsByScore(whiteEntries, defaultBand)[0] || null;
  const topBlack = rankOpeningsByScore(blackEntries, defaultBand)[0] || null;

  const bySample = [...entries]
    .map(({ openingConfig, model }) => {
      const b = (model.bands || []).find((x) => x.band === defaultBand);
      return b && b.enoughData ? { slug: openingConfig.slug, name: model.name, side: model.side, games: b.games, score: b.scoreForSide } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.games - a.games)
    .slice(0, 8);

  const sampleRows = bySample
    .map(
      (e) => `<tr><td><a href="${escapeHtml(e.slug)}.html">${escapeHtml(e.name)}</a></td><td>${escapeHtml(e.side)}</td><td>${formatGamesAbbrev(e.games)}</td><td>${formatPct(e.score)}%</td></tr>`
    )
    .join('');

  const disclosure = poolSpeeds && poolDisclosure ? poolDisclosure(poolSpeeds) : 'blitz games only';

  return `
    <p>&ldquo;Should I play a different opening for blitz than for classical?&rdquo; comes up constantly, and the honest answer has two parts: general chess principles say time pressure changes what matters in a position, and this site&rsquo;s own numbers can confirm some of that but not all of it. This page keeps those two parts separate rather than blending them into one confident-sounding answer.</p>

    <h2>What changes with less time, in general</h2>
    <p>This is standard, widely-agreed chess advice, not a measurement this site makes itself: the less time both sides have, the more a position&rsquo;s <em>practical</em> difficulty matters next to its objective evaluation. A slightly worse line that is easy to play and hard to go wrong in tends to outperform its &ldquo;theory&rdquo; reputation in bullet and blitz, because the opponent also has less time to find the best response. In rapid and especially classical, both sides have room to calculate, so a line&rsquo;s deeper soundness (and how well you actually understand the resulting middlegame) carries more of the weight. This is also why &ldquo;system&rdquo; openings that repeat the same setup regardless of Black&rsquo;s reply, like the <a href="london-system.html">London System &rarr;</a>, get recommended disproportionately often for faster time controls: less to calculate at the board, at some cost in objective ambition.</p>

    <h2>What this site&rsquo;s own data can and can&rsquo;t tell you</h2>
    <div class="callout">This build&rsquo;s own numbers are computed from ${escapeHtml(disclosure)}. Every score and sample size on this site, including the table below, reflects that one pool - not a blitz-vs-rapid-vs-classical comparison, because this build does not fetch or display more than one pool at a time. A page claiming to show &ldquo;how each opening scores in bullet vs. blitz vs. classical&rdquo; would have to invent numbers this build doesn&rsquo;t have, so this page doesn&rsquo;t make that claim.</div>
    <p>What the data here <em>can</em> support is a proxy for the general principle above: which tracked openings already have the largest, most reliable sample sizes at ${escapeHtml(defaultBand)}, and how they score. A large sample and a strong score at this site&rsquo;s own pool is a reasonable starting point whatever time control you actually play, precisely because it isn&rsquo;t sensitive to a small edge that might not hold up elsewhere:</p>
    ${sampleRows ? wrapTable(`<table><caption class="sr-only">Openings ranked by sample size at ${escapeHtml(defaultBand)}</caption><thead><tr><th scope="col">Opening</th><th scope="col">Side</th><th scope="col">Games</th><th scope="col">Score</th></tr></thead><tbody>${sampleRows}</tbody></table>`, `Openings ranked by sample size at ${defaultBand}`) : '<p class="empty-note">Band data was not available for this build.</p>'}

    <h2>A practical way to use this</h2>
    <p>${topWhite && topBlack
      ? `If you mostly play bullet or blitz, lean toward the mainline, high-sample choices above, like <a href="${escapeHtml(topWhite.slug)}.html">${escapeHtml(topWhite.name)}</a> as White or <a href="${escapeHtml(topBlack.slug)}.html">${escapeHtml(topBlack.name)}</a> as Black at ${escapeHtml(defaultBand)} - well-trodden lines mean fewer unfamiliar positions to solve on the clock. If you mostly play rapid or classical, the same rankings are still a reasonable shortlist, but put more of your study time into understanding the resulting middlegame plans rather than just the first several moves, since you&rsquo;ll actually have time at the board to use that understanding.`
      : `Whatever time control you play most, a mainline choice with a large sample size and a solid score at your rating band (see the table above) is a safer default than a rare line you&rsquo;ve only seen once, precisely because it stays well-tested regardless of how much time either side has.`}
    None of this is a substitute for finding a coach or a stronger player who can watch your actual games and tell you where time pressure specifically costs you points.</p>

    <h2>Go deeper</h2>
    <p>See the <a href="openings.html">full openings comparison &rarr;</a> for every tracked opening at every rating band, <a href="how-to-build-your-opening-repertoire.html">how to build your opening repertoire &rarr;</a> for a fuller method, or the <a href="repertoire.html">repertoire explorer &rarr;</a> to build a starting shortlist by rating band and color.</p>
  `;
}

module.exports = { meta, render };

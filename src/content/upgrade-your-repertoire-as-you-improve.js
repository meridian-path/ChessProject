'use strict';

/**
 * Editorial guide answering "should I change my openings as I improve?" --
 * a question with real, unresolved forum debate and no single authoritative
 * answer (the query evidence behind this task). Two kinds of claim are kept
 * separate, same discipline as every other guide in this directory: general
 * chess-improvement study advice (stated as such), and this build's own
 * real numbers (computed from ctx.entries). The real-numbers section
 * reuses scoreRangeAcrossBands() and rankOpeningsByScore(), the same
 * functions should-you-study-openings-under-1500.js and
 * bestOpeningsByRatingBand.js already use -- no new statistics invented
 * for this page.
 */

const { BANDS, SIDES, bandSlug } = require('./bestOpeningsByRatingBand');

const SLUG = 'upgrade-your-repertoire-as-you-improve';

const meta = {
  slug: SLUG,
  title: 'How to Upgrade Your Repertoire as You Improve',
  description: 'Should you change openings as your rating climbs? What forum debates disagree on, and what this site actually shows about how much scores shift by rating band.',
  targetQuery: 'should I change my opening repertoire as I improve',
  related: [],
};

const TRANSITIONS = [
  {
    from: '1400-1600',
    to: '1600-1800',
    advice: 'Standard improvement advice at this stage favors staying with your current system rather than switching wholesale, but adding one refinement: a second reply to your opponent\'s most common try, instead of following the exact same line every game.',
  },
  {
    from: '1600-1800',
    to: '1800-2000',
    advice: 'This is usually where deepening one opening family pays off more than adding a new one - going one or two moves further into the lines you already play, so you recognize the resulting middlegame plans instead of leaving theory at the same shallow depth you started with.',
  },
  {
    from: '1800-2000',
    to: '2000+',
    advice: 'A common next step is adding a second reply as Black to your main opponent-side opening, so a well-prepared opponent cannot simply steer every game into the one line you know best.',
  },
];

function render(ctx) {
  const { entries, rankOpeningsByScore, scoreRangeAcrossBands, escapeHtml, formatPct, wrapTable } = ctx;

  // Real check #1: does the TOP-ranked tracked opening for each side change
  // as you move up through the bands, or does the same one stay on top the
  // whole way? A genuinely checkable answer to "do I need to reconsider my
  // opening as I improve," computed fresh from this build's own data.
  const topBySideAndBand = SIDES.map((side) => {
    const sideEntries = entries.filter((e) => e.openingConfig.side === side);
    const perBand = BANDS.map((band) => {
      const ranked = rankOpeningsByScore(sideEntries, band);
      return { band, top: ranked[0] || null };
    });
    const distinctTops = new Set(perBand.map((b) => (b.top ? b.top.slug : null)).filter(Boolean));
    return { side, perBand, changes: distinctTops.size > 1, distinctCount: distinctTops.size };
  });

  const topRows = topBySideAndBand
    .flatMap(({ side, perBand }) =>
      perBand.map(({ band, top }) => `<tr><td>${escapeHtml(side)}</td><td>${escapeHtml(band)}</td><td>${top ? `<a href="${escapeHtml(top.slug)}.html">${escapeHtml(top.name)}</a> (${formatPct(top.usedBalanced && top.scoreForSideBalanced != null ? top.scoreForSideBalanced : top.scoreForSide)}%)` : 'not enough data'}</td></tr>`)
    )
    .join('');

  // Real check #2: how much does each tracked opening's OWN score actually
  // move between its lowest- and highest-scoring band? Same computation
  // should-you-study-openings-under-1500.js already uses, reused here
  // rather than re-derived, so the two pages can never quietly disagree.
  const ranges = entries
    .map(({ openingConfig, model }) => ({ slug: openingConfig.slug, name: model.name, range: scoreRangeAcrossBands(model) }))
    .filter((e) => e.range != null);
  const avgRange = ranges.length ? Number((ranges.reduce((s, e) => s + e.range.range, 0) / ranges.length).toFixed(1)) : null;

  const bandLinkRows = BANDS.map((band) => {
    const cells = SIDES.map((side) => `<td><a href="best-${side}-openings-${bandSlug(band)}.html">${escapeHtml(side)} at ${escapeHtml(band)} &rarr;</a></td>`).join('');
    return `<tr><td>${escapeHtml(band)}</td>${cells}</tr>`;
  }).join('');

  return `
    <p>&ldquo;I&rsquo;m improving, should I change my openings?&rdquo; is one of the most repeated questions on chess forums, and it does not have a single authoritative answer - different strong players give genuinely different advice. This page separates two things that usually get blended together: standard, general improvement advice about HOW to approach the question, and what this site&rsquo;s own real data can check about WHETHER the answer to it actually changes as you climb.</p>

    <h2>Does the top-scoring opening actually change by band?</h2>
    <p>For each side, this is the highest-scoring tracked opening at each rating band this site tracks, computed fresh from this build&rsquo;s own data:</p>
    ${topRows ? wrapTable(`<table><caption class="sr-only">Top-scoring tracked opening by side and rating band</caption><thead><tr><th scope="col">Side</th><th scope="col">Band</th><th scope="col">Top opening</th></tr></thead><tbody>${topRows}</tbody></table>`, 'Top-scoring tracked opening by side and rating band') : '<p class="empty-note">Band data was not available for this build.</p>'}
    <p>${topBySideAndBand.every((s) => !s.changes)
      ? 'In this build, the same opening stays the top scorer across every band this site tracks, for both sides. That is a real result from this build&rsquo;s own numbers, not a general claim about chess - it does not mean no opening ever needs reconsidering, only that among the specific openings this site tracks, the leaderboard itself did not reshuffle.'
      : `In this build, the top spot changes hands at least once for ${topBySideAndBand.filter((s) => s.changes).length} of the ${topBySideAndBand.length} sides tracked. That is a real signal that &ldquo;what scores best&rdquo; is not fixed as rating climbs, at least among the openings this site tracks - though a change in rank does not by itself mean the difference is large enough to matter (see the range figures below).`}</p>

    <h2>How much does an opening&rsquo;s own score actually move?</h2>
    <p>A separate, complementary question: for the SAME opening, how much does its own score move between the lowest- and highest-scoring band this site tracks? This reuses the exact figures the <a href="should-you-study-openings-under-1500.html">should you study openings under 1500 &rarr;</a> guide already computes.</p>
    ${avgRange != null
      ? `<p>Averaged across the ${ranges.length} openings with enough data to compare, the typical range is <strong>${avgRange} percentage points</strong>. That is a real, measurable difference, but it is a modest one - rarely large enough on its own to justify abandoning an opening you already understand well, which is why the transition advice below leans toward refining and deepening rather than replacing.</p>`
      : '<p class="empty-note">Not enough band data was available in this build to compute a range.</p>'}

    <h2>A practical path through the transitions</h2>
    <p>This part is standard, general chess-improvement advice, not a measurement this site makes - stated as such rather than dressed up as a data finding:</p>
    <ul>
      ${TRANSITIONS.map((t) => `<li><strong>${escapeHtml(t.from)} to ${escapeHtml(t.to)}:</strong> ${escapeHtml(t.advice)}</li>`).join('')}
    </ul>
    <p>The common thread: each step adds one piece of depth or one extra option, rather than throwing out what already works. See each band&rsquo;s own ranked list below for what actually scores well there among the openings this site tracks:</p>
    ${wrapTable(`<table><caption class="sr-only">Best openings by side and rating band</caption><thead><tr><th scope="col">Band</th><th scope="col">Best for White</th><th scope="col">Best for Black</th></tr></thead><tbody>${bandLinkRows}</tbody></table>`, 'Best openings by side and rating band')}

    <h2>Go deeper</h2>
    <p>See <a href="how-to-build-your-opening-repertoire.html">how to build your opening repertoire &rarr;</a> for the fuller method this page&rsquo;s transition advice builds on, or the <a href="openings.html">full openings comparison &rarr;</a> for every tracked opening at every band.</p>
  `;
}

module.exports = { meta, render, TRANSITIONS };

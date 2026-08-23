'use strict';

/**
 * Editorial guide answering "how should I prepare openings differently for
 * rapid than for blitz or classical?" -- distinct from
 * opening-strategy-by-time-control.js's own broader "does my opening need
 * to change across time controls" survey (which explicitly limits itself to
 * a light "practical way to use this" note on rapid, not a dedicated
 * prep-depth guide). This page answers a narrower, more actionable
 * question: how MUCH opening prep actually pays off at rapid time
 * controls, and which of this build's own tracked openings fit that prep
 * budget.
 *
 * Same two-claims-kept-separate discipline as every other guide in this
 * directory: general, well-established chess advice about time pressure
 * and prep depth (stated as such, not as this site's own finding), and
 * this build's own measured numbers (computed from ctx.entries, with the
 * same honest pool disclosure opening-strategy-by-time-control.js already
 * uses). This build only ever fetches one speed pool (blitz, in the
 * normal aggregate-backed build -- src/explorerSource.js's
 * actualPoolSpeeds()), so this page uses that blitz data as a stated
 * proxy for rapid rather than claiming rapid-specific numbers it doesn't
 * have: blitz and rapid both reward prep that survives time pressure, in
 * a way classical (deep calculation available) and bullet (no real prep
 * pays off at all) don't -- a defensible analogy, disclosed as one,
 * never presented as a rapid measurement.
 */

const SLUG = 'rapid-chess-opening-prep';

const meta = {
  slug: SLUG,
  title: 'Rapid Chess Opening Prep',
  description: 'How much opening prep actually pays off in rapid chess, and which openings need the least of it - a practical prep budget, not a blitz-vs-classical survey.',
  targetQuery: 'opening preparation for rapid chess',
  related: ['london-system', 'italian-game', 'caro-kann-defense'],
};

function render(ctx) {
  const { entries, escapeHtml, formatPct, formatGamesAbbrev, wrapTable, poolSpeeds, poolDisclosure } = ctx;

  const defaultBand = entries[0] ? entries[0].model.defaultBand : '1600-1800';

  const bySample = [...entries]
    .map(({ openingConfig, model }) => {
      const b = (model.bands || []).find((x) => x.band === defaultBand);
      return b && b.enoughData ? { slug: openingConfig.slug, name: model.name, side: model.side, games: b.games, score: b.scoreForSide } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.games - a.games)
    .slice(0, 8);

  const sampleRows = bySample
    .map((e) => `<tr><td><a href="${escapeHtml(e.slug)}.html">${escapeHtml(e.name)}</a></td><td>${escapeHtml(e.side)}</td><td>${formatGamesAbbrev(e.games)}</td><td>${formatPct(e.score)}%</td></tr>`)
    .join('');

  const disclosure = poolSpeeds && poolDisclosure ? poolDisclosure(poolSpeeds) : 'blitz games only';
  const topPick = bySample[0] || null;
  const topPickSideLabel = topPick ? (topPick.side === 'white' ? 'White' : 'Black') : null;

  return `
    <p>&ldquo;How should I prepare openings for rapid?&rdquo; has a different answer than the same question for blitz or classical, and most opening advice doesn&rsquo;t separate the three. This page is specifically about the prep <em>budget</em> rapid time controls actually justify - not whether your opening choice should change at all (see <a href="opening-strategy-by-time-control.html">Blitz vs. Classical Opening Strategy &rarr;</a> for that broader question).</p>

    <h2>Why rapid sits in its own prep budget</h2>
    <p>This is standard, widely-agreed chess advice, not a measurement this site makes itself. At bullet and fast blitz, there usually isn&rsquo;t enough time for either side to punish an unfamiliar position with real calculation - so deep opening prep has a low ceiling on how much it can actually win you. At classical, both sides have room to think for real, so a repertoire that rewards genuine, deep preparation (sharp theoretical lines, long forcing sequences) pays off in a way it often can&rsquo;t at faster controls. Rapid sits between those: enough time that a bad plan gets punished, not enough time to out-calculate an opponent from a position neither of you has seen before. Given that, the prep worth doing for rapid sits at a fixed, moderate depth: your first several moves solid, plus the typical middlegame plan they lead to, so you&rsquo;re never spending your own clock re-deriving the opening from first principles. Memorizing lines past that depth is classical-repertoire work; skipping prep entirely is a habit worth keeping for bullet, not rapid.</p>

    <h2>What needs the least of that budget</h2>
    <p class="confound-note">This build&rsquo;s own numbers are computed from ${escapeHtml(disclosure)}. Blitz and rapid both sit on the time-pressured side of that principle above (unlike classical), so this is used here as a stated proxy for rapid prep value, not a rapid-specific measurement - this build does not fetch or display more than one speed pool at a time.</p>
    <p>A large, reliable sample size at ${escapeHtml(defaultBand)} is a reasonable proxy for &ldquo;well-trodden and low-surprise&rdquo;: openings enough players already reach that this site has real data on them, which tends to track lines with fewer sidelines to memorize before they start paying off. Ranked by sample size, not score - the ordering below answers &ldquo;which of these needs the least prep to reach,&rdquo; not &ldquo;which is strongest&rdquo;:</p>
    ${sampleRows ? wrapTable(`<table><caption class="sr-only">Openings ranked by sample size at ${escapeHtml(defaultBand)}</caption><thead><tr><th scope="col">Opening</th><th scope="col">Side</th><th scope="col">Games</th><th scope="col">Score</th></tr></thead><tbody>${sampleRows}</tbody></table>`, `Openings ranked by sample size at ${defaultBand}`) : '<p class="empty-note">Band data was not available for this build.</p>'}

    <h2>A practical rapid prep routine</h2>
    <p>${topPick
      ? `Pick one opening per color from a shortlist like the one above - <a href="${escapeHtml(topPick.slug)}.html">${escapeHtml(topPick.name)}</a> as ${escapeHtml(topPickSideLabel)} is this build&rsquo;s own top-sample pick at ${escapeHtml(defaultBand)} - and learn it to a fixed, shallow depth: the first 5-8 moves cold, plus one sentence per side on what each is trying to do in the middlegame that follows. That&rsquo;s the ceiling worth spending rapid study time on. Anything past that depth is classical-repertoire work, not rapid prep, and won&rsquo;t come up often enough at rapid time controls to be worth the hours.`
      : `Pick one opening per color, learn it to a fixed, shallow depth - the first 5-8 moves cold, plus one sentence per side on the middlegame plan that follows - and stop there. That depth is the ceiling rapid time controls actually reward; anything deeper is classical-repertoire work.`}
    None of this is a substitute for reviewing your own actual rapid games to see where you specifically run out of preparation.</p>

    <h2>Go deeper</h2>
    <p>See <a href="opening-strategy-by-time-control.html">Blitz vs. Classical Opening Strategy &rarr;</a> for how time control affects opening choice more broadly, <a href="how-to-build-your-opening-repertoire.html">how to build your opening repertoire &rarr;</a> for a fuller method, or the <a href="repertoire.html">repertoire explorer &rarr;</a> to build a shortlist by rating band and color.</p>
  `;
}

module.exports = { meta, render };

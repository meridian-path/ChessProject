'use strict';

/**
 * Editorial guide. Every number in `render()` is computed at build time from
 * `ctx.entries` -- the same already-fetched opening models the opening pages
 * themselves use -- so this file has no hand-typed statistics to go stale or
 * be wrong. The worked examples (which opening has the biggest/smallest
 * sample, which position's most-played reply underperforms its best-scoring
 * one) are SELECTED from the data at build time too, so a re-fetch can
 * legitimately change which openings this article uses as examples. To
 * regenerate, re-run `npm run build:static`; a human should spot-check the
 * rendered output before it ships publicly.
 */

const SLUG = 'how-to-build-your-opening-repertoire';

const meta = {
  slug: SLUG,
  title: 'How to Build Your Opening Repertoire',
  description: 'A data-first method for choosing your openings: reading Opening Explorer stats, weighing win rate against sample size, and when deviating is fine.',
  targetQuery: 'how to build an opening repertoire',
  related: ['italian-game', 'caro-kann-defense'],
};

const MIN_REPLY_GAMES = 1000;

/** Standard chess score (win=1, draw=0.5) for a reply row, or null when either rate is suppressed. */
function replyScore(m) {
  return m.winPct == null || m.drawPct == null ? null : Number((m.winPct + m.drawPct / 2).toFixed(1));
}

function render(ctx) {
  const { entries, escapeHtml, formatPct, formatGamesAbbrev, formatSanLine, wrapTable } = ctx;

  // Step 1's shortlist: every tracked opening with usable default-band data,
  // White choices first, best score first within each side.
  const shortlist = entries
    .map(({ openingConfig, model }) => {
      const band = model.bands.find((b) => b.band === model.defaultBand);
      return band && band.enoughData
        ? { slug: openingConfig.slug, name: model.name, side: model.side, line: openingConfig.line, band }
        : null;
    })
    .filter(Boolean)
    .sort((a, b) => (a.side === b.side ? b.band.scoreForSide - a.band.scoreForSide : a.side === 'white' ? -1 : 1));

  const shortlistRows = shortlist
    .map(
      (e) => `<tr><td>${escapeHtml(e.side)}</td><td><a href="${escapeHtml(e.slug)}.html">${escapeHtml(e.name)}</a></td><td>${escapeHtml(formatSanLine(e.line))}</td><td>${formatPct(e.band.scoreForSide)}%</td><td>${formatGamesAbbrev(e.band.games)}</td></tr>`
    )
    .join('');

  // Step 2's worked example: within one tracked position, the most-played
  // candidate reply against the least-played one -- the sample-size cliff a
  // reader actually falls off when they follow a rarer move, shown from this
  // build's own numbers. Picks the position with the steepest cliff (largest
  // games ratio) so the contrast is as real as the data allows.
  let cliff = null;
  for (const { model } of entries) {
    const replies = (model.topReplies || []).filter((m) => m.games > 0 && m.winPct != null && m.winCI != null);
    if (replies.length < 2) continue;
    const most = [...replies].sort((a, b) => b.games - a.games)[0];
    const least = [...replies].sort((a, b) => a.games - b.games)[0];
    if (most.games <= least.games) continue;
    const ratio = most.games / least.games;
    if (cliff == null || ratio > cliff.ratio) {
      cliff = { openingSlug: model.slug, openingName: model.name, band: model.defaultBand, side: model.opponentColor, most, least, ratio };
    }
  }
  // Never print a bare "+/-0.0" -- an interval that rounds to zero reads as
  // "zero uncertainty", which is the one thing an interval must never claim.
  const ciText = (ci) => (ci < 0.05 ? 'under 0.1' : formatPct(ci));
  const sampleExampleHtml = cliff
    ? `<p>Here&rsquo;s the cliff inside a single position from this build. In the <a href="${escapeHtml(cliff.openingSlug)}.html">${escapeHtml(cliff.openingName)}</a> position at ${escapeHtml(cliff.band)}, the most-played reply, <strong>${escapeHtml(cliff.most.san)}</strong>, has ${cliff.most.games.toLocaleString()} games behind its ${formatPct(cliff.most.winPct)}% win rate. The least-played candidate on the same menu, <strong>${escapeHtml(cliff.least.san)}</strong>, has ${cliff.least.games.toLocaleString()}, about ${Math.round(cliff.ratio).toLocaleString()}&times; fewer. Here both samples are still large enough that the &plusmn; stays small (${ciText(cliff.most.winCI)} and ${ciText(cliff.least.winCI)} points respectively), but the wobble scales as one over the square root of the sample, so every 100&times; drop in games multiplies the &plusmn; by 10. Follow a rare move two or three times in a row, where positions often carry a few thousand games rather than a few million, and that same arithmetic puts the &plusmn; past a full point, wider than most of the score gaps you&rsquo;d be using the number to judge.</p>`
    : '<p class="empty-note">This build did not have a position with enough distinct replies to show a sample-size comparison.</p>';

  // Step 3's worked example: a tracked position where the most-played reply
  // is NOT the best-scoring reply (among replies with a real sample) -- the
  // popularity trap, shown from this site's own data rather than asserted.
  // Picks the example with the largest score gap so the contrast is real
  // rather than within-noise.
  let trap = null;
  for (const { openingConfig, model } of entries) {
    const replies = (model.topReplies || [])
      .filter((m) => m.games >= MIN_REPLY_GAMES)
      .map((m) => ({ ...m, score: replyScore(m), scoreCIApprox: m.winCI != null && m.drawCI != null ? m.winCI + m.drawCI / 2 : null }))
      .filter((m) => m.score != null && m.scoreCIApprox != null);
    if (replies.length < 2) continue;
    const mostPlayed = [...replies].sort((a, b) => b.games - a.games)[0];
    const bestScoring = [...replies].sort((a, b) => b.score - a.score)[0];
    if (mostPlayed.san === bestScoring.san) continue;
    const gap = bestScoring.score - mostPlayed.score;
    // Only present a gap the data can actually distinguish: it must clear
    // both replies' (conservatively combined) score uncertainty -- the same
    // don't-read-noise-as-signal rule step 2 just taught.
    if (gap <= mostPlayed.scoreCIApprox + bestScoring.scoreCIApprox) continue;
    if (trap == null || gap > trap.gap) {
      trap = { openingSlug: openingConfig.slug, openingName: model.name, band: model.defaultBand, side: model.opponentColor, mostPlayed, bestScoring, gap };
    }
  }
  const trapHtml = trap
    ? `<p>Here&rsquo;s a live example from this build. In the <a href="${escapeHtml(trap.openingSlug)}.html">${escapeHtml(trap.openingName)}</a> position at ${escapeHtml(trap.band)}, the most-played reply is <strong>${escapeHtml(trap.mostPlayed.san)}</strong> (${formatGamesAbbrev(trap.mostPlayed.games)} games), scoring ${formatPct(trap.mostPlayed.score)}% for ${escapeHtml(trap.side)}. But <strong>${escapeHtml(trap.bestScoring.san)}</strong> (${formatGamesAbbrev(trap.bestScoring.games)} games) scores ${formatPct(trap.bestScoring.score)}%, a ${formatPct(trap.gap)}-point difference that comfortably clears both moves&rsquo; &plusmn; ranges. Players keep choosing the first move anyway, mostly because it&rsquo;s the move they&rsquo;ve seen. Popularity measures how familiar a move is, more than it measures how well it scores.</p>`
    : '<p class="empty-note">In this build, no tracked position had a most-played reply that measurably underperformed the best-scoring one by more than the data&rsquo;s own uncertainty, a rarity worth noting in itself.</p>';

  // Step 4's count: how many tracked positions have at least one common move
  // that measurably underperforms (the same CI-gated test the opening pages
  // use) -- evidence that "just play the common moves" fails somewhere
  // specific, not a vague claim that club players make mistakes.
  const mistakeCount = entries.filter((e) => (e.model.mistakes || []).length > 0).length;

  return `
    <p>An opening repertoire sounds like something only titled players need. In practice it just means a prepared answer to 1.e4, a prepared answer to 1.d4, and one or two choices of your own with White: a handful of positions you understand, instead of a different surprise every game. This page is a method for choosing that handful using real game data, with every example below computed directly from this site&rsquo;s own tracked positions.</p>

    <h2>Step 1: start from a shortlist</h2>
    <p>There are hundreds of named openings; you need about four. The ${shortlist.length || 'ten'} tracked on this site are a deliberately conventional starting menu: mainstream, sound, and common enough at club level that there&rsquo;s real data on each.</p>
    ${shortlistRows ? wrapTable(`<table><caption class="sr-only">Tracked openings with score and sample size at 1600-1800</caption><thead><tr><th scope="col">You play</th><th scope="col">Opening</th><th scope="col">Line</th><th scope="col">Score</th><th scope="col">Games</th></tr></thead><tbody>${shortlistRows}</tbody></table>`, 'Tracked openings with score and sample size at 1600-1800') : '<p class="empty-note">Opening data was not available in this build.</p>'}
    <p>Pick candidates by the positions you like being in, then use the numbers to referee between them. A 2-point score edge will not save you in a position you hate playing.</p>

    <h2>Step 2: weigh the sample size before the win rate</h2>
    <p>The single most common way to misread Opening Explorer stats is treating every percentage as equally solid. A score from 500 games can easily be several points away from the &ldquo;true&rdquo; number; a score from half a million games barely moves. The &plusmn; figures on this site&rsquo;s tables are exactly this: the statistical wobble left in each percentage given how many games produced it. At the mainline crossroads in the table above, the samples run to tens of millions and the wobble is negligible, so those score columns you can simply trust. The trap is that sample sizes fall off a cliff the moment you leave the main road, while the percentages keep looking just as confident.</p>
    ${sampleExampleHtml}
    <p>The practical rule: when two moves&rsquo; scores sit closer together than their &plusmn; ranges are wide, treating &ldquo;53.1 beats 52.4&rdquo; as a real difference is reading noise as signal.</p>

    <h2>Step 3: don&rsquo;t confuse popular with good</h2>
    <p>The biggest number on any explorer page is the games count next to the most common move, and it quietly suggests that move is the answer. Sometimes it is. Often the second- or third-most-played move scores meaningfully better, because popularity lags what actually works at your level.</p>
    ${trapHtml}

    <h2>Step 4: deviate from theory where the data says to</h2>
    <p>&ldquo;Theory&rdquo; is the record of what works when both sides know what they&rsquo;re doing, which is not a description of club chess. ${mistakeCount > 0
      ? `In ${mistakeCount} of the ${entries.length} positions this site tracks, at least one reply that&rsquo;s <em>common</em> at 1600-1800 measurably underperforms the position&rsquo;s average, even after accounting for sample size.`
      : `This site applies a deliberately strict test for calling a common move a measurable underperformer (the gap has to clear the statistical uncertainty on both sides, among evenly-matched opponents). In the current build&rsquo;s data, no tracked position clears that bar, which is itself a useful calibration: most &ldquo;that move is a mistake&rdquo; claims you&rsquo;ll hear are not backed by a gap the data can actually distinguish.`}
    Two consequences for your repertoire: a slightly offbeat line that scores well at your band is a legitimate choice, whatever a database of master games thinks of it, and the moves worth memorizing first are the ones that punish what your opponents actually play. <a href="most-common-opening-mistakes-1600-1800.html">The most common opening mistakes at 1600-1800 &rarr;</a> applies this same test position by position.</p>

    <h2>Step 5: keep it small, then test it against real games</h2>
    <p>Four openings, understood, beat twelve memorized (see <a href="how-many-chess-openings-should-you-learn.html">how many chess openings should you learn? &rarr;</a> for the fuller case). Once you&rsquo;ve picked, the maintenance loop is short: play the lines, notice where you keep landing in trouble, and check that exact position&rsquo;s numbers at your own rating band before deciding whether the problem is the opening or the middlegame that followed it. For a ready-made starting point by rating and color, see the <a href="repertoire.html">repertoire explorer &rarr;</a>; for the full band-by-band numbers behind every opening above, the <a href="openings.html">openings comparison &rarr;</a>. If you&rsquo;d rather not pick the replies yourself, the <a href="repertoire-packs.html">repertoire packs &rarr;</a> apply this same rule (highest lower-bound scorer, pruned to a size you can actually memorize) to one color and rating band, delivered as a PGN, a drill file, and the printed reasoning behind every move.</p>
  `;
}

module.exports = { meta, render };

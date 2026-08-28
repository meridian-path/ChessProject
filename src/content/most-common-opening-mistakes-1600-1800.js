'use strict';

// This page predates ./mostCommonOpeningMistakesByBand.js's 3-sibling
// factory (1400-1600/1800-2000/2000+) and stays its own file rather than
// folding into that factory -- it was the original, is still this site's
// DEFAULT_BAND, and its own targetQuery/description wording differs slightly
// from the generated siblings'. See that factory's own header comment for
// why the siblings only became buildable once findCommonMistakes() was
// generalized to run against every already-fetched band, not just this one.
const SLUG = 'most-common-opening-mistakes-1600-1800';
const { mistakesPageSlug } = require('./mostCommonOpeningMistakesByBand');

const meta = {
  slug: SLUG,
  title: 'The Most Common Opening Mistakes at 1600-1800',
  description: "Moves that are played often but score badly at 1600-1800, aggregated across every opening this site tracks, straight from the arithmetic of real game outcomes.",
  targetQuery: 'most common opening mistakes club level',
  related: [],
};

function render(ctx) {
  const { entries, aggregateMistakesAcrossOpenings, escapeHtml, displayName, formatPct } = ctx;
  const all = aggregateMistakesAcrossOpenings(entries);

  const items = all
    .slice(0, 10)
    .map((m) => {
      const follow = m.punishingReply
        ? ` The most common answer, <strong>${escapeHtml(m.punishingReply.san)}</strong>, scores ${
            m.punishingReply.winPct != null ? formatPct(m.punishingReply.winPct + m.punishingReply.drawPct / 2) : '?'
          }% for the side punishing it.`
        : '';
      return `<li class="callout">In the <a href="${escapeHtml(m.slug)}.html">${displayName(m.name)}</a>, <strong>${escapeHtml(m.san)}</strong> is played in ${formatPct(m.playedPct)}% of games at ${escapeHtml(m.defaultBand)} but scores only ${formatPct(m.score)}% for ${escapeHtml(m.opponentColor)}.${follow}</li>`;
    })
    .join('');

  return `
    <p>Every opening page on this site computes &ldquo;common mistakes&rdquo; the same honest way: a move that&rsquo;s played often enough to matter, but that scores badly for the side playing it, according to real games at that rating band. No engine evaluation, no &ldquo;this loses a piece&rdquo; claims - an engine can tell you a move is objectively bad, but not whether players at your own level actually get punished for it in a real game. Just a move&rsquo;s actual result rate compared to how often it gets played. This page pulls those results together across all ${entries.length} openings this site tracks, worst-scoring first.</p>

    ${all.length === 0
      ? '<p class="empty-note">No qualifying mistakes were found across the tracked openings in this build. That itself is a real result, not a placeholder.</p>'
      : `<h2>Ranked worst-scoring first</h2><ul class="callout-list">${items}</ul>`}

    <h2>How to read this</h2>
    <p>&ldquo;Scores only X%&rdquo; uses standard chess scoring (a win counts 1, a draw counts 0.5) as a percentage. A move sitting at 40% isn&rsquo;t losing by force. It&rsquo;s simply performing below break-even in practice at this rating band, in this exact position, in the sample of games this site&rsquo;s build actually saw. That&rsquo;s a statement about a rating band&rsquo;s habits, not a claim about the objective evaluation of the move.</p>

    <h2>Go deeper</h2>
    <p>Each opening&rsquo;s own page has the full breakdown by rating band, top replies, and real recent club games. See the <a href="openings.html">full openings comparison &rarr;</a>, or see how these same mistakes look at other rating bands: <a href="${mistakesPageSlug('1400-1600')}.html">Mistakes at 1400-1600</a> &middot; <a href="${mistakesPageSlug('1800-2000')}.html">Mistakes at 1800-2000</a> &middot; <a href="${mistakesPageSlug('2000+')}.html">Mistakes at 2000+</a>.</p>
  `;
}

module.exports = { meta, render };

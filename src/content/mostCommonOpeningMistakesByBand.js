'use strict';

/**
 * Factory for the 3 "most common opening mistakes at [band]" guides that
 * parallel the original most-common-opening-mistakes-1600-1800.js (kept as
 * its own file, unchanged, since it predates this factory and nothing about
 * its own behavior needs to change). Same reasoning as
 * bestOpeningsByRatingBand.js's own header comment: one factory rather than
 * 3 near-duplicate files, every number pulled from ctx.entries the same way.
 *
 * Why this didn't ship earlier: findCommonMistakes() (src/processOpenings.js)
 * used to only ever run against the DEFAULT_BAND response inside
 * buildOpeningModel. That was mistaken for a real data limitation in an
 * earlier pass (recentGames genuinely is default-band-only, since the dump
 * aggregate carries no per-game records at any band -- but the SEPARATE
 * `.balanced`/`resultingBalanced` fields findCommonMistakes() actually needs
 * are attached identically for every band by aggregateSource.js's
 * explorerShapedResponse(), since they're a property of the position lookup
 * itself, not of which call site asks for it). buildOpeningModel now exposes
 * `mistakesByBand` (every already-fetched band, zero extra Explorer calls)
 * alongside the original `mistakes` field, which these pages read via
 * processOpenings.js's aggregateMistakesAcrossOpenings(entries, band).
 *
 * Scope note carried over from the parent task: unlike the 1600-1800 page,
 * these 3 pages never show a "most common answer" punishing-reply detail --
 * that needs one more conditional Explorer fetch per band (only made today
 * for the default band's top mistake) and is left as a disclosed future
 * enhancement. aggregateMistakesAcrossOpenings() already returns
 * `punishingReply: null` in that case, and the shared render() below treats
 * it as optional, same as the original page already does when a mistake
 * happens to have none.
 */

const { BANDS, bandSlug } = require('./bestOpeningsByRatingBand');

const ORIGINAL_BAND = '1600-1800';
const OTHER_BANDS = BANDS.filter((b) => b !== ORIGINAL_BAND);

function mistakesPageSlug(band) {
  return `most-common-opening-mistakes-${bandSlug(band)}`;
}

function bandNavLinks(band, escapeHtml) {
  const bandIndex = BANDS.indexOf(band);
  const prevBand = bandIndex > 0 ? BANDS[bandIndex - 1] : null;
  const nextBand = bandIndex < BANDS.length - 1 ? BANDS[bandIndex + 1] : null;
  return [
    prevBand ? `<a href="${mistakesPageSlug(prevBand)}.html">&larr; Mistakes at ${escapeHtml(prevBand)}</a>` : null,
    nextBand ? `<a href="${mistakesPageSlug(nextBand)}.html">Mistakes at ${escapeHtml(nextBand)} &rarr;</a>` : null,
  ].filter(Boolean).join(' &middot; ');
}

function createPage(band) {
  const slug = mistakesPageSlug(band);

  const meta = {
    slug,
    title: `The Most Common Opening Mistakes at ${band}`,
    description: `Moves that are played often but score badly at ${band}, aggregated across every opening this site tracks, straight from the arithmetic of real game outcomes.`,
    targetQuery: `most common opening mistakes at ${band}`,
    related: [],
  };

  function render(ctx) {
    const { entries, aggregateMistakesAcrossOpenings, escapeHtml, displayName, formatPct } = ctx;
    const all = aggregateMistakesAcrossOpenings(entries, band);

    const items = all
      .slice(0, 10)
      .map((m) => {
        const follow = m.punishingReply
          ? ` The most common answer, <strong>${escapeHtml(m.punishingReply.san)}</strong>, scores ${
              m.punishingReply.winPct != null ? formatPct(m.punishingReply.winPct + m.punishingReply.drawPct / 2) : '?'
            }% for the side punishing it.`
          : '';
        return `<li class="callout">In the <a href="${escapeHtml(m.slug)}.html">${displayName(m.name)}</a>, <strong>${escapeHtml(m.san)}</strong> is played in ${formatPct(m.playedPct)}% of games at ${escapeHtml(m.band)} but scores only ${formatPct(m.score)}% for ${escapeHtml(m.opponentColor)}.${follow}</li>`;
      })
      .join('');

    return `
      <p>Every opening page on this site computes &ldquo;common mistakes&rdquo; the same honest way: a move that&rsquo;s played often enough to matter, but that scores badly for the side playing it, according to real games at that rating band. No engine evaluation, no &ldquo;this loses a piece&rdquo; claims. Just a move&rsquo;s actual result rate compared to how often it gets played. This page pulls those results together across all ${entries.length} openings this site tracks at ${escapeHtml(band)}, worst-scoring first.</p>

      ${all.length === 0
        ? '<p class="empty-note">No qualifying mistakes were found across the tracked openings in this build. That itself is a real result, not a placeholder.</p>'
        : `<h2>Ranked worst-scoring first</h2><ul class="callout-list">${items}</ul>`}

      <h2>How to read this</h2>
      <p>&ldquo;Scores only X%&rdquo; uses standard chess scoring (a win counts 1, a draw counts 0.5) as a percentage. A move sitting at 40% isn&rsquo;t losing by force. It&rsquo;s simply performing below break-even in practice at this rating band, in this exact position, in the sample of games this site&rsquo;s build actually saw. That&rsquo;s a statement about a rating band&rsquo;s habits, not a claim about the objective evaluation of the move.</p>

      <h2>Go deeper</h2>
      <p>Each opening&rsquo;s own page has the full breakdown by rating band, top replies, and real recent club games. See the <a href="openings.html">full openings comparison &rarr;</a>, or see how these same mistakes look at other rating bands: ${bandNavLinks(band, escapeHtml)}.</p>
    `;
  }

  return { meta, render };
}

function createOpeningMistakesByBandPages() {
  return OTHER_BANDS.map((band) => createPage(band));
}

module.exports = { createOpeningMistakesByBandPages, OTHER_BANDS, mistakesPageSlug };

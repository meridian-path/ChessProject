'use strict';

const SLUG = 'should-you-study-openings-under-1500';

const meta = {
  slug: SLUG,
  title: 'Should You Study Openings Under 1500?',
  description: 'Standard advice says opening theory barely matters below 1500. Here is how much each tracked opening\'s score actually moves between rating bands.',
  targetQuery: 'should you study openings under 1500',
  related: [],
};

function render(ctx) {
  const { entries, scoreRangeAcrossBands, escapeHtml, formatPct, wrapTable } = ctx;

  const withRange = entries
    .map(({ openingConfig, model }) => ({ slug: openingConfig.slug, name: model.name, side: model.side, range: scoreRangeAcrossBands(model) }))
    .filter((e) => e.range != null);

  const sorted = [...withRange].sort((a, b) => b.range.range - a.range.range);
  const avgRange = sorted.length
    ? sorted.reduce((s, e) => s + e.range.range, 0) / sorted.length
    : null;

  const rows = sorted
    .map(
      (e) => `<tr><td><a href="${escapeHtml(e.slug)}.html">${escapeHtml(e.name)}</a></td><td>${e.range.minBand} (${formatPct(e.range.minScore)}%)</td><td>${e.range.maxBand} (${formatPct(e.range.maxScore)}%)</td><td>${e.range.range} pts</td></tr>`
    )
    .join('');

  return `
    <p>&ldquo;Don&rsquo;t study openings, just learn tactics and endgames&rdquo; is standard advice for players under 1500, and it&rsquo;s aimed at how you should spend study time - not really a claim about whether openings themselves perform differently by rating. This page checks a version of that second question that actually is measurable: for the exact same opening line, how much does the featured side&rsquo;s score change between rating bands?</p>

    <h2>Score range, by opening</h2>
    <p>For each opening this site tracks, this compares its lowest-scoring rating band to its highest-scoring one (among bands with enough games to trust a percentage):</p>
    ${rows ? wrapTable(`<table><caption class="sr-only">Score range across rating bands, by opening</caption><thead><tr><th scope="col">Opening</th><th scope="col">Lowest band</th><th scope="col">Highest band</th><th scope="col">Range</th></tr></thead><tbody>${rows}</tbody></table>`, 'Score range across rating bands, by opening') : '<p class="empty-note">Not enough band data was available in this build to compute a range.</p>'}

    ${avgRange != null ? `<p>Averaged across all ${sorted.length} openings with enough data to compare, the typical score range between the lowest- and highest-scoring rating band is <strong>${formatPct(avgRange)} percentage points</strong>. That&rsquo;s a real difference, but it&rsquo;s a modest one next to how much game results are actually decided by tactics and endgame technique at these ratings - which this site doesn&rsquo;t measure, but which every serious chess-improvement resource agrees dominates below 1500.</p>` : ''}

    <h2>What this does and doesn&rsquo;t show</h2>
    <p>This measures whether the SAME position scores differently by rating band - it does not measure whether studying openings improves your results faster than studying anything else, which would need a completely different kind of study (tracking individual players&rsquo; progress over time), not a snapshot of aggregate game data.</p>

    <h2>Go deeper</h2>
    <p>See any opening&rsquo;s own page for its full band-by-band breakdown, or the <a href="openings.html">full openings comparison &rarr;</a> for all ${entries.length} at once.</p>
  `;
}

module.exports = { meta, render };

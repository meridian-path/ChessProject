'use strict';

// "Opening principles" (develop your pieces, fight for the center, get your
// king safe) are standard beginner advice, stated as general wisdom rather
// than as a checkable claim. This page checks a version of it that this
// site's own data actually supports: does classifying a REAL, already-played
// reply move (from model.topReplies -- the same per-move data every opening
// page's "what people actually play next" section already uses) into one of
// the three classic categories correlate with how well that move scores?
//
// The categorization below is pure SAN-notation pattern matching, disclosed
// in full on the page itself -- no chess-engine evaluation and no hand-typed
// judgment about any specific position, same "arithmetic, not engine
// evaluation" discipline most-common-opening-mistakes-1600-1800.js already
// uses. It will under-classify (many real moves match none of the three
// patterns) rather than guess -- see classifyMove()'s doc.
const SLUG = 'opening-principles-by-win-rate';

const meta = {
  slug: SLUG,
  title: 'Opening Principles, by Win Rate',
  description: 'Develop pieces, fight the center, castle early: classic advice. How moves matching each pattern actually score, by opening, in real Lichess data.',
  targetQuery: 'opening principles win rate',
  related: [],
};

const CATEGORIES = [
  { key: 'king-safety', label: 'King safety', rule: 'the move is castling (O-O or O-O-O)' },
  { key: 'development', label: 'Development', rule: 'the move is a knight or bishop move (SAN starts with N or B) - develops a minor piece off the back rank' },
  { key: 'center-control', label: 'Center control', rule: 'the move is a pawn push straight to a central file: c, d, or e (SAN is exactly a c/d/e file letter plus a rank, e.g. "d4" or "e5"; pawn captures and flank pawn moves like a3/h6/g6 don\'t count - see "What this doesn\'t classify" below)' },
];

/**
 * Classifies one already-played SAN move into a principle category by
 * notation shape alone. Returns null (unclassified) for anything that
 * doesn't cleanly match one of the three rules stated in CATEGORIES above --
 * deliberately conservative rather than guessing at a move's intent.
 */
function classifyMove(sanRaw) {
  const san = String(sanRaw || '').replace(/[+#]$/, '');
  if (san === 'O-O' || san === 'O-O-O') return 'king-safety';
  if (/^[NB]/.test(san)) return 'development';
  if (/^[cde][1-8]$/.test(san)) return 'center-control';
  return null;
}

/** Standard chess scoring (win=1, draw=0.5) for the side that played the move, from a topReplies row. */
function scoreOf(reply) {
  return reply.winPct != null && reply.drawPct != null ? Number((reply.winPct + reply.drawPct / 2).toFixed(1)) : null;
}

function render(ctx) {
  const { entries, scoreRangeAcrossBands, escapeHtml, displayName, formatPct, wrapTable } = ctx;

  const classified = [];
  for (const { openingConfig, model } of entries) {
    for (const reply of model.topReplies || []) {
      const category = classifyMove(reply.san);
      if (!category) continue;
      const score = scoreOf(reply);
      if (score == null || !reply.games) continue;
      classified.push({
        slug: openingConfig.slug,
        name: model.name,
        category,
        san: reply.san,
        playedPct: reply.playedPct,
        games: reply.games,
        score,
      });
    }
  }

  const categoryStats = CATEGORIES.map((c) => {
    const rows = classified.filter((r) => r.category === c.key);
    const totalGames = rows.reduce((s, r) => s + r.games, 0);
    const avgScore = totalGames > 0 ? Number((rows.reduce((s, r) => s + r.score * r.games, 0) / totalGames).toFixed(1)) : null;
    return { ...c, moveCount: rows.length, totalGames, avgScore };
  });

  const categoryRows = categoryStats
    .map(
      (c) =>
        `<tr><td>${escapeHtml(c.label)}</td><td>${c.moveCount}</td><td>${c.totalGames.toLocaleString()}</td><td>${c.avgScore != null ? `${formatPct(c.avgScore)}%` : 'no data in this build'}</td></tr>`
    )
    .join('');

  const sortedMoves = [...classified].sort((a, b) => b.score - a.score);
  const sampleRows = sortedMoves
    .slice(0, 12)
    .map(
      (m) =>
        `<tr><td><a href="${escapeHtml(m.slug)}.html">${displayName(m.name)}</a></td><td>${escapeHtml(m.san)}</td><td>${CATEGORIES.find((c) => c.key === m.category).label}</td><td>${formatPct(m.playedPct)}%</td><td>${formatPct(m.score)}%</td></tr>`
    )
    .join('');

  const matchCountBySlug = new Map();
  for (const m of classified) {
    matchCountBySlug.set(m.slug, (matchCountBySlug.get(m.slug) || 0) + 1);
  }
  const bandRows = entries
    .map(({ openingConfig, model }) => ({
      slug: openingConfig.slug,
      name: model.name,
      matchCount: matchCountBySlug.get(openingConfig.slug) || 0,
      range: scoreRangeAcrossBands(model),
    }))
    .filter((e) => e.range != null);

  const withMatches = bandRows.filter((e) => e.matchCount > 0);
  const withoutMatches = bandRows.filter((e) => e.matchCount === 0);
  const avgRange = (arr) => (arr.length ? Number((arr.reduce((s, e) => s + e.range.range, 0) / arr.length).toFixed(1)) : null);
  const avgWith = avgRange(withMatches);
  const avgWithout = avgRange(withoutMatches);

  const bandTableRows = [...bandRows]
    .sort((a, b) => b.range.range - a.range.range)
    .map(
      (e) =>
        `<tr><td><a href="${escapeHtml(e.slug)}.html">${displayName(e.name)}</a></td><td>${e.matchCount}</td><td>${e.range.minBand} (${formatPct(e.range.minScore)}%)</td><td>${e.range.maxBand} (${formatPct(e.range.maxScore)}%)</td><td>${e.range.range} pts</td></tr>`
    )
    .join('');

  return `
    <p>&ldquo;Develop your pieces, fight for the center, get your king safe&rdquo; is standard opening advice, usually stated as general wisdom rather than something anyone checks. This page checks a version of it this site&rsquo;s own data can actually answer: among the real replies players make at ${escapeHtml(entries[0] ? entries[0].model.defaultBand : '1600-1800')} against the ${entries.length} openings this site tracks, do moves that match one of the three classic principle patterns score differently than moves that don&rsquo;t?</p>

    <h2>How this page defines each principle</h2>
    <p>Every move below comes from real Lichess Opening Explorer data already fetched for this site&rsquo;s own opening pages. Nothing here is a hand-typed statistic or an engine judgment about any specific position. Classification is by notation pattern alone, disclosed in full:</p>
    <ul>
      ${CATEGORIES.map((c) => `<li><strong>${escapeHtml(c.label)}</strong>: ${escapeHtml(c.rule)}.</li>`).join('')}
    </ul>
    <p class="empty-note">What this doesn&rsquo;t classify: queen moves, rook moves, king moves other than castling, piece captures, and flank pawn moves (a-file, b-file, f-file, g-file, h-file) all fall outside these three patterns and are left unclassified rather than guessed at. That&rsquo;s a real limitation of a notation-only rule; it says nothing about whether those moves actually matter.</p>

    <h2>How principle-matching moves actually score</h2>
    <p>Across every classified reply move found in this build, aggregated by category (score is for the side making the move, weighted by games):</p>
    ${categoryRows
      ? wrapTable(`<table><caption class="sr-only">Average score by opening-principle category</caption><thead><tr><th scope="col">Category</th><th scope="col">Moves matched</th><th scope="col">Games</th><th scope="col">Avg. score for the mover</th></tr></thead><tbody>${categoryRows}</tbody></table>`, 'Average score by opening-principle category')
      : '<p class="empty-note">No replies in this build matched any of the three patterns.</p>'}

    <h2>The moves themselves, best-scoring first</h2>
    ${sampleRows
      ? wrapTable(`<table><caption class="sr-only">Individual classified moves, best-scoring first</caption><thead><tr><th scope="col">Opening</th><th scope="col">Move</th><th scope="col">Category</th><th scope="col">Played</th><th scope="col">Score</th></tr></thead><tbody>${sampleRows}</tbody></table>`, 'Individual classified moves, best-scoring first')
      : '<p class="empty-note">No qualifying moves were found across the tracked openings in this build. This is the real, honest result for this build&rsquo;s own data.</p>'}

    <h2>Does it show up across rating bands?</h2>
    <p>The per-move classification above only has this level of detail at ${escapeHtml(entries[0] ? entries[0].model.defaultBand : '1600-1800')}. This build only fetches per-move reply data for that one band (the same limitation <a href="most-common-opening-mistakes-1600-1800.html">the common-mistakes page</a> discloses). As a proxy for whether that matters by rating, here&rsquo;s how much each opening&rsquo;s own score for the featured side moves between its lowest- and highest-scoring tracked band, next to how many principle-pattern replies were found against it:</p>
    ${bandTableRows
      ? wrapTable(`<table><caption class="sr-only">Score range across rating bands, with principle-pattern reply counts</caption><thead><tr><th scope="col">Opening</th><th scope="col">Principle-pattern replies found</th><th scope="col">Lowest band</th><th scope="col">Highest band</th><th scope="col">Range</th></tr></thead><tbody>${bandTableRows}</tbody></table>`, 'Score range across rating bands, with principle-pattern reply counts')
      : '<p class="empty-note">Not enough band data was available in this build to compute a range.</p>'}
${avgWith != null && avgWithout != null
      ? `    <p>Among the ${withMatches.length} openings with at least one principle-pattern reply found, the average score range across rating bands is <strong>${avgWith} points</strong>; among the ${withoutMatches.length} with none found, it&rsquo;s <strong>${avgWithout} points</strong>. That&rsquo;s a real comparison from this build&rsquo;s own numbers. A sample this size (${bandRows.length} openings total) can show a pattern; it can&rsquo;t establish that principle adherence causes it.</p>`
      : ''}

    <h2>What this doesn&rsquo;t show</h2>
    <p>This measures whether a move&rsquo;s notation shape correlates with its own score, and whether that shows up in how much an opening&rsquo;s overall score varies by rating. It doesn&rsquo;t measure whether a specific position is objectively sound, and it can&rsquo;t tell you what a strong player would actually recommend in any one of these lines. A move matching &ldquo;development&rdquo; here is only classified by shape - whether it&rsquo;s actually good in that specific position is a separate question this page doesn&rsquo;t evaluate.</p>

    <h2>Go deeper</h2>
    <p>See <a href="most-common-opening-mistakes-1600-1800.html">the most common opening mistakes across all tracked openings &rarr;</a>, or the <a href="openings.html">full openings comparison &rarr;</a> for every band at once.</p>
  `;
}

module.exports = { meta, render, classifyMove };

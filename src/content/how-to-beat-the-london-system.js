'use strict';

/**
 * Editorial guide. Every number in `render()` is pulled from `ctx.entries`
 * at build time -- the same already-fetched opening models the opening
 * pages themselves use -- so this file has no hand-typed statistics to go
 * stale or be wrong. To regenerate it, re-run `npm run build:static`, which
 * re-fetches the underlying opening data and re-renders this page from it;
 * a human should spot-check the rendered output before it ships publicly.
 */

const SLUG = 'how-to-beat-the-london-system';

const meta = {
  slug: SLUG,
  title: 'How to Beat the London System',
  description: "The London System (1.d4 d5 2.Bf4) scores well for White at club level - here's what the data says Black's best replies actually are.",
  targetQuery: 'how to beat the london system',
  related: ['london-system', 'queens-gambit'],
  hasBoard: true,
};

function render(ctx) {
  const { entries, escapeHtml, formatPct, wrapTable, spriteDefsHtml, renderBoardDiagram, START_BOARD, applyUciMoves } = ctx;
  const entry = entries.find((e) => e.openingConfig.slug === 'london-system');
  if (!entry) {
    return '<p class="empty-note">London System data was not available in this build.</p>';
  }
  const { model, openingConfig } = entry;
  const mainBand = model.bands.find((b) => b.band === model.defaultBand) || model.bands[0];
  const lineUcis = openingConfig.line.map((p) => p.uci);
  const londonBoard = applyUciMoves(START_BOARD, lineUcis);

  const withScore = (model.topReplies || []).map((m) => ({
    ...m,
    blackScore: m.winPct == null || m.drawPct == null ? null : Number((m.winPct + m.drawPct / 2).toFixed(1)),
  }));
  const byScore = [...withScore].filter((m) => m.blackScore != null).sort((a, b) => b.blackScore - a.blackScore);
  const byPopularity = [...withScore].sort((a, b) => b.games - a.games);

  const bestRows = byScore
    .slice(0, 3)
    .map(
      (m) => `<tr><td><a href="https://lichess.org/analysis/pgn/${encodeURIComponent(m.san)}" target="_blank" rel="noopener noreferrer">${escapeHtml(m.san)}</a></td><td>${m.games.toLocaleString()}</td><td>${formatPct(m.playedPct)}%</td><td>${formatPct(m.blackScore)}%</td></tr>`
    )
    .join('');

  const mostCommon = byPopularity[0];
  const topScoring = byScore[0];

  // Site-audit fix ("articles that admit they can't deliver their
  // headline"): a "no trap found" result is real and worth stating
  // honestly, but shipping only the generator's own empty-state sentence
  // under a heading that promises a mistake is exactly the thin-content
  // shape the audit flagged. When there genuinely is no flagged mistake,
  // retitle the section honestly and replace it with real content this
  // exact position's own data already supports: a board of the
  // top-scoring reply, with the real numbers behind why it works.
  const hasMistakes = (model.mistakes || []).length > 0;
  const mistakesHeading = hasMistakes ? 'A mistake the data flags' : 'The best plan instead';
  const mistakesIntro = hasMistakes
    ? 'Independent of any specific &ldquo;trap,&rdquo; the numbers on this exact position highlight moves that are common but underperform:'
    : 'No move at this band is both common and clearly low-scoring here - there is no obvious trap to warn about. Instead, here is what the data says actually works best:';
  const mistakesHtml = hasMistakes
    ? `<ul>${model.mistakes
        .map(
          (m) => `<li class="callout"><strong>${escapeHtml(m.san)}</strong> is played in ${formatPct(m.playedPct)}% of games in this exact position, but scores only ${formatPct(m.score)}% for Black at ${escapeHtml(model.defaultBand)}${
            m.punishingReply
              ? ` - White&rsquo;s most common answer, <strong>${escapeHtml(m.punishingReply.san)}</strong>, scores ${formatPct(m.punishingReply.winPct + m.punishingReply.drawPct / 2)}% for White.`
              : '.'
          }</li>`
        )
        .join('')}</ul>`
    : topScoring
      ? `<figure class="board-figure">
      ${renderBoardDiagram(applyUciMoves(londonBoard, [topScoring.uci]), { label: `Position after 1.d4 d5 2.Bf4 ${topScoring.san}` })}
      <figcaption>Position after ${escapeHtml(topScoring.san)}.</figcaption>
    </figure>
    <p><strong>${escapeHtml(topScoring.san)}</strong> is Black&rsquo;s highest-scoring reply on this exact table, at ${formatPct(topScoring.blackScore)}% from ${topScoring.games.toLocaleString()} games (played ${formatPct(topScoring.playedPct)}% of the time - not the most popular choice, the best-performing one). That gap between popularity and result is the real, checkable version of &ldquo;how to beat the London&rdquo; this data can actually support: not a trap, a better statistical starting point.</p>`
      : '<p class="empty-note">Not enough reply data was available in this build to identify a top-scoring line.</p>';

  return `
    <p>The London System (1.d4 d5 2.Bf4) has a reputation as a low-theory, hard-to-punish opening for White, and the data mostly backs that up: across the games this site tracked, White scores ${mainBand.scoreForSide != null ? `${formatPct(mainBand.scoreForSide)}%` : 'a solid share'} at ${escapeHtml(model.defaultBand)} from ${mainBand.games.toLocaleString()} games. That doesn&rsquo;t mean every reply for Black is equally good.</p>

    ${spriteDefsHtml()}
    <figure class="board-figure">
      ${renderBoardDiagram(londonBoard, { label: 'Position after 1.d4 d5 2.Bf4, the London System setup' })}
      <figcaption>Position after 1.d4 d5 2.Bf4 - the London System setup this whole page is about.</figcaption>
    </figure>

    <h2>What the data shows</h2>
    <p>Looking at the most common replies to 2.Bf4 in this position, here are the highest-scoring options for Black, ranked by actual result rather than popularity:</p>
    ${bestRows ? wrapTable(`<table><caption class="sr-only">Best-scoring replies for Black against the London System</caption><thead><tr><th scope="col">Move</th><th scope="col">Games</th><th scope="col">Played</th><th scope="col">Score for Black</th></tr></thead><tbody>${bestRows}</tbody></table>`, 'Best-scoring replies for Black against the London System') : '<p class="empty-note">Not enough reply data was available for this build.</p>'}
    ${mostCommon ? `<p>For comparison, the single most commonly played reply here is <strong>${escapeHtml(mostCommon.san)}</strong> (${mostCommon.games.toLocaleString()} games). Popularity and score measure different things, which is exactly why this table is sorted by score rather than by frequency.</p>` : ''}

    <h2>${escapeHtml(mistakesHeading)}</h2>
    <p>${mistakesIntro}</p>
    ${mistakesHtml}

    <h2>See the full page</h2>
    <p>For the complete rating-band breakdown, model games, and recent club games in this line, see the <a href="london-system.html">London System opening page &rarr;</a>.</p>
  `;
}

module.exports = { meta, render };

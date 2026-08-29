'use strict';

/**
 * Real, hand-written strategic commentary for the T1 ECO family hub pages
 * and T2 ECO volume index pages (src/renderEcoPages.js) -- the AdSense
 * content-depth fix's part 2 (part 1: src/openings.js's `strategy` field on
 * the 12 T0 opening pages).
 *
 * A T1 family hub covers an entire family's variation tree (up to 391 named
 * lines for the Sicilian Defense), not one specific line the way a T0
 * opening page does -- so this commentary describes what differentiates the
 * FAMILY's own major branches from each other, not a single game plan. For
 * the 10 families that share a name with an existing T0 opening (e.g.
 * Sicilian Defense, Ruy Lopez), this is deliberately DIFFERENT content from
 * that T0 page's own `strategy` text: the T0 page argues for one specific
 * line's own idea, this page surveys how the family's several major named
 * branches actually differ from each other.
 *
 * FAMILY_STRATEGY is keyed by src/ecoFamilies.js's own slugifyFamilyName()
 * output, one entry per current T1 family (64, per that module's own
 * MIN_T1_LINES measurement against the real vendored dataset --
 * assertFamilyStrategyComplete() below fails loudly if that count ever changes without this file being
 * updated to match, the same floor openings.js's own
 * assertOpeningsWellFormed() applies to `strategy`).
 *
 * VOLUME_STRATEGY is keyed by ECO volume letter (A-E, src/renderEcoPages.js's
 * VOLUME_LABELS) -- 5 entries, not 7: the ECO classification itself has only
 * ever had 5 volumes (A-E), confirmed against VOLUME_LABELS' own key list
 * before writing this file, not assumed from an earlier task description
 * that guessed 7.
 */

const FAMILY_STRATEGY = {
  'alekhine-defense':
    "Black invites White's central pawns to advance rather than avoiding the confrontation, betting that a pawn chain pushed too far becomes a long-term target instead of a lasting space advantage. It's the boldest of Black's replies to 1.e4: after 2.e5 kicks the knight, Black keeps hopping it around (to d5, then often b6) while chipping away at the very pawns that chased it, rather than settling for a calmer defensive setup from the first move.",

  'benko-gambit':
    "Black gives up a queenside pawn on move three to blow open the a- and b-files before White has time to consolidate, trading material for pressure that regularly outlasts the opening and follows White deep into the middlegame and even the endgame. Few gambits convert so directly into a structural, rather than purely tactical, form of compensation.",

  'benko-gambit-accepted':
    "Once White actually takes the pawn on b5, Black wastes no time following up with a6, immediately challenging it again and forcing a choice between handing the pawn straight back or defending it while Black's rooks and fianchettoed bishop start working the open files right away. The accepted lines are exactly where the gambit's whole bet - fast, lasting pressure over material - gets tested most directly.",

  'benoni-defense':
    "Black meets White's central space grab with an early c5, and once the position settles - typically after ...e6, d5, and an eventual ...exd5 cxd5 - trades the e-pawn rather than the c-pawn, leaving White a protected passed pawn on d5 in exchange for Black's own queenside pawn majority and open lines for active piece play. It's a much sharper bargain than the solid, symmetrical structures most other replies to 1.d4 aim for.",

  'bird-opening':
    "White claims kingside space and prepares a later e5 push or a fianchetto setup on the long diagonal, essentially playing a reversed Dutch Defense with an extra tempo. The tradeoffs are the same ones Black accepts in that opening - a slightly weakened kingside and the e1-h4 diagonal left open - just taken on by White, a move ahead, from the other side of the board.",

  'bishops-opening':
    "White develops the bishop to its most active diagonal before committing the knight, keeping the option to transpose into an Italian Game, a Vienna Game, or even a King's Gambit-style f4 push depending on how Black reacts. It's less a fixed strategic battleground of its own than a flexible move-order tool for reaching one of several other well-known structures on White's own terms.",

  'blackmar-diemer-gambit':
    "White offers a pawn on move three to blast open the center and open lines for every piece, banking entirely on quick development and attacking chances against a Black king that hasn't castled yet. There's no long-term structural compensation waiting in reserve if the attack fizzles - only tempo, which has to be spent fast.",

  'blackmar-diemer-gambit-accepted':
    "When Black greedily takes both offered pawns, White's whole case for the gambit rests on the open f-file and a real lead in development - genuine, fast compensation that has to be converted quickly, since the material stays down for the rest of the game if Black survives the initial attack intact.",

  'blackmar-diemer-gambit-declined':
    "Rather than grab the second pawn too, Black strikes back immediately with c5, handing the extra pawn back to sidestep White's sharpest attacking lines in exchange for a calmer position with a normal material count. It's the practical, lower-risk branch of the family for the side that would rather not defend an extra pawn against a full-scale attack.",

  'bogo-indian-defense':
    "Black checks with the bishop a move before White could even play Nc3, ruling out a genuine Nimzo-Indian pin entirely - White almost always blocks with Bd2 or interposes the knight, and the position usually resolves into simpler, more solid equality rather than the sharper structural imbalances a real Nimzo-Indian pin creates.",

  'caro-kann-defense':
    "This family's 110 named lines split mainly on how White responds to Black's central challenge: the Advance Variation grabs space with e5 and dares Black to attack the resulting pawn chain from the side, the Exchange Variation trades on d5 for a symmetrical structure decided by piece activity rather than pawn tension, the Classical and Modern lines meet 3.Nc3/3.Nd2 head-on, and the Panov-Botvinnik Attack abandons the opening's quiet reputation entirely for an isolated-queen's-pawn structure that plays more like a Queen's Gambit than a typical Caro-Kann.",

  'catalan-opening':
    "White fianchettoes the bishop onto the long diagonal before deciding how to handle the center, combining a Queen's Gambit-style bid for space with hypermodern pressure down the a1-h8 diagonal. Whatever Black's central pawn ends up doing - staying on d5 or getting grabbed on c4 - it sits directly in that bishop's sights for the rest of the game.",

  'center-game':
    "White strikes the center immediately rather than developing the knight first, but the queen usually has to recapture on d4 and then move again once Black develops with Nc6 - the extra tempo Black gains by attacking the queen is exactly what makes the closely related Scotch Game, which develops the knight before pushing d4, the more respected way to play the same central idea.",

  'dutch-defense':
    "Black claims kingside space and stakes out e4 as a future outpost, accepting a permanently weakened long diagonal and a slightly exposed king in exchange for genuine attacking chances. It's one of the few mainstream replies to 1.d4 that fights for the initiative outright rather than settling for solid, symmetrical equality.",

  'english-opening':
    "White develops flexibly on the flank without committing the center pawns at all, able to transpose into a reversed Sicilian (with an extra tempo), a Catalan-style setup, or a fully symmetrical structure depending entirely on how Black replies. It's less a single strategic plan than an umbrella covering several different hypermodern approaches that all happen to share one first move.",

  'englund-gambit':
    "Black offers the e-pawn immediately against 1.d4, hoping for quick piece activity and tactical tricks if White grabs it greedily. It's a dubious try against accurate, prepared play by mainstream theory's own standards - the appeal is punishing an unfamiliar opponent fast, in a position that leaves normal opening theory almost immediately.",

  'four-knights-game':
    "Both sides develop their knights to the most natural squares before committing to any particular plan, producing a solid but famously drawish structure - so reliably level that sharper tries like the Scotch Four Knights or the Belgrade Gambit exist specifically to reinject imbalance into what's otherwise one of the quietest ways to answer 1...e5.",

  'french-defense':
    "The 212 named lines here split mainly on how White handles the center after Black's third move: the Winawer Variation (3...Bb4) accepts doubled pawns for the bishop pair and a long-term structural target, the Advance Variation locks the center with e5 and fights over the resulting pawn chain, the Exchange Variation trades everything on d5 for a quieter, more symmetrical game, and the Tarrasch (3.Nd2) sidesteps the sharpest Winawer theory while keeping White's own structure intact.",

  'grob-opening':
    "White stakes an early claim on the h1-a8 diagonal and dares Black to punish the weakening pawn move immediately. Mainstream theory considers it largely unsound; it survives mostly as a deliberate way to sidestep known opening theory entirely rather than through any real structural merit of its own.",

  'grunfeld-defense':
    "Black fianchettoes first and only then strikes the center with d5, deliberately allowing White to build a big classical pawn center with cxd5/e4 in exchange for immediate, sustained pressure against that center from the fianchettoed bishop and a well-timed c5 or Nb6 later. It's among the sharpest mainstream replies to 1.d4 that begin with an early ...g6, trading the King's Indian's slower buildup for a more direct, immediate fight over the center.",

  'hungarian-opening':
    "White fianchettoes the king's bishop before touching a single central pawn, keeping every option open for what follows. It's less a distinct strategic system of its own than a flexible first move that can transpose into a Réti, an English, or a King's Indian Attack setup depending on how the rest of the game develops.",

  'indian-defense':
    "Not one specific system but the shared starting point for the hypermodern family of replies to 1.d4 that delay ...d5: Black develops the knight first and waits to see whether White commits to c4, Nf3, or an early Bg5 before choosing among the King's Indian, Nimzo-Indian, Queen's Indian, Grünfeld, or one of several less common setups gathered under this family's own broader ECO range.",

  'italian-game':
    "The 187 named lines here mostly divide by how quickly the tension resolves: the quiet Giuoco Pianissimo keeps pieces on the board behind c3 and d3 for a slow maneuvering game, the Giuoco Piano proper pushes d4 to open the center early, and the Two Knights Defense (3...Nf6 instead of 3...Bc5) invites the sharpest tactics in the family, including lines where White grabs a pawn with Ng5 as early as move four.",

  'kadas-opening':
    "White's first move commits to almost nothing central or developmental, aiming instead at a later g4 pawn storm or simply testing whether Black knows how to punish an unusual opening move. It's a rare, largely untheoretical try with essentially no independent strategic identity beyond the surprise value of an opponent facing it unprepared.",

  'kings-gambit-accepted':
    "Black accepts the offered f-pawn, and the whole opening turns on whether White's resulting lead in development and open f-file are worth more than the missing pawn. It's one of the oldest tested tradeoffs in chess, producing sharp, tactical positions from move three onward rather than the slower buildup most other 1.e4 e5 openings favor.",

  'kings-gambit-declined':
    "Rather than grab the pawn, Black develops the bishop actively and keeps the extra central tension on the board, sidestepping the sharpest King's Gambit Accepted theory in exchange for solid development. It's the calmer branch of the family - though White's own kingside stays slightly weakened by the early f4 push regardless of which way Black answers it.",

  'kings-indian-attack':
    "White builds a King's Indian Defense-style setup - fianchetto the bishop, castle, expand with e4 or c4 later - with an extra tempo, regardless of what Black actually plays. That makes it less a reply to any one specific defense than a repeatable system White can aim for against almost anything Black tries.",

  'kings-indian-defense':
    "The 119 named lines split mainly on how White handles the center: the Classical Variation (Nf3, Be2) castles quickly and fights for central control move by move, the Sämisch Variation (f3) builds an even bigger center at the cost of slower development, and the Four Pawns Attack goes furthest of all, grabbing maximum space early and betting that Black's counterplay arrives too late to matter.",

  'kings-pawn-game':
    "The shared starting point for every reply to 1.e4 gathered under one ECO code before Black's actual answer sorts the game into a named family of its own - not a strategy in itself so much as the root every open game, semi-open defense, and irregular try against 1.e4 branches from.",

  'latvian-gambit':
    "Black offers a pawn on move two to seize kingside space and open lines toward White's king immediately - a much riskier mirror of the King's Gambit that most modern theory and engine analysis consider dubious for Black. The appeal is entirely in the sharp, unfamiliar positions it produces against an opponent who hasn't studied the resulting tactics.",

  'latvian-gambit-accepted':
    "When White actually grabs the offered pawn on f5, Black's whole compensation rests on quick piece activity and tactical chances before development catches up - objectively insufficient against precise play, which is exactly why this branch tests calculation and preparation far more than long-term strategic understanding.",

  'modern-defense':
    "Black fianchettoes immediately and delays every other decision, content to let White build a full classical center and undermine it later with c5 or e5. It's the same hypermodern bet the King's Indian and Pirc make against 1.d4/1.e4, played here in its most flexible, least committal form.",

  'neo-grunfeld-defense':
    "White inserts f3 before committing the knight to c3, reinforcing a coming e4 push and sidestepping some of the sharpest main-line Grünfeld theory. It's a quieter, more solid way to meet the same fianchetto-then-strike plan, at the cost of a slightly slower buildup than the main Grünfeld lines allow.",

  'nimzo-indian-defense':
    "The 99 named lines mostly split on how White meets the pin on c3: the Classical Variation (4.Qc2) avoids doubled pawns entirely by preparing to recapture on c3 with the queen instead of a pawn, the Rubinstein Variation (4.e3) develops naturally and accepts the doubled pawns if the bishop trades, and the sharper 4.a3 lines force the issue immediately, trading a tempo for the bishop pair right away.",

  'nimzo-larsen-attack':
    "White fianchettoes the queen's bishop before touching a single central pawn, aiming the diagonal at e5 or g7 from the very first move. Like the English Opening, it stays deliberately flexible about the center for as long as possible rather than committing to a fixed structure early.",

  'nimzowitsch-defense':
    "Black develops the knight before committing any pawn move at all, keeping the option to strike back with d5 or e5 later depending on how White reacts. It's a flexible, somewhat provocative try that trades a slower start for the freedom to choose a central structure only after seeing White's second move.",

  'old-indian-defense':
    "Black builds a King's Indian-style setup but keeps the bishop on c8 instead of fianchettoing it, developing it to e6 or g4 outside the pawn chain instead. It's a more classical, less committal ancestor of the modern King's Indian - out of favor at the top level today, but perfectly sound.",

  'owen-defense':
    "Black fianchettoes the queen's bishop immediately against 1.e4, aiming it at the long diagonal and White's kingside before developing anything else. It's a rare, hypermodern try that concedes the center outright in exchange for pressure down that one diagonal, with little independent theory beyond that single idea.",

  'petrovs-defense':
    "Rather than defend the e5 pawn, Black counterattacks White's own e4 pawn symmetrically, aiming for quick simplification and a solid, well-tested route to equality. It's one of Black's most reliable defenses to 1.e4 specifically because it avoids the sharp imbalances a Sicilian or King's Gambit accepts on purpose.",

  'philidor-defense':
    "Black defends e5 with a pawn instead of developing a piece, keeping the position solid but passive and giving up a share of the center and a tempo in exchange for a simple, low-theory setup. It's historically been considered too passive at the top level, though it's perfectly playable in practical, lower-level games.",

  'pirc-defense':
    "Black delays the central challenge and fianchettoes the king's bishop, letting White build a big pawn center on purpose before striking back with c5 or e5 later. It's the same hypermodern bet the King's Indian makes against 1.d4, adapted here to meet 1.e4 instead.",

  'polish-opening':
    "White grabs queenside space immediately and offers the b-pawn as a gambit in some lines, aiming the fianchettoed bishop at the long diagonal from the first move. It's an unusual, flank-first try that trades central influence for early space and piece activity on one side of the board.",

  'ponziani-opening':
    "White prepares d4 with an extra pawn move rather than developing a piece first, aiming to build a full classical center. It's a slower, more committal try than the Italian Game or Ruy Lopez that has fallen out of favor since Black has several well-tested ways to strike back before that center fully forms.",

  'pterodactyl-defense':
    "Black combines a Sicilian-style c5 with an early fianchetto and a queen check to a5, pinning down White's development before White can consolidate the center. It's a sharp, uncommon hybrid that borrows ideas from both the Sicilian and the hypermodern Indian defenses rather than following either one directly.",

  'queens-gambit-accepted':
    "Black grabs the offered c-pawn, but it's rarely a real sacrifice: White regularly wins it back within a few moves while keeping a lead in development and central influence, which is exactly why the QGA has a reputation as fine, solid, but rarely dangerous for the side doing the accepting.",

  'queens-gambit-declined':
    "The 198 named lines mostly split on how Black defends the center: the Orthodox Defense develops naturally and accepts a slightly passive but solid structure, the Cambridge Springs (...c6 and an early ...Qa5) pressures the pin on White's c3-knight directly rather than freeing the position with a pawn break, the Tartakower frees it instead with an early ...b6, and lines that allow an isolated queen's pawn structure trade a static weakness for long-term piece activity.",

  'queens-indian-defense':
    "Black fianchettoes the queen's bishop specifically because White has already played Nf3 - ruling out the Nimzo-Indian's pin on c3 - and aims the bishop down the long diagonal at e4 instead. It's a solid, flexible reply that trades the Nimzo's structural ambitions for straightforward piece pressure.",

  'queens-indian-defense-with-e3':
    "A specific move order where Black inserts an early d5 before fianchettoing, and White replies with the modest e3 rather than a more ambitious setup. It's a quieter branch of the family that trades some of the main line's central tension for a simpler, more solid structure on both sides.",

  'queens-pawn-game':
    "The shared starting point for every reply to 1.d4 that hasn't yet branched into a named defense - not a strategy of its own, but the root every Indian defense, Slav, Queen's Gambit, and London-style system grows from before Black's actual second move sorts the game into its own family.",

  'rat-defense':
    "Black plays a flexible, non-committal setup with an early d6, and White answers with an aggressive f4 push to grab extra central space immediately. It's a rare combination that mixes the Pirc/Modern's patient fianchetto plan with a sharper, more space-grabbing reply from White than those openings usually see.",

  'reti-opening':
    "White develops the knight first and only later challenges the center with c4, pressuring d5 from the flank instead of occupying the center outright. It's the founding idea of hypermodern chess: give Black a bigger pawn center on purpose, in exchange for lasting pressure against it.",

  'richter-veresov-attack':
    "White develops the bishop to an active pin outside the normal Queen's Gambit move order, aiming for quick, aggressive development against Black's center. It's a sharper, less theoretical alternative to the main Queen's Pawn systems that keeps the option open to transpose into a Trompowsky-style setup or a more classical buildup depending on Black's reply.",

  'ruy-lopez':
    "The 235 named lines split mainly on how Black responds to the bishop's pressure on c6: the Closed Ruy Lopez (3...a6 4.Ba4 Nf6, both sides castling before the real fight begins) leads to some of the most heavily studied middlegames in chess, the Exchange Variation (4.Bxc6) trades the bishop pair for doubled pawns immediately, and the Berlin Defense (3...Nf6) heads for an early queen trade and a famously solid, drawish endgame structure that top-level players have used to blunt White's opening edge for two decades.",

  'scandinavian-defense':
    "The 45 named lines split mainly on where Black's queen retreats after being kicked by Nc3: the main lines (3...Qd6 or 3...Qa5) keep the queen active but exposed to further tempo-gaining attacks, while the Modern Variation develops the knight to f6 first and recaptures the pawn with it instead, avoiding the repeated queen harassment entirely at the cost of one extra tempo rather than any material.",

  'scotch-game':
    "The 53 named lines mostly split on how the position resolves after the central pawn trade: the Classical Variation develops naturally with Bc5, the Scotch Four Knights (with an earlier Nf6) heads for calmer, more symmetrical structures, and the Steinitz Variation (4...Qh4) grabs an early tempo with a queen sortie that most modern theory considers premature.",

  'semi-slav-defense':
    "Black combines the Slav's c6 with the Queen's Gambit Declined's e6, keeping both the option to develop the bishop outside the pawn chain and a genuinely solid center at the same time. That hybrid produces some of the sharpest theoretical battles in mainstream opening theory, especially in the Meran and Botvinnik systems that branch from it.",

  'sicilian-defense':
    "The 391 named lines here split into entire sub-openings of their own: the Open Sicilian (2.Nf3 and 3.d4) leads to razor-sharp theoretical battlegrounds like the Najdorf and Dragon, the Closed Sicilian (2.Nc3, no early d4) keeps the position calmer and more strategic, and Anti-Sicilian tries like the Alapin (2.c3) or the Rossolimo (3.Bb5) let White sidestep the heaviest Open Sicilian theory entirely.",

  'slav-defense':
    "The 52 named lines mostly split on the center's fate: the Main Line accepts an eventual central pawn trade for open, active piece play, while the Chebanenko and Schlechter setups keep the tension longer, trading some activity for a harder-to-crack structure - the reputation that's made the Slav one of Black's most solid replies to 1.d4.",

  'tarrasch-defense':
    "Black challenges the center with an early c5, accepting an isolated queen's pawn later in exchange for active piece play and open lines. It's a sharper alternative to the standard Queen's Gambit Declined structures that trades long-term structural soundness for immediate activity.",

  'trompowsky-attack':
    "White pins the knight before Black can even choose a defense, sidestepping the entire body of King's Indian, Nimzo-Indian, and Grünfeld theory in one move. It's a practical weapon built more around avoiding a well-prepared opponent than any deep structural advantage of its own.",

  'van-geet-opening':
    "White develops the queenside knight before touching a single pawn, keeping the position maximally flexible and ready to transpose into almost any structure depending on Black's reply. Its entire appeal is unpredictability rather than any one fixed strategic plan.",

  'vienna-gambit-with-max-lange-defense':
    "A sharp branch of the Vienna Game where White offers the f-pawn immediately after developing the knight, and Black's specific reply counterattacks the center right back rather than simply grabbing the pawn. It's one of the more tactical, forcing lines in an opening usually known for a slower buildup.",

  'vienna-game':
    "White develops the queenside knight before committing to an early f4 or a quieter Bc4 setup, keeping the option to transpose into a King's Gambit-style attack or a calmer Italian-like game depending on how Black reacts. It's a flexible way to meet 1...e5 without fully committing to either plan from move two.",

  'zukertort-opening':
    "White develops the kingside knight before deciding anything about the center - the single most flexible first move in chess. It can transpose into a Réti, an English, a King's Indian Attack, or dozens of other systems entirely depending on how the game continues from here.",
};

const VOLUME_STRATEGY = {
  A: "Volume A's headline character is the flank openings: first moves (c4, Nf3, g3, b3, b4, and more) that delay any central pawn advance in favor of piece pressure and fianchettoes from the side, staking a claim on the center from a diagonal rather than occupying it outright. But the volume's own numeric range grew to be a genuine catch-all too: several d4-based systems that don't fit neatly under Volumes B through E - Black defenses like the Benoni, Dutch Defense, Benko Gambit, and Old Indian Defense, plus White's own Trompowsky Attack - are also classified here, a real quirk of how the ECO system's A-codes were assigned rather than a strategic thread running through every family in the volume.",
  B: "Volume B covers the semi-open games: most mainstream replies to 1.e4 other than 1...e5 (Volume C) - the Sicilian, Caro-Kann, Pirc, Modern, Scandinavian, Alekhine, and Nimzowitsch Defenses among them. What they share is asymmetry: rather than mirror White's central pawn move, Black picks a different one on purpose, trading a level, drawish structure for real fighting chances on both sides.",
  C: "Volume C holds the open games - every line beginning 1.e4 e5, chess's oldest and most exhaustively analyzed body of opening theory, from the Ruy Lopez and Italian Game to the King's Gambit and Petrov's Defense - plus the French Defense, grouped here by the classification's own historical boundary even though the French itself is structurally a semi-open defense like its Volume B neighbors.",
  D: "Volume D covers the closed and semi-closed games: openings built mainly around 1.d4 d5, where both sides contest the center directly rather than fianchettoeing around it - the Queen's Gambit, Slav, Semi-Slav, and Tarrasch Defense chief among them - plus the Richter-Veresov and, in one of the classification's better-known quirks, the Grünfeld Defense itself: hypermodern and Indian in character, but filed here rather than alongside Volume E's other Indian Defenses.",
  E: "Volume E's headline character is the Indian Defenses: Black's hypermodern replies to 1.d4 Nf6 that delay ...d5 on purpose, letting White build central space first before undermining or fianchettoing against it later - the King's Indian, Nimzo-Indian, Queen's Indian, and Bogo-Indian Defenses among them. The Catalan Opening also lives in this volume's own numeric range (its early codes, E00-E09) purely because of a shared 1.d4 Nf6 2.c4 e6 move order with the Indian Defenses, even though the Catalan itself is a White-initiated system rather than one of Black's defenses.",
};

/**
 * Build-time floor (same reasoning as src/openings.js's own
 * assertOpeningsWellFormed -- catches an empty/missing/truncated entry, not
 * "is this good commentary," which is a human/review judgment): throws if
 * any T1 family slug or VOLUME_LABELS key is missing a real entry, or if the
 * real T1 family count has drifted from what this file was written against
 * (64) without a matching update here.
 *
 * @param {string[]} t1Slugs every current T1 family's slug (ecoFamilies.t1Families().map(f => f.slug))
 * @param {string[]} volumeKeys every current ECO volume letter (Object.keys(VOLUME_LABELS))
 */
function assertFamilyStrategyComplete(t1Slugs, volumeKeys) {
  if (t1Slugs.length !== 64) {
    throw new Error(`ecoFamilyStrategy: expected exactly 64 T1 families (this file's own measured baseline), found ${t1Slugs.length} -- add/remove FAMILY_STRATEGY entries to match before building.`);
  }
  for (const slug of t1Slugs) {
    const text = FAMILY_STRATEGY[slug];
    if (typeof text !== 'string' || text.trim().length < 120) {
      throw new Error(`ecoFamilyStrategy: T1 family "${slug}" is missing real strategy commentary (or it's suspiciously short)`);
    }
  }
  for (const volume of volumeKeys) {
    const text = VOLUME_STRATEGY[volume];
    if (typeof text !== 'string' || text.trim().length < 120) {
      throw new Error(`ecoFamilyStrategy: ECO volume "${volume}" is missing real strategy commentary (or it's suspiciously short)`);
    }
  }
}

module.exports = {
  FAMILY_STRATEGY,
  VOLUME_STRATEGY,
  assertFamilyStrategyComplete,
};

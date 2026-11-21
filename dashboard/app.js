// Token Launch Radar dashboard. Reads window.RADAR (written beside this directory by main.ts)
// and renders the ranked board, filters, a per-protocol detail view with the model's own
// arithmetic, and the methodology. No network: every byte it shows comes from data.js.
(function () {
  'use strict';
  var R = window.RADAR;
  if (!R) return;
  var rows = R.rows;
  var bySlug = {};
  rows.forEach(function (r) { bySlug[r.slug] = r; });

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) { return '$' + Math.round(n).toLocaleString('en-US'); }
  function compact(n) {
    var a = Math.abs(n);
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
    return '$' + Math.round(n);
  }
  function pct(v) {
    if (v == null) return '<span class="flat">&mdash;</span>';
    var cls = v > 0 ? 'up' : v < 0 ? 'down' : 'flat';
    var s = (v > 0 ? '+' : '') + v.toFixed(2) + '%';
    return '<span class="' + cls + '">' + s + '</span>';
  }
  function ageText(d) {
    if (d == null) return '&mdash;';
    if (d >= 365) return (d / 365).toFixed(1) + 'y';
    if (d >= 30) return Math.round(d / 30.44) + ' mo';
    return d + 'd';
  }
  function cleanSource(s) {
    return s.split(' ').map(function (t) { return t.indexOf('://') >= 0 ? 'protocols API' : t; }).join(' ');
  }

  // ---- header -------------------------------------------------------------
  var wlCovered = rows.filter(function (r) { return r.watchlist; }).length;
  document.getElementById('snapshotMeta').innerHTML =
    '<div><strong>Snapshot</strong> ' + esc(R.as_of) + '</div>' +
    '<div>' + esc(cleanSource(R.source)) + '</div>' +
    '<div>Watchlist floor: TVL &ge; ' + compact(R.floor_usd) + '</div>';
  document.getElementById('stats').innerHTML =
    stat(R.universe_size.toLocaleString('en-US'), 'Protocols scanned') +
    stat(R.board_size.toLocaleString('en-US'), 'Pre-token protocols ranked') +
    stat(wlCovered + '<em>/' + R.watchlist_size + '</em>', 'Watchlist covered') +
    stat(compact(R.combined_implied_usd), 'Combined implied value');
  function stat(v, k) { return '<div class="stat"><div class="v">' + v + '</div><div class="k">' + k + '</div></div>'; }

  // ---- controls -----------------------------------------------------------
  var qEl = document.getElementById('q');
  var catEl = document.getElementById('cat');
  var chainEl = document.getElementById('chain');
  var wlEl = document.getElementById('wlOnly');
  var countEl = document.getElementById('rowCount');
  var tbody = document.getElementById('tbody');
  var emptyEl = document.getElementById('empty');

  var catCounts = {}, chainCounts = {};
  rows.forEach(function (r) {
    var c = r.category || 'Uncategorised';
    catCounts[c] = (catCounts[c] || 0) + 1;
    r.chains.forEach(function (ch) { chainCounts[ch] = (chainCounts[ch] || 0) + 1; });
  });
  Object.keys(catCounts).sort().forEach(function (c) {
    catEl.insertAdjacentHTML('beforeend', '<option value="' + esc(c) + '">' + esc(c) + ' (' + catCounts[c] + ')</option>');
  });
  Object.keys(chainCounts).sort(function (a, b) { return chainCounts[b] - chainCounts[a] || (a < b ? -1 : 1); }).forEach(function (c) {
    chainEl.insertAdjacentHTML('beforeend', '<option value="' + esc(c) + '">' + esc(c) + ' (' + chainCounts[c] + ')</option>');
  });

  var sort = { key: 'rank', dir: 1 };
  var selected = null;

  function filtered() {
    var q = qEl.value.trim().toLowerCase();
    var cat = catEl.value, chain = chainEl.value, wl = wlEl.checked;
    return rows.filter(function (r) {
      if (wl && !r.watchlist) return false;
      if (cat && (r.category || 'Uncategorised') !== cat) return false;
      if (chain && r.chains.indexOf(chain) < 0) return false;
      if (q) {
        var hay = (r.name + ' ' + (r.category || '') + ' ' + r.chains.join(' ')).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
  }
  var sortVal = {
    rank: function (r) { return r.rank; },
    name: function (r) { return r.name.toLowerCase(); },
    tvl: function (r) { return r.tvl_usd; },
    change: function (r) { return r.change_7d == null ? -Infinity : r.change_7d; },
    age: function (r) { return r.age_days == null ? -1 : r.age_days; },
    implied: function (r) { return r.implied_value_usd; }
  };
  function render() {
    var list = filtered();
    var f = sortVal[sort.key];
    list.sort(function (a, b) {
      var x = f(a), y = f(b);
      var d = (typeof x === 'string') ? (x < y ? -1 : x > y ? 1 : 0) : x - y;
      return d * sort.dir;
    });
    countEl.textContent = 'Showing ' + list.length + ' of ' + rows.length + ' protocols';
    emptyEl.hidden = list.length > 0;
    tbody.innerHTML = list.map(function (r) {
      var chains = r.chains.length ? esc(r.chains[0]) + (r.chains.length > 1 ? ' +' + (r.chains.length - 1) : '') : '&mdash;';
      return '<tr data-slug="' + esc(r.slug) + '"' + (r.slug === selected ? ' class="selected"' : '') + '>' +
        '<td class="num rank">' + r.rank + '</td>' +
        '<td><span class="pname">' + esc(r.name) + '</span>' + (r.watchlist ? '<span class="chip">Watchlist</span>' : '') + '</td>' +
        '<td class="cat">' + esc(r.category || 'Uncategorised') + '</td>' +
        '<td class="chains">' + chains + '</td>' +
        '<td class="num">' + compact(r.tvl_usd) + '</td>' +
        '<td class="num">' + pct(r.change_7d) + '</td>' +
        '<td class="num">' + ageText(r.age_days) + '</td>' +
        '<td class="num imp">' + compact(r.implied_value_usd) + '</td></tr>';
    }).join('');
    document.querySelectorAll('th.sortable').forEach(function (th) {
      var base = th.getAttribute('data-label') || th.textContent.replace(/ [▲▼]$/, '');
      th.setAttribute('data-label', base);
      th.innerHTML = esc(base) + (th.dataset.key === sort.key ? ' <span class="arrow">' + (sort.dir === 1 ? '▲' : '▼') + '</span>' : '');
    });
  }
  [qEl, catEl, chainEl, wlEl].forEach(function (el) {
    el.addEventListener('input', render);
    el.addEventListener('change', render);
  });
  document.querySelectorAll('th.sortable').forEach(function (th) {
    th.addEventListener('click', function () {
      var k = th.dataset.key;
      if (sort.key === k) sort.dir *= -1;
      else sort = { key: k, dir: (k === 'name' || k === 'rank') ? 1 : -1 };
      render();
    });
  });
  tbody.addEventListener('click', function (ev) {
    var tr = ev.target.closest('tr[data-slug]');
    if (tr) openDetail(tr.dataset.slug, true);
  });

  // ---- detail -------------------------------------------------------------
  var detail = document.getElementById('detail');
  function openDetail(slug, scroll) {
    var r = bySlug[slug];
    if (!r) return;
    selected = slug;
    var gp = Math.max(R.model.growth_floor, Math.min(R.model.growth_cap, r.change_7d == null ? 0 : r.change_7d));
    var peerNote = r.category_sample_size > 0
      ? 'median market cap / TVL of ' + r.category_sample_size + ' tokenised ' + esc(r.category || '') + ' peer' + (r.category_sample_size === 1 ? '' : 's') + ', shrunk toward the global median of ' + R.global_multiple.toFixed(4)
      : 'no tokenised peers in this category, so the global median multiple of ' + R.global_multiple.toFixed(4) + ' applies';
    detail.innerHTML =
      '<div class="detail-head"><div>' +
      '<h2>' + esc(r.name) + (r.watchlist ? '<span class="chip">Watchlist</span>' : '') + '</h2>' +
      '<p class="sub">Rank #' + r.rank + ' of ' + rows.length + ' &middot; ' + esc(r.category || 'Uncategorised') + ' &middot; records no token in this snapshot</p>' +
      '</div><button class="close" id="closeDetail" type="button">Close</button></div>' +
      '<div class="dgrid">' +
      dg('TVL', money(r.tvl_usd)) +
      dg('Implied value', money(r.implied_value_usd)) +
      dg('7d TVL change', pct(r.change_7d)) +
      dg('Age', (r.age_days == null ? '&mdash;' : r.age_days.toLocaleString('en-US') + ' days') + (r.listed_at ? ' &middot; listed ' + esc(r.listed_at) : '')) +
      dg('Category multiple', r.category_multiple.toFixed(4) + '&times;') +
      dg('Peer sample', r.category_sample_size + ' tokenised protocol' + (r.category_sample_size === 1 ? '' : 's')) +
      dg('Chains', r.chains.length ? esc(r.chains.join(', ')) : '&mdash;') +
      dg('Base value (TVL &times; multiple)', money(r.base_value_usd)) +
      '</div>' +
      '<div class="equation"><strong>The model, with this protocol&rsquo;s numbers:</strong><br>' +
      money(r.tvl_usd) + ' TVL &times; ' + r.category_multiple.toFixed(4) + ' = ' + money(r.base_value_usd) + ' base' +
      ' &times; ' + r.growth_multiplier.toFixed(4) + ' growth (7d change ' + (r.change_7d == null ? 'unreported, treated as 0' : gp.toFixed(2) + '%') + ', halved)' +
      ' &times; ' + r.maturity_multiplier.toFixed(4) + ' maturity' +
      ' = <span class="res">' + money(r.implied_value_usd) + ' implied value</span>' +
      '<div class="note">Category multiple: ' + peerNote + '. Multiples are clamped to ' + R.model.multiple_floor + '&ndash;' + R.model.multiple_cap + '.</div></div>' +
      '<h3>Farm plan</h3><ol class="farm">' +
      r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') +
      '</ol>' +
      '<p class="caveat">The snapshot records no token for ' + esc(r.name) + '; that is a fact about the record, not a promise that a token exists or will launch. The implied value is a model estimate built only from this snapshot&rsquo;s figures, not a price prediction.</p>';
    detail.hidden = false;
    document.getElementById('closeDetail').addEventListener('click', function () {
      detail.hidden = true; selected = null; render();
    });
    render();
    if (scroll) detail.scrollIntoView({ block: 'start' });
  }
  function dg(k, v) { return '<div><div class="k">' + k + '</div><div class="v">' + v + '</div></div>'; }
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && !detail.hidden) { detail.hidden = true; selected = null; render(); }
  });

  // ---- methodology ----------------------------------------------------------
  var m = R.model;
  document.getElementById('method').innerHTML =
    '<h2>How the radar works</h2>' +
    '<p>The board ranks every protocol in the snapshot whose record carries <strong>no token</strong> (no market cap, no CoinGecko id, no symbol) and that is not a wrapped, staked, bridged or exchange product of a protocol that already has one. Versioned pools, products in the CEX, Liquid Staking, Liquid Restaking, Restaked BTC and Canonical Bridge categories, names carrying the words wrapped, staked or staking, and exchange-branded products are set aside as derivatives. Bridge entries whose whole name is a bare ticker &mdash; a wrapped or bridged form of an existing asset &mdash; are also left off, since the asset is itself a token. The result is <strong>' + R.board_size + ' protocols</strong> out of ' + R.universe_size + ' scanned.</p>' +
    '<h3>The value model</h3>' +
    '<p>Implied value is priced by the market itself. For each category, the model takes the <strong>median market-cap-to-TVL ratio</strong> of the protocols in that category whose token already trades (TVL at least $5,000,000), then shrinks it toward the global median of <strong>' + R.global_multiple.toFixed(4) + '</strong> by the sample size: <code>multiple = (n &times; category median + ' + m.shrink_prior + ' &times; global median) / (n + ' + m.shrink_prior + ')</code>, clamped to ' + m.multiple_floor + '&ndash;' + m.multiple_cap + '. A category priced by many peers stands on its own; a thin one leans on the whole market. Each protocol then gets:</p>' +
    '<ul>' +
    '<li><strong>Base value</strong> = TVL &times; its category multiple.</li>' +
    '<li><strong>Growth</strong> = 1 + clamp(7d TVL change, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 &times; ' + m.growth_weight + ' &mdash; a hot week lifts the estimate, a shrinking protocol is marked down.</li>' +
    '<li><strong>Maturity</strong> = ' + m.maturity_floor + ' + min(age in days, ' + m.maturity_days + ') / ' + m.maturity_days + ' &times; ' + m.maturity_range + ' &mdash; a protocol that has run longer with no token has more of a record to price.</li>' +
    '<li><strong>Implied value</strong> = base &times; growth &times; maturity, rounded to whole dollars.</li>' +
    '</ul>' +
    '<h3>Category multiples used</h3>' +
    '<div class="mults">' + R.multiples.map(function (x) {
      return '<div class="mrow"><span class="mc">' + esc(x.category) + '</span><span><span class="mv">' + x.multiple.toFixed(4) + '&times;</span> <span class="mn">' + (x.n > 0 ? 'n=' + x.n : 'global') + '</span></span></div>';
    }).join('') + '</div>' +
    '<h3>The watchlist is a floor, not the board</h3>' +
    '<p>The snapshot&rsquo;s own watchlist names ' + R.watchlist_size + ' protocols at or above the ' + compact(R.floor_usd) + ' TVL floor. Every one of them is on this board (marked with a <span class="chip">Watchlist</span> chip), but the radar&rsquo;s job is the other ' + R.early_size + ' rows: pre-token protocols below that floor or outside the watchlist&rsquo;s own cuts, ranked by the same model.</p>' +
    '<h3>Read this carefully</h3>' +
    '<p>&ldquo;Records no token&rdquo; is a statement about this snapshot&rsquo;s record, never a claim that a protocol has no token in the world, and an implied value is the model&rsquo;s arithmetic on one frozen snapshot &mdash; not a forecast that a token will launch, or at what price. Farm plans describe ordinary, low-cost ways to be an early user; they are not financial advice, and no step in them promises a reward.</p>';

  document.getElementById('footer').textContent =
    'Token Launch Radar · model ' + R.model_version + ' · snapshot as of ' + R.as_of + ' · renders fully offline from the data file beside it.';

  render();
})();

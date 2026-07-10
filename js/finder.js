(function () {
  'use strict';

  const API_URL = 'https://fec-website-2026-production-7dbe.up.railway.app';

  document.addEventListener('DOMContentLoaded', function () {
    var form = document.getElementById('finder-form');
    var queryInput = document.getElementById('finder-query');
    var statusEl = document.getElementById('finder-status');
    var resultsEl = document.getElementById('finder-results');
    var ctaEl = document.getElementById('finder-cta');
    var functionChips = document.getElementById('finder-functions');
    var locationChips = document.getElementById('finder-locations');

    if (!form || !queryInput) return;

    loadMeta();

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      runSearch(queryInput.value.trim());
    });

    function loadMeta() {
      fetch(API_URL + '/api/directory/meta')
        .then(function (response) { return response.ok ? response.json() : null; })
        .then(function (meta) {
          if (!meta) return;
          renderChips(functionChips, meta.functions || []);
          renderChips(locationChips, (meta.locations || []).slice(0, 12));
        })
        .catch(function () {});
    }

    function renderChips(container, items) {
      if (!container || !items.length) return;
      container.innerHTML = items.map(function (item) {
        return '<button type="button" class="finder-chip" data-value="' + escapeAttribute(item) + '">' + escapeHtml(item) + '</button>';
      }).join('');
      container.querySelectorAll('.finder-chip').forEach(function (chip) {
        chip.addEventListener('click', function () {
          var value = chip.getAttribute('data-value');
          queryInput.value = queryInput.value ? queryInput.value + ' ' + value : value;
          queryInput.focus();
        });
      });
    }

    function runSearch(query) {
      if (!query) {
        statusEl.textContent = 'Search by role, location, industry or stage.';
        resultsEl.innerHTML = '';
        ctaEl.hidden = true;
        return;
      }

      statusEl.textContent = 'Searching...';
      resultsEl.innerHTML = '';
      ctaEl.hidden = true;

      fetch(API_URL + '/api/find', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query })
      })
        .then(function (response) {
          return response.json().then(function (data) {
            if (!response.ok) throw new Error(data.error || 'Search failed');
            return data;
          });
        })
        .then(function (data) {
          if (data.clarifyingQuestion) {
            statusEl.textContent = data.clarifyingQuestion;
            renderFunctionPrompt(data.functions || []);
            return;
          }

          if (!data.cards || !data.cards.length) {
            statusEl.textContent = data.suggestion || 'No exact matches yet.';
            resultsEl.innerHTML = '';
            ctaEl.hidden = false;
            return;
          }

          var totalCount = data.totalCount == null ? data.count : data.totalCount;
          var shownCount = data.shownCount == null ? data.cards.length : data.shownCount;
          statusEl.textContent = totalCount + ' matching fractional exec' + (totalCount === 1 ? '' : 's') +
            (shownCount < totalCount ? '. Showing the top ' + shownCount + '.' : '');
          resultsEl.innerHTML = data.cards.map(renderCard).join('');
          ctaEl.hidden = false;
        })
        .catch(function (err) {
          statusEl.textContent = err.message || 'Directory search is temporarily unavailable.';
          resultsEl.innerHTML = '';
          ctaEl.hidden = true;
        });
    }

    function renderFunctionPrompt(functions) {
      if (!functions.length) return;
      resultsEl.innerHTML = '<div class="finder-prompt">' + functions.map(function (fn) {
        return '<button type="button" class="finder-chip" data-value="' + escapeAttribute(fn) + '">' + escapeHtml(fn) + '</button>';
      }).join('') + '</div>';
      resultsEl.querySelectorAll('.finder-chip').forEach(function (chip) {
        chip.addEventListener('click', function () {
          queryInput.value = chip.getAttribute('data-value');
          runSearch(queryInput.value);
        });
      });
    }

    function renderCard(card) {
      var functions = Array.isArray(card.functions) ? card.functions.join(', ') : '';
      var meta = [functions, card.level, card.location].filter(Boolean).join(' • ');
      var linkedin = card.linkedin
        ? '<a class="finder-card__link" href="' + escapeAttribute(card.linkedin) + '" target="_blank" rel="noopener">LinkedIn</a>'
        : '';
      return [
        '<article class="finder-card">',
        '<div class="finder-card__top">',
        '<div><h2>' + escapeHtml(card.name || 'FEC member') + '</h2><p class="finder-card__meta">' + escapeHtml(meta) + '</p></div>',
        linkedin,
        '</div>',
        card.blurb ? '<p>' + escapeHtml(card.blurb) + '</p>' : '',
        card.fitNote ? '<p class="finder-card__fit">' + escapeHtml(card.fitNote) + '</p>' : '',
        '</article>'
      ].join('');
    }
  });

  function escapeHtml(text) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(String(text || '')));
    return div.innerHTML;
  }

  function escapeAttribute(text) {
    return String(text || '').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
})();

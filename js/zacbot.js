/**
 * ZacBot - FEC Knowledge Assistant
 * Vanilla JS chat client with SSE streaming, trial gating, and token auth.
 */
(function () {
  'use strict';

  // ── Config ──────────────────────────────────────────────────
  const API_URL = 'https://fec-website-2026-production-7dbe.up.railway.app';
  const TRIAL_LIMIT = 3;
  const MEMBERSHIP_URL = 'https://thefractionalexec.com.au/membership';

  const SUGGESTED_QUESTIONS = [
    'How should I price my fractional services?',
    'What is the Context Journey?',
    'How do I build a pipeline as a fractional?',
    'What AI tools should I use for my practice?'
  ];

  // ── State ───────────────────────────────────────────────────
  let messages = [];
  let questionCount = 0;
  let isStreaming = false;
  let isUnlimited = false;
  let accessToken = null; // Token from URL, sent to server for validation
  let currentAbortController = null;

  // ── Init ────────────────────────────────────────────────────
  function init(containerEl, options = {}) {
    const isBubble = options.bubble || false;

    // Grab token from URL (never validated client-side)
    const params = new URLSearchParams(window.location.search);
    accessToken = params.get('token') || null;

    // Restore question count from localStorage
    const stored = localStorage.getItem('zacbot_questions');
    if (stored) {
      questionCount = parseInt(stored, 10) || 0;
    }

    // Render chat UI
    containerEl.innerHTML = buildChatHTML();

    // Bind events
    bindEvents(containerEl);

    // Validate token server-side if present
    if (accessToken) {
      fetch(API_URL + '/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: accessToken })
      })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (data.unlimited) {
            isUnlimited = true;
          }
          showWelcome(containerEl);
          updateCounter(containerEl);
        })
        .catch(function () {
          // Auth failed, treat as trial user
          showWelcome(containerEl);
          updateCounter(containerEl);
        });
    } else {
      showWelcome(containerEl);
      updateCounter(containerEl);
    }
  }

  function buildChatHTML() {
    return `
      <div class="zacbot-chat-container">
        <div class="zacbot-header">
          <div class="zacbot-header__title">
            <span class="zacbot-header__status"></span>
            ZacBot
          </div>
          <div class="zacbot-header__actions">
            <button class="zacbot-header__btn" id="zacbot-new-chat">New chat</button>
          </div>
        </div>
        <div class="zacbot-messages" id="zacbot-messages"></div>
        <div id="zacbot-email-gate" style="display:none;">
          <div class="zacbot-trial-gate">
            <h3>You're out of free questions</h3>
            <p>Drop your email and we'll let you know how to get unlimited access to ZacBot and the full FEC community.</p>
            <div class="zacbot-email-form">
              <input type="email" class="zacbot-input" id="zacbot-email-input" placeholder="your@email.com" style="max-width:280px;margin:0 auto;">
              <button class="zacbot-send-btn" id="zacbot-email-submit" style="margin-top:0.5rem;">Send</button>
            </div>
            <button class="zacbot-skip-link" id="zacbot-email-skip">No thanks, just show me how to get unlimited access</button>
          </div>
        </div>
        <div id="zacbot-trial-gate" style="display:none;">
          <div class="zacbot-trial-gate">
            <h3>Want unlimited access to ZacBot?</h3>
            <p>Join the Fractional Exec Community for unlimited ZacBot, plus workshops, playbooks, templates, and a network of 1,100+ fractional executives.</p>
            <a href="${MEMBERSHIP_URL}" target="_blank" class="zacbot-trial-gate__cta">Join the Community</a>
          </div>
        </div>
        <div class="zacbot-input-area" id="zacbot-input-area">
          <div class="zacbot-input-row">
            <textarea
              class="zacbot-input"
              id="zacbot-input"
              placeholder="Ask me anything about fractional work..."
              rows="1"
            ></textarea>
            <button class="zacbot-send-btn" id="zacbot-send">Send</button>
          </div>
          <div class="zacbot-counter" id="zacbot-counter"></div>
        </div>
      </div>
    `;
  }

  function bindEvents(container) {
    const input = container.querySelector('#zacbot-input');
    const sendBtn = container.querySelector('#zacbot-send');
    const newChatBtn = container.querySelector('#zacbot-new-chat');

    // Send on click
    sendBtn.addEventListener('click', function () {
      sendMessage(container);
    });

    // Send on Enter (Shift+Enter for newline)
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage(container);
      }
    });

    // Auto-resize textarea
    input.addEventListener('input', function () {
      this.style.height = 'auto';
      this.style.height = Math.min(this.scrollHeight, 120) + 'px';
    });

    // New chat
    newChatBtn.addEventListener('click', function () {
      messages = [];
      isStreaming = false;
      if (currentAbortController) {
        currentAbortController.abort();
        currentAbortController = null;
      }
      showWelcome(container);
      setInputEnabled(container, true);
    });
  }

  function showWelcome(container) {
    const messagesEl = container.querySelector('#zacbot-messages');
    const trialGate = container.querySelector('#zacbot-trial-gate');
    trialGate.style.display = 'none';

    // Check if trial is already exhausted
    if (!isUnlimited && questionCount >= TRIAL_LIMIT) {
      messagesEl.innerHTML = '';
      trialGate.style.display = 'block';
      setInputEnabled(container, false);
      return;
    }

    let suggestionsHTML = SUGGESTED_QUESTIONS.map(function (q) {
      return '<button class="zacbot-suggestion" data-question="' + escapeHtml(q) + '">' + escapeHtml(q) + '</button>';
    }).join('');

    let trialNote = '';
    if (!isUnlimited) {
      const remaining = TRIAL_LIMIT - questionCount;
      trialNote = '<p style="font-size:0.85rem;margin-top:1rem;color:rgba(255,255,255,0.4);">' + remaining + ' free question' + (remaining !== 1 ? 's' : '') + ' remaining</p>';
    }

    messagesEl.innerHTML = `
      <div class="zacbot-welcome">
        <h3>Hey, I'm ZacBot</h3>
        <p>I'm an AI assistant trained on Zac King's frameworks for fractional executives. Ask me about positioning, pricing, client delivery, GTM strategy, AI tools, or building your practice.</p>
        <div class="zacbot-suggestions">${suggestionsHTML}</div>
        ${trialNote}
      </div>
    `;

    // Bind suggestion clicks
    messagesEl.querySelectorAll('.zacbot-suggestion').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var input = container.querySelector('#zacbot-input');
        input.value = this.getAttribute('data-question');
        sendMessage(container);
      });
    });
  }

  // ── Messaging ───────────────────────────────────────────────
  function sendMessage(container) {
    var input = container.querySelector('#zacbot-input');
    var text = input.value.trim();

    if (!text || isStreaming) return;

    // Check trial limit
    if (!isUnlimited && questionCount >= TRIAL_LIMIT) {
      showTrialGate(container);
      return;
    }

    // Add user message
    messages.push({ role: 'user', content: text });
    input.value = '';
    input.style.height = 'auto';

    // Render (don't increment trial count yet - wait for successful response)
    renderMessages(container);

    // Stream response
    streamResponse(container);
  }

  function streamResponse(container) {
    isStreaming = true;
    setInputEnabled(container, false);

    // Add empty assistant message
    messages.push({ role: 'assistant', content: '' });
    var assistantIndex = messages.length - 1;

    // Show typing indicator, then swap it for a real message bubble once streaming starts
    renderMessages(container, true);
    var streamingEl = null; // Will hold reference to the content div we update during streaming

    currentAbortController = new AbortController();

    fetch(API_URL + '/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: messages.slice(0, -1), token: accessToken }),
      signal: currentAbortController.signal
    })
      .then(function (response) {
        if (!response.ok) {
          return response.json().then(function (data) {
            throw new Error(data.error || 'Request failed');
          });
        }

        var reader = response.body.getReader();
        var decoder = new TextDecoder();
        var buffer = '';

        function read() {
          reader.read().then(function (result) {
            if (result.done) {
              finishStream(container, true);
              return;
            }

            buffer += decoder.decode(result.value, { stream: true });
            var lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (var i = 0; i < lines.length; i++) {
              var line = lines[i].trim();
              if (!line.startsWith('data: ')) continue;

              try {
                var data = JSON.parse(line.slice(6));

                if (data.type === 'chunk') {
                  messages[assistantIndex].content += data.text;

                  // On first chunk, replace typing indicator with real message bubble
                  if (!streamingEl) {
                    renderMessages(container, false);
                    var allMessages = container.querySelectorAll('.zacbot-message__content');
                    streamingEl = allMessages[allMessages.length - 1];
                  }

                  // Update only the streaming message's content (no DOM rebuild)
                  if (streamingEl) {
                    streamingEl.innerHTML = formatMessage(messages[assistantIndex].content);
                  }

                  // Auto-scroll
                  var messagesEl = container.querySelector('#zacbot-messages');
                  messagesEl.scrollTop = messagesEl.scrollHeight;

                } else if (data.type === 'error') {
                  messages[assistantIndex].content = data.error;
                  renderMessages(container, false);
                  finishStream(container, false);
                  return;
                } else if (data.type === 'done') {
                  finishStream(container, true);
                  return;
                }
              } catch (e) {
                // Skip malformed JSON
              }
            }

            read();
          }).catch(function (err) {
            if (err.name !== 'AbortError') {
              messages[assistantIndex].content = 'Connection lost. Please check your internet and try again.';
              renderMessages(container, false);
            }
            finishStream(container, false);
          });
        }

        read();
      })
      .catch(function (err) {
        if (err.name !== 'AbortError') {
          messages[assistantIndex].content = err.message || 'ZacBot is temporarily unavailable. Please try again later.';
          renderMessages(container, false);
        }
        finishStream(container, false);
      });
  }

  function finishStream(container, success) {
    isStreaming = false;
    currentAbortController = null;
    setInputEnabled(container, true);

    // FIX: Only count the question if the response was successful
    if (success && !isUnlimited) {
      questionCount++;
      localStorage.setItem('zacbot_questions', questionCount.toString());
      updateCounter(container);

      if (questionCount >= TRIAL_LIMIT) {
        showTrialGate(container);
      }
    }
  }

  // ── Rendering ───────────────────────────────────────────────
  function renderMessages(container, showTyping) {
    var messagesEl = container.querySelector('#zacbot-messages');

    var html = '';
    for (var i = 0; i < messages.length; i++) {
      var msg = messages[i];
      var isUser = msg.role === 'user';
      var isLast = i === messages.length - 1;

      // Skip empty assistant message while typing indicator is shown
      if (!isUser && !msg.content && showTyping && isLast) continue;

      html += '<div class="zacbot-message zacbot-message--' + msg.role + '">';
      html += '<div class="zacbot-message__avatar">' + (isUser ? 'You' : 'ZB') + '</div>';
      html += '<div class="zacbot-message__content">' + formatMessage(msg.content) + '</div>';
      // Add feedback buttons on completed assistant messages (not during streaming)
      if (!isUser && msg.content && !(isLast && isStreaming)) {
        var voted = msg.feedback || '';
        html += '<div class="zacbot-feedback" data-msg-index="' + i + '">';
        html += '<button class="zacbot-feedback__btn' + (voted === 'up' ? ' is-active' : '') + '" data-vote="up" title="Good answer">&#x1F44D;</button>';
        html += '<button class="zacbot-feedback__btn' + (voted === 'down' ? ' is-active' : '') + '" data-vote="down" title="Bad answer">&#x1F44E;</button>';
        html += '</div>';
      }
      html += '</div>';
    }

    if (showTyping) {
      html += '<div class="zacbot-message zacbot-message--assistant">';
      html += '<div class="zacbot-message__avatar">ZB</div>';
      html += '<div class="zacbot-typing"><div class="zacbot-typing__dot"></div><div class="zacbot-typing__dot"></div><div class="zacbot-typing__dot"></div></div>';
      html += '</div>';
    }

    messagesEl.innerHTML = html;
    messagesEl.scrollTop = messagesEl.scrollHeight;

    // Bind feedback buttons
    messagesEl.querySelectorAll('.zacbot-feedback__btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var feedbackDiv = this.closest('.zacbot-feedback');
        var msgIndex = parseInt(feedbackDiv.getAttribute('data-msg-index'), 10);
        var vote = this.getAttribute('data-vote');

        // Store locally
        messages[msgIndex].feedback = vote;

        // Send to server
        fetch(API_URL + '/feedback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            question: messages[msgIndex - 1] ? messages[msgIndex - 1].content : '',
            answer: messages[msgIndex].content.substring(0, 200),
            vote: vote
          })
        }).catch(function () {});

        // Update UI
        feedbackDiv.querySelectorAll('.zacbot-feedback__btn').forEach(function (b) {
          b.classList.remove('is-active');
        });
        this.classList.add('is-active');
      });
    });
  }

  function formatMessage(text) {
    if (!text) return '';

    // Basic markdown-like formatting
    var escaped = escapeHtml(text);

    // Bold: **text**
    escaped = escaped.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

    // Bullet points: lines starting with - or *
    escaped = escaped.replace(/^[\-\*] (.+)$/gm, '<li>$1</li>');
    escaped = escaped.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');

    // Numbered lists: lines starting with 1. 2. etc
    escaped = escaped.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

    // Paragraphs (double newline)
    escaped = escaped.replace(/\n\n/g, '</p><p>');
    escaped = '<p>' + escaped + '</p>';

    // Single newlines within paragraphs
    escaped = escaped.replace(/\n/g, '<br>');

    // Clean up empty paragraphs
    escaped = escaped.replace(/<p>\s*<\/p>/g, '');

    return escaped;
  }

  function showTrialGate(container) {
    var emailGate = container.querySelector('#zacbot-email-gate');
    var trialGate = container.querySelector('#zacbot-trial-gate');
    var inputArea = container.querySelector('#zacbot-input-area');
    inputArea.style.display = 'none';

    // Check if email already captured
    var emailCaptured = localStorage.getItem('zacbot_email');
    if (emailCaptured) {
      trialGate.style.display = 'block';
      return;
    }

    // Show email capture first
    emailGate.style.display = 'block';

    // Bind email form events
    var emailSubmit = container.querySelector('#zacbot-email-submit');
    var emailInput = container.querySelector('#zacbot-email-input');
    var emailSkip = container.querySelector('#zacbot-email-skip');

    emailSubmit.addEventListener('click', function () {
      var email = emailInput.value.trim();
      if (!email || !email.includes('@')) {
        emailInput.style.borderColor = '#ef4444';
        return;
      }
      // Send email to server
      fetch(API_URL + '/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email })
      }).catch(function () {}); // Fire and forget

      localStorage.setItem('zacbot_email', email);
      emailGate.style.display = 'none';
      trialGate.style.display = 'block';
    });

    emailSkip.addEventListener('click', function () {
      localStorage.setItem('zacbot_email', 'skipped');
      emailGate.style.display = 'none';
      trialGate.style.display = 'block';
    });
  }

  function updateCounter(container) {
    var counterEl = container.querySelector('#zacbot-counter');
    if (!counterEl) return;
    if (isUnlimited) {
      counterEl.style.display = 'none';
      return;
    }
    var remaining = TRIAL_LIMIT - questionCount;
    if (remaining <= 0) {
      counterEl.textContent = '';
    } else {
      counterEl.textContent = remaining + ' free question' + (remaining !== 1 ? 's' : '') + ' remaining';
    }
  }

  function setInputEnabled(container, enabled) {
    var input = container.querySelector('#zacbot-input');
    var sendBtn = container.querySelector('#zacbot-send');
    if (input) input.disabled = !enabled;
    if (sendBtn) sendBtn.disabled = !enabled;
    if (enabled && input) input.focus();
  }

  function escapeHtml(text) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(text));
    return div.innerHTML;
  }

  // ── Bubble Widget ───────────────────────────────────────────
  function initBubble() {
    // Check if we're on the zacbot page (full page, not bubble)
    if (window.location.pathname.includes('zacbot')) return;

    // Create bubble button
    var bubble = document.createElement('button');
    bubble.className = 'zacbot-bubble';
    bubble.setAttribute('aria-label', 'Open ZacBot chat');
    bubble.innerHTML = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/></svg>';

    // Create panel
    var panel = document.createElement('div');
    panel.className = 'zacbot-panel';
    panel.id = 'zacbot-bubble-panel';

    document.body.appendChild(panel);
    document.body.appendChild(bubble);

    var isOpen = false;

    bubble.addEventListener('click', function () {
      isOpen = !isOpen;

      if (isOpen) {
        panel.classList.add('is-open');
        bubble.innerHTML = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';
        bubble.classList.add('zacbot-bubble--close');

        // Init chat in panel if not already done
        if (!panel.querySelector('.zacbot-chat-container')) {
          init(panel, { bubble: true });
        }
      } else {
        panel.classList.remove('is-open');
        bubble.innerHTML = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/></svg>';
        bubble.classList.remove('zacbot-bubble--close');
      }
    });
  }

  // ── Expose ──────────────────────────────────────────────────
  window.ZacBot = {
    init: init,
    initBubble: initBubble
  };

  // Auto-init: if there's a #zacbot-app element, init full page chat
  document.addEventListener('DOMContentLoaded', function () {
    var appEl = document.getElementById('zacbot-app');
    if (appEl) {
      init(appEl);
    }

    // Always init bubble on non-zacbot pages
    initBubble();
  });
})();

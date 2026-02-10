/**
 * Metabase Path Rewriter
 * 拦截所有 /api/、/question/、/collection/ 等请求，加上 /bi 前缀
 * 让 Metabase SPA 在 /bi/ 子路径下正常工作
 */
(function() {
  var PREFIX = '/bi';

  function needsPrefix(url) {
    if (typeof url !== 'string') return false;
    if (url[0] !== '/') return false;
    if (url.startsWith(PREFIX)) return false;
    // 只改写 Metabase 相关的路径
    if (url.startsWith('/api/') || url.startsWith('/app/') ||
        url.startsWith('/question/') || url.startsWith('/collection/') ||
        url.startsWith('/dashboard/') || url.startsWith('/auth/') ||
        url.startsWith('/browse') || url.startsWith('/search') ||
        url === '/') {
      return true;
    }
    return false;
  }

  function fix(url) {
    return needsPrefix(url) ? PREFIX + url : url;
  }

  // Patch fetch
  var origFetch = window.fetch;
  window.fetch = function(input, init) {
    if (typeof input === 'string') input = fix(input);
    else if (input && input.url) input = new Request(fix(input.url), input);
    return origFetch.call(this, input, init);
  };

  // Patch XMLHttpRequest
  var origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url) {
    arguments[1] = fix(url);
    return origOpen.apply(this, arguments);
  };

  // Patch history (for SPA navigation after login)
  var origPush = history.pushState;
  history.pushState = function(state, title, url) {
    arguments[2] = fix(url);
    return origPush.apply(this, arguments);
  };

  var origReplace = history.replaceState;
  history.replaceState = function(state, title, url) {
    arguments[2] = fix(url);
    return origReplace.apply(this, arguments);
  };

  // Patch window.location assignment (via setter override where possible)
  // Note: direct location assignment can't be intercepted, but a polling fallback handles it
  setInterval(function() {
    var path = window.location.pathname;
    if (path === '/' || (path.startsWith('/question/') || path.startsWith('/collection/') || path.startsWith('/dashboard/'))) {
      window.location.replace(PREFIX + path + window.location.search + window.location.hash);
    }
  }, 500);

  console.log('[MetabasePatch] Initialized: all paths will be prefixed with ' + PREFIX);
})();

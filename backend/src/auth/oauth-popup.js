(function () {
  try {
    var el = document.getElementById('oauth-result');
    if (!el) return;
    var data = JSON.parse(el.textContent || '{}');
    var msg = data.msg;
    var targetOrigin = data.targetOrigin;
    var delivered = false;

    // Primary channel: the opener window, restricted to the allow-listed target origin.
    if (window.opener && typeof window.opener.postMessage === 'function') {
      try {
        window.opener.postMessage(msg, targetOrigin);
        delivered = true;
      } catch (err) {
        console.error('postMessage to opener failed:', err);
      }
    }

    // Fallback channel: same-origin BroadcastChannel. It works even when the browser has
    // detached this popup from its opener (window.opener === null).
    if (typeof BroadcastChannel === 'function') {
      try {
        var channel = new BroadcastChannel('codecollab-oauth');
        channel.postMessage(msg);
        delivered = true;
      } catch (err) {
        console.error('BroadcastChannel delivery failed:', err);
      }
    }

    if (msg && msg.type === 'OAUTH_AUTH_SUCCESS') {
      var status = document.getElementById('status');
      if (status) {
        status.textContent = delivered
          ? 'Signed in. This window will close automatically.'
          : 'Signed in, but the app window could not be reached. Close this window and reload the app.';
      }
      if (delivered) {
        setTimeout(function () {
          window.close();
          // If the browser refuses to close the window, tell the user what to do.
          setTimeout(function () {
            if (status) status.textContent = 'Signed in. You can close this window now.';
          }, 400);
        }, 250);
      }
    }
  } catch (err) {
    console.error('Failed to dispatch OAuth message:', err);
  }
})();

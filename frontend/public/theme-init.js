(function () {
  try {
    var stored = localStorage.getItem('cc-theme');
    var isDark = stored === 'dark' || (!stored || stored === 'system'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : false);
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  } catch (_e) {
    document.documentElement.setAttribute('data-theme', 'dark');
    document.documentElement.classList.add('dark');
  }
})();


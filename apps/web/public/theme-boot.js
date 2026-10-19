// Runs before the stylesheet and the app so the first paint already uses the saved theme.
// Dark is the default; only an explicit saved "light" choice changes it.
(function () {
  var theme = 'dark';
  try {
    if (localStorage.getItem('creator-agent.theme') === 'light')
      theme = 'light';
  } catch (e) {}
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.style.colorScheme = theme;
})();

// Reload the document after cookie removal so authenticated layouts and
// prefetched headers cannot survive a sign-out on the current route.
export function navigateAfterLogout(destination: "/" | "/login") {
  window.location.replace(destination);
}

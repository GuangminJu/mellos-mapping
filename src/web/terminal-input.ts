/// <reference lib="dom" />
/** A hidden terminal input must stay unfocusable until the user opts in. */
export function bindTerminalInput(textarea: HTMLTextAreaElement, button: HTMLButtonElement, surface: HTMLElement) {
  const listeners = new AbortController();
  const options = { signal: listeners.signal };
  const release = (): void => {
    textarea.blur();
    textarea.disabled = true;
    button.disabled = false;
    button.textContent = '启用快捷键';
  };
  button.addEventListener('click', () => {
    textarea.disabled = false;
    textarea.focus({ preventScroll: true });
    button.disabled = true;
    button.textContent = '快捷键已启用';
  }, options);
  textarea.addEventListener('blur', release, options);
  window.addEventListener('blur', release, options);
  surface.addEventListener('pointerleave', release, options);
  document.documentElement.addEventListener('pointerleave', release, options);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') release();
  }, options);
  release();
  return { release, dispose: () => { release(); listeners.abort(); } };
}

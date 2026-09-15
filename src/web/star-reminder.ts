/// <reference lib="dom" />
/** One inline notice after a successful visible map; no modal, focus or timer. */
export function createStarNotice(base: URL): (page?: string) => void {
  let attempted = false;
  const notice = document.getElementById('star-reminder')!;
  const link = notice.querySelector('a')!;
  let opening = false;
  link.title = '在系统默认浏览器中打开 GitHub';
  const dismiss = (): void => { notice.hidden = true; };
  notice.querySelector('button')!.addEventListener('click', dismiss);
  const launch = async (event: MouseEvent): Promise<void> => {
    event.preventDefault();
    if (opening) return;
    opening = true; link.setAttribute('aria-disabled', 'true'); link.textContent = '正在打开…';
    notice.querySelector('.star-open-error')?.remove();
    try {
      const response = await fetch(new URL('api/star-reminder/open', base), { method: 'POST', signal: AbortSignal.timeout(8000) });
      const result = await response.json() as { opened?: unknown };
      if (!response.ok || result.opened !== true) throw new Error('Not opened');
      dismiss();
    } catch {
      const error = document.createElement('div'); error.className = 'star-open-error'; error.setAttribute('role', 'status');
      const message = document.createElement('span'); message.textContent = '默认浏览器未能打开，可重试或复制地址。';
      const copy = document.createElement('button'); copy.type = 'button'; copy.textContent = '复制 GitHub 地址';
      copy.addEventListener('click', () => {
        void (async () => {
          try { await navigator.clipboard.writeText(link.href); copy.textContent = '已复制'; }
          catch {
            const address = document.createElement('input'); address.readOnly = true; address.value = link.href;
            address.setAttribute('aria-label', 'GitHub 地址'); copy.replaceWith(address); address.focus(); address.select();
          }
        })();
      });
      error.append(message, copy); notice.append(error);
    } finally { opening = false; link.removeAttribute('aria-disabled'); link.textContent = '去点 Star ↗'; }
  };
  link.addEventListener('click', event => { void launch(event); });
  link.addEventListener('auxclick', event => { if (event.button === 1) void launch(event); });
  return page => {
    if (attempted || document.visibilityState !== 'visible') return;
    attempted = true;
    const url = new URL('api/star-reminder/visit', base);
    if (page) url.searchParams.set('page', page);
    void fetch(url, { method: 'POST', signal: AbortSignal.timeout(3000) })
      .then(async response => {
        if (!response.ok) return;
        const result = await response.json() as { show?: unknown };
        if (result.show === true && document.visibilityState === 'visible') notice.hidden = false;
      }).catch(() => { /* Optional support should never interrupt the map. */ });
  };
}

(() => {
  'use strict';

  const nativeFetch = window.fetch.bind(window);
  const pairs = [
    ['assets/mountains/mountain-atlas-13.0.chunk-000.b64', 'assets/mountains/mountain-atlas-13.0.chunk-001.b64'],
    ['assets/mountains/mountain-atlas-13.0.chunk-002.b64', 'assets/mountains/mountain-atlas-13.0.chunk-003.b64'],
    ['assets/mountains/mountain-atlas-13.0.chunk-004.b64', 'assets/mountains/mountain-atlas-13.0.chunk-005.b64'],
    ['assets/mountains/mountain-atlas-13.0.chunk-006.b64', 'assets/mountains/mountain-atlas-13.0.chunk-007.b64'],
    ['assets/mountains/mountain-atlas-13.0.chunk-008.b64', 'assets/mountains/mountain-atlas-13.0.chunk-009.b64'],
    ['assets/mountains/mountain-atlas-13.0.chunk-010.b64', 'assets/mountains/mountain-atlas-13.0.chunk-011.b64'],
  ];

  window.fetch = async (input, init) => {
    const rawUrl = input instanceof Request ? input.url : String(input);
    const url = new URL(rawUrl, document.baseURI);
    const match = url.pathname.match(/\/assets\/mountains\/mountain-atlas-13\.0\.part-(\d{3})\.b64$/);
    if (!match) return nativeFetch(input, init);
    const partIndex = Number(match[1]);
    if (!Number.isInteger(partIndex) || partIndex < 0 || partIndex >= pairs.length) return nativeFetch(input, init);
    const texts = await Promise.all(pairs[partIndex].map(async (name) => {
      const response = await nativeFetch(new URL(`${name}?v=13.0.3`, document.baseURI), {cache: 'no-store'});
      if (!response.ok) throw new Error(`Alan Map 13.0: не загружен atlas chunk ${name} (${response.status}).`);
      return (await response.text()).trim();
    }));
    return new Response(texts.join(''), {status: 200, statusText: 'OK', headers: {'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store'}});
  };
})();

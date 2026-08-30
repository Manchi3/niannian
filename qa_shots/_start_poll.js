(async () => {
  window.__rL = [];
  window.__rS = performance.now();
  window.__rI = setInterval(() => {
    const blobImgs = document.querySelectorAll('img[src^="blob:"]').length;
    const blocker = !!Array.from(document.querySelectorAll('div')).find(d => d.className && d.className.includes('z-[999]'));
    const t = Math.round(performance.now() - window.__rS);
    window.__rL.push({t, imgs: blobImgs, blocked: blocker});
  }, 30);
  return 'polling-started';
})()
(() => {
  clearInterval(window.__rI);
  const log = window.__rL || [];
  const trans = [];
  let last = null;
  for (const e of log) {
    const k = e.imgs + '|' + e.blocked;
    if (k !== last) { trans.push(e); last = k; }
  }
  return JSON.stringify({
    logLen: log.length,
    firstT: log[0] ? log[0].t : null,
    lastT: log[log.length-1] ? log[log.length-1].t : null,
    transitions: trans
  });
})()
export function frag (html) {
	let doc = new DOMParser().parseFromString(html, 'text/html');
	let frag = doc.createDocumentFragment();
	let body = doc.body;
	while (body.firstChild) {
		frag.appendChild(body.firstChild);
	}
	return frag;
}

export function throttle (fn, time, thisArg, repeatAction) {
  
  let lastRun = false;
  let nextTime = 0;
  
  return function throttled (...args) {
    let now = Date.now();
    return new Promise(function (resolve) {
      if (!lastRun) {
        lastRun = now;
        return resolve(fn.apply(thisArg, args));
      }
      if ((now - lastRun) <= time) {
        if (repeatAction === 'discard-repeats') return;
        nextTime += time - (now - lastRun);
        return setTimeout(function () {
          lastRun = Date.now();
          return resolve(fn.apply(thisArg, args));
        }, nextTime);
      }
      lastRun = now;
      return resolve(fn.apply(thisArg, args));
    });
  };
  
}

export let re = {
  escape: function RegexpEscape (s) {
    return String(s).replace(/[\\^$*+?.()|[\]{}]/g, '\\$&');
  }
}
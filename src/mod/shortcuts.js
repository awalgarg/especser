let shortcuts = {
	keypress: {},
	keydown: {}
};

let Key_Mappings = {
	F: 70,
	P: 80,
	ESC: 27
};

document.addEventListener('keypress', handler, true);
document.addEventListener('keydown', handler, true);

function handler (ev) {
	let mods = [];
	if (ev.altKey) mods.push('alt');
	if (ev.ctrlKey) mods.push('ctrl');
	if (ev.shiftKey) mods.push('shift');
	mods = mods.sort();
	let keyCode = ev.keyCode;
	let id = `${mods.join('+')}:${keyCode}`;

	if (shortcuts[ev.type].hasOwnProperty(id)) {
		let {callback, thisArg, args} = shortcuts[ev.type][id];
		callback.call(thisArg, ev, ...args);
	}
}

function findKeyCode (key) {
	return Key_Mappings[key.toUpperCase()];
}

function parseKey ({modifier = [], key = ''}) {
	if (!Array.isArray(modifier)) modifier = [modifier];
	let mods = modifier.map(m => m.toLowerCase()).sort();
	let evType, keyCode;
	if (!modifier.length && String(key).length === 1) {
		evType = 'keypress';
		keyCode = key.toLowerCase().charCodeAt();
	}
	else {
		evType = 'keydown';
		keyCode = key;
		if (!Number(key)) {
			keyCode = findKeyCode(key);
		}
	}
	if (!keyCode) throw new Error(`Unable to parse key definition. Passed modifier: ${modifier}. Passed Key: ${key}.`);
	let id = `${mods.join('+')}:${keyCode}`;
	return { mods, id, keyCode, evType, key };
}

export function register (definition, callback, thisArg, ...args) {
	let descriptor = parseKey(definition);
	let data = {callback, thisArg, args};
	shortcuts[descriptor.evType][descriptor.id] = data;
}

export function remove (definition) {
	let {evType, id} = parseKey(definition);
	delete shortcuts[evType][id];
}

export function removeAll () {
	shortcuts = {
		keypress: {},
		keydown: {}
	};
}